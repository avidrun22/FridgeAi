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

// v1.22 #238 — tightened unit guidance. Old prompt emitted "1 count" or
// "15 count" for items without an explicit unit on the receipt, which
// renders as awkward "15 count pizza" in the fridge list. The clarified
// instructions push Claude to:
//   - omit unit (just emit the number) when the receipt shows no unit
//   - use slice/piece for naturally-portioned items even when the receipt
//     only shows a price
//   - prefer concrete units (lb/oz/gallon) when visible verbatim
const PROMPT =
  'Look at this grocery receipt and extract all food items. Return ONLY a JSON array with no markdown: [{"name":"","quantity":"1","category":"","expiry_days":7}]. Use these categories: Dairy, Protein, Produce, Dry Goods, Beverages, Other. For quantity: include the amount and unit if visible on the receipt (e.g. "2 lbs", "1 gallon", "12 oz"). If only a number is visible with no unit, return just the number (e.g. "3"). NEVER append "count" or "ct" — that\'s implicit. For naturally-sliceable items like pizza, cake, bread, pie — use "slice" if the receipt indicates a portion (e.g. "1 slice"). For expiry_days, estimate based on the food type.';

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
    // ~4.5 MB decoded — cap to protect Anthropic token budget. v1.24:
    // client now resizes to ~1600px before upload so this should rarely
    // fire; when it does, surface a typed error so the client can show
    // an actionable message instead of a generic "scan failed".
    return json({
      error: "Receipt photo is too large. Try a smaller image.",
      error_type: "image_too_large",
    }, 413);
  }

  // 3. Rate limit (atomic increment; counts even if Claude call fails, which
  // is fine — it also rate-limits repeated error cases and client retries)
  let rl;
  try {
    rl = await checkAndIncrement(userId, "scan_receipt", DAILY_LIMIT);
  } catch (e) {
    console.error("rate_limit error", e);
    return json({ error: "rate limit check failed", error_type: "rate_limit_check" }, 500);
  }
  if (!rl.allowed) {
    return json(
      {
        error: `daily limit reached (${rl.limit}/day). Try again tomorrow.`,
        error_type: "daily_limit",
        count: rl.count,
        limit: rl.limit,
      },
      429,
    );
  }

  // 4. Call Anthropic — v1.24 typed error responses so the client can
  // surface "Connection hiccup — try again" / "Try a clearer photo" etc.
  // instead of a single generic "receipt parse failed".
  let text: string;
  try {
    const resp = await callClaude({
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
    text = resp.text;
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    console.error("anthropic error", msg);
    // Differentiate transient (network/5xx/timeout) from permanent. Client
    // can retry the transient class; permanent shows a helpful tip.
    const transient = /timeout|fetch|network|5\d\d|abort|reset|enotfound/i.test(msg);
    return json(
      {
        error: transient
          ? "Connection hiccup — try again."
          : "Couldn't read this receipt. Try a clearer photo or better lighting.",
        error_type: transient ? "anthropic_transient" : "anthropic_permanent",
      },
      502,
    );
  }

  // 5. JSON extraction — v1.24 retry once if first extraction fails. A chunk
  // of the historical ~12.5% failure rate is Claude returning JSON wrapped
  // in commentary or trailing text. One stricter retry catches those cheaply.
  let items = extractJson<unknown[]>(text);
  if (!Array.isArray(items)) {
    console.warn("bad model output on first pass, retrying once with stricter prompt");
    try {
      const resp = await callClaude({
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: image },
              },
              { type: "text", text: PROMPT + "\n\nReturn ONLY the JSON array. No prose, no markdown, no commentary." },
            ],
          },
        ],
      });
      items = extractJson<unknown[]>(resp.text);
    } catch (e) {
      console.error("retry anthropic error", (e as Error)?.message || e);
    }
    if (!Array.isArray(items)) {
      return json(
        {
          error: "Couldn't read this receipt. Try a clearer photo.",
          error_type: "bad_model_output",
        },
        502,
      );
    }
  }
  return json({ items, usage: { count: rl.count, limit: rl.limit } });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
