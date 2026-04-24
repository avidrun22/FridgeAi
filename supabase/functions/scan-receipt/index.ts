// POST /functions/v1/scan-receipt
// Body: { image: <base64-jpeg> }
// Auth: required (Supabase JWT in Authorization: Bearer ...)
// Rate limit: SCAN_RECEIPT_DAILY_LIMIT per user per day.
// Response on success: { items: [{name, quantity, category, expiry_days}] }
import { corsHeaders } from "../_shared/cors.ts";
import { getUserId } from "../_shared/supabase.ts";
import { checkAndIncrement } from "../_shared/rate_limit.ts";
import { callClaude, extractJson } from "../_shared/anthropic.ts";

const DAILY_LIMIT = parseInt(Deno.env.get("SCAN_RECEIPT_DAILY_LIMIT") || "10", 10);

const PROMPT =
  'Look at this grocery receipt and extract all food items. Return ONLY a JSON array with no markdown: [{"name":"","quantity":"1","category":"","expiry_days":7}]. Use these categories: Dairy, Protein, Produce, Dry Goods, Beverages, Other. For quantity, include the amount and unit if visible (e.g. "2 lbs"). For expiry_days, estimate based on the food type.';

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  // 1. Auth
  const userId = await getUserId(req);
  if (!userId) return json({ error: "unauthenticated" }, 401);

  // 2. Parse body
  let body: { image?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json body" }, 400);
  }
  const image = body?.image;
  if (!image || typeof image !== "string") {
    return json({ error: "missing image (base64-jpeg)" }, 400);
  }
  if (image.length > 6_000_000) {
    // ~4.5 MB decoded — cap to protect Anthropic token budget
    return json({ error: "image too large, must be <6MB base64" }, 413);
  }

  // 3. Rate limit (atomic increment; counts even if Claude call fails, which
  // is fine — it also rate-limits repeated error cases and client retries)
  let rl;
  try {
    rl = await checkAndIncrement(userId, "scan_receipt", DAILY_LIMIT);
  } catch (e) {
    console.error("rate_limit error", e);
    return json({ error: "rate limit check failed" }, 500);
  }
  if (!rl.allowed) {
    return json(
      {
        error: `daily limit reached (${rl.limit}/day). Try again tomorrow.`,
        count: rl.count,
        limit: rl.limit,
      },
      429,
    );
  }

  // 4. Call Anthropic
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
    if (!Array.isArray(items)) return json({ error: "bad model output" }, 502);
    return json({ items, usage: { count: rl.count, limit: rl.limit } });
  } catch (e) {
    console.error("anthropic error", e);
    return json({ error: "receipt parse failed" }, 502);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
