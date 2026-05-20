// scan-items — v1.25
// =============================================================================
// "Photo of items" flow. User snaps (or uploads) a photo of groceries spread
// on a counter, the interior of a fridge, or a pantry shelf. Claude vision
// identifies each food item and returns the same shape scan-receipt returns,
// so the existing review/commit UI reuses transparently.
//
// Why a separate Edge Function (vs reusing scan-receipt):
//   1. Different prompt — receipts have structured text + cryptic SKUs,
//      grocery photos have unlabeled items, partial occlusion, brand-on-
//      package detection. Tuning either prompt independently is cleaner.
//   2. Independent rate limit ('scan_items' vs 'scan_receipt'). v1.25 ships
//      a TIGHTER cap (5/day default vs receipt's 10/day) because vision-on-
//      arbitrary-photo is more expensive per call than receipt OCR and we
//      want to bound the cost while we validate the flow.
//   3. Independent PostHog telemetry so we can measure adoption vs receipt.
//
// POST /functions/v1/scan-items
// Body: { image: <base64-jpeg> }
// Auth: required (Supabase JWT in Authorization: Bearer ...)
// Rate limit: SCAN_ITEMS_DAILY_LIMIT per user per day (default 5).
// Response on success: { items: [{name, quantity, category, expiry_days}], usage: {count, limit} }
// Error responses include error_type so the client can route to actionable
// messaging (same pattern v1.24 introduced for scan-receipt).
import { corsHeaders } from "../_shared/cors.ts";
import { getUserId } from "../_shared/supabase.ts";
import { checkAndIncrement } from "../_shared/rate_limit.ts";
import { callClaude, extractJson } from "../_shared/anthropic.ts";

const DAILY_LIMIT = parseInt(Deno.env.get("SCAN_ITEMS_DAILY_LIMIT") || "5", 10);

// Prompt tuned for "spread your groceries on the counter" + "fridge interior"
// shots. Key differences vs the receipt prompt:
//   - Items don't have printed names; identify visually.
//   - Quantity is what's visibly present (1 bunch, 2 apples, 1 carton).
//   - Skip non-food (utensils, plates, shopping bag handles in frame).
//   - When a package has a visible brand, include it ("Chobani Greek Yogurt").
//   - Naturally-bunched produce uses "bunch" / "bag" / "head" appropriately.
//   - Don't hallucinate items that aren't clearly visible (partial occlusion
//     in fridge shots is fine — only list what you can confidently identify).
const PROMPT =
  'Look at this photo of groceries and identify each food item you can see. ' +
  'Return ONLY a JSON array with no markdown: ' +
  '[{"name":"","quantity":"1","category":"","expiry_days":7}]. ' +
  'Categories: Dairy, Protein, Produce, Dry Goods, Beverages, Other. ' +
  'For quantity: count what\'s visible (e.g. "3" for 3 apples) or describe the unit you see ' +
  '("1 bunch" for bananas/grapes/cilantro, "1 head" for lettuce/cabbage, ' +
  '"1 bag" for pre-bagged greens, "1 carton" for eggs/milk, "1 lb" if a price tag shows weight, ' +
  '"1" for a single packaged item like a jar or box). ' +
  'NEVER append "count" or "ct" — that\'s implicit. ' +
  'If a package has a visible brand name, include it (e.g. "Chobani Greek Yogurt", "Tillamook Cheddar"). ' +
  'For expiry_days, estimate based on the food type (7 for most fresh, 30 for canned/dry, ' +
  '3 for leafy greens, 5 for berries). ' +
  'IMPORTANT: Skip anything that isn\'t food (utensils, plates, shopping bag handles, hands, ' +
  'fridge shelves, walls). Only list items you can clearly identify — don\'t guess at ' +
  'partially-occluded items in the back of a fridge.';

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  // 1. Auth
  const userId = await getUserId(req);
  if (!userId) return json({ error: "unauthenticated", error_type: "unauthenticated" }, 401);

  // 2. Parse body
  let body: { image?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json body", error_type: "bad_request" }, 400);
  }
  const image = body?.image;
  if (!image || typeof image !== "string") {
    return json({ error: "missing image (base64-jpeg)", error_type: "bad_request" }, 400);
  }
  if (image.length > 6_000_000) {
    // ~4.5 MB decoded — same cap as scan-receipt. Client resizes to ~1600px
    // before upload (same expo-image-manipulator path v1.24 added), so this
    // should rarely fire; when it does, surface a typed error.
    return json({
      error: "Photo is too large. Try a smaller image.",
      error_type: "image_too_large",
    }, 413);
  }

  // 3. Rate limit (atomic increment; counts even if Claude call fails). 5/day
  // default — see SCAN_ITEMS_DAILY_LIMIT comment above for the rationale on
  // why this is tighter than scan_receipt's 10/day.
  let rl;
  try {
    rl = await checkAndIncrement(userId, "scan_items", DAILY_LIMIT);
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

  // 4. Call Anthropic (vision). Typed error responses so the client can
  // surface actionable copy instead of a generic "scan failed".
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
    const transient = /timeout|fetch|network|5\d\d|abort|reset|enotfound/i.test(msg);
    return json(
      {
        error: transient
          ? "Connection hiccup — try again."
          : "Couldn't read this photo. Try a clearer shot in better light, with items spread out.",
        error_type: transient ? "anthropic_transient" : "anthropic_permanent",
      },
      502,
    );
  }

  // 5. JSON extraction — retry once with stricter prompt if first pass fails.
  // Same pattern as scan-receipt v1.24 — catches the cases where Claude wraps
  // the array in commentary or markdown.
  let items = extractJson<unknown[]>(text);
  if (!Array.isArray(items)) {
    console.warn("bad model output on first pass, retrying once");
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
          error: "Couldn't identify items in this photo. Try a clearer shot with items spread out.",
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
