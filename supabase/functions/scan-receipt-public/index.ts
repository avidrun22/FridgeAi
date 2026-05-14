// POST /functions/v1/scan-receipt-public
// Anonymous receipt scanning for ok2eat.com/scan. Same logic as scan-receipt
// but no JWT auth — rate-limited per IP instead of per user.
//
// Body: { image: <base64-jpeg> }
// Auth: NONE.
// Rate limit (per IP):
//   * PUBLIC_SCAN_DAILY_LIMIT scans/day (default 3)
//   * PUBLIC_SCAN_WEEKLY_LIMIT scans/rolling-7-days (default 5)
// Whichever fires first blocks the request.
// Response on success: { items: [...], usage: { daily_count, weekly_count, daily_limit, weekly_limit } }
//
// IMPORTANT: This function intentionally exposes Anthropic-backed receipt
// parsing without authentication so the marketing site can offer a "try it
// free" demo. Anti-abuse: per-IP two-tier rate limit, payload size cap,
// strict CORS origin allowlist (set via PUBLIC_SCAN_ALLOWED_ORIGINS env var).
import { corsHeaders } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { callClaude, extractJson } from "../_shared/anthropic.ts";

const DAILY_LIMIT = parseInt(Deno.env.get("PUBLIC_SCAN_DAILY_LIMIT") || "3", 10);
const WEEKLY_LIMIT = parseInt(Deno.env.get("PUBLIC_SCAN_WEEKLY_LIMIT") || "5", 10);

// Comma-separated list of allowed origins (e.g. "https://ok2eat.com,https://www.ok2eat.com").
// If unset, allows any origin (useful for local dev). In production, set this.
const ALLOWED_ORIGINS = (Deno.env.get("PUBLIC_SCAN_ALLOWED_ORIGINS") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const APP_STORE_URL = "https://apps.apple.com/us/app/ok2eat/id6761730687";

const PROMPT =
  'Look at this grocery receipt and extract all food items. Return ONLY a JSON array with no markdown: [{"name":"","quantity":"1","category":"","expiry_days":7}]. Use these categories: Dairy, Protein, Produce, Dry Goods, Beverages, Other. For quantity, include the amount and unit if visible (e.g. "2 lbs"). For expiry_days, estimate based on USDA FoodKeeper guidance for the food type stored in a fridge or pantry. Skip non-food line items (taxes, fees, deposits).';

Deno.serve(async (req) => {
  // 1. CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405, req);
  }

  // 2. Origin check (defense-in-depth; CORS already restricts browsers)
  const origin = req.headers.get("Origin");
  if (ALLOWED_ORIGINS.length > 0 && origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: "origin not allowed" }, 403, req);
  }

  // 3. Resolve client IP. Edge Function runtime gives us x-forwarded-for.
  const ip = resolveIp(req);
  if (!ip) {
    return json({ error: "could not resolve client ip" }, 400, req);
  }

  // 4. Parse body
  let body: { image?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json body" }, 400, req);
  }
  const image = body?.image;
  if (!image || typeof image !== "string") {
    return json({ error: "missing image (base64-jpeg)" }, 400, req);
  }
  if (image.length > 6_000_000) {
    return json({ error: "image too large, must be <4.5MB decoded" }, 413, req);
  }

  // 5. Rate limit (per-IP, daily + rolling 7 days)
  let counts: { daily: number; weekly: number };
  try {
    counts = await incrementIpUsage(ip);
  } catch (e) {
    console.error("rate_limit error", e);
    return json({ error: "rate limit check failed" }, 500, req);
  }

  // Check daily first (more common to hit) then weekly
  if (counts.daily > DAILY_LIMIT) {
    return json(
      {
        error: `Daily limit reached (${DAILY_LIMIT}/day). Install the iOS app for unlimited scans.`,
        usage: usagePayload(counts),
        app_store_url: APP_STORE_URL,
      },
      429,
      req,
    );
  }
  if (counts.weekly > WEEKLY_LIMIT) {
    return json(
      {
        error: `Weekly limit reached (${WEEKLY_LIMIT}/week). Install the iOS app for unlimited scans.`,
        usage: usagePayload(counts),
        app_store_url: APP_STORE_URL,
      },
      429,
      req,
    );
  }

  // 6. Call Anthropic
  try {
    const { text } = await callClaude({
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: image },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    const items = extractJson<unknown[]>(text);
    if (!Array.isArray(items)) {
      console.error("model returned non-array", text.slice(0, 500));
      return json({ error: "could not parse receipt; try a clearer photo" }, 502, req);
    }
    return json(
      { items, usage: usagePayload(counts) },
      200,
      req,
    );
  } catch (e) {
    console.error("anthropic error", e);
    return json({ error: "receipt parse failed; try again" }, 502, req);
  }
});

function usagePayload(c: { daily: number; weekly: number }) {
  return {
    daily_count: c.daily,
    daily_limit: DAILY_LIMIT,
    weekly_count: c.weekly,
    weekly_limit: WEEKLY_LIMIT,
  };
}

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allowed =
    ALLOWED_ORIGINS.length === 0 ||
    (origin && ALLOWED_ORIGINS.includes(origin));
  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin": allowed && origin ? origin : "*",
    Vary: "Origin",
  };
}

function json(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...(req ? buildCorsHeaders(req) : corsHeaders),
      "content-type": "application/json",
    },
  });
}

function resolveIp(req: Request): string | null {
  // Supabase Edge Functions sit behind Cloudflare → x-forwarded-for is most
  // reliable. Take the first hop (the original client).
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const cfip = req.headers.get("cf-connecting-ip");
  if (cfip) return cfip.trim();
  // Last resort: shared bucket so the function doesn't crash on weird routes.
  return "unknown";
}

async function incrementIpUsage(ip: string): Promise<{ daily: number; weekly: number }> {
  const supa = serviceClient();
  const { data, error } = await supa.rpc("increment_public_scan_usage", { p_ip: ip });
  if (error) throw new Error(`rpc failed: ${error.message}`);

  // RPC returns table(daily_count, weekly_count) → array of one object
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.daily_count !== "number" || typeof row.weekly_count !== "number") {
    throw new Error(`rpc returned unexpected shape: ${JSON.stringify(row)}`);
  }
  return { daily: row.daily_count, weekly: row.weekly_count };
}
