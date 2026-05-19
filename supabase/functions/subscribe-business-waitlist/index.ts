// subscribe-business-waitlist — captures B2B inquiries from the
// /for-business landing page on ok2eat.com (added 2026-05-15 after the
// r/InventoryManagement Toast-integration ask validated potential demand).
//
// Endpoint: POST /functions/v1/subscribe-business-waitlist
// Body:    { email, contact_name?, phone?, business_name, business_type?,
//           location_count?, sku_count_range?, pos_system?, description?,
//           source? }
//
// Dual-write pattern (same as subscribe-android-waitlist):
//   1. INSERT into public.business_waitlist (source of truth for triage).
//   2. POST to Resend audience (so we can blast pilot-invitation emails
//      from Resend with one click once Tier 1 is built).
//
// Either write failing alone is not fatal — we want to capture the lead
// even if Resend is having a moment. Both failing returns 502.
//
// Required Supabase Function Secrets:
//   SUPABASE_URL                  — (default secret)
//   SUPABASE_SERVICE_ROLE_KEY     — (default secret)
//   RESEND_API_KEY                — same key used by subscribe-newsletter
//   RESEND_BUSINESS_AUDIENCE_ID   — UUID of the Resend audience for B2B
//                                    leads. Create via Resend dashboard
//                                    before deploying or this is a no-op.
//
// CORS: open to all origins — form lives on ok2eat.com.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Enum-ish whitelists — we accept other values but normalize unknowns to
// "other" or null for analytics-friendliness.
const BUSINESS_TYPES = new Set([
  "grocery", "cafe", "restaurant", "catering", "juice_bar",
  "butcher", "convenience", "bakery", "deli", "ghost_kitchen", "other",
]);
const POS_SYSTEMS = new Set([
  "toast", "square", "clover", "lightspeed", "aloha",
  "shopify_pos", "revel", "other", "none",
]);
const SKU_COUNT_RANGES = new Set([
  "<100", "100-500", "500-1000", "1000-5000", "5000+",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function clamp(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function normalizeFromSet(v: unknown, set: Set<string>): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return set.has(t) ? t : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // ─── Spam defense (silent reject) ───────────────────────────────────────
  // Two checks. Both return 200 OK with {ok:true} so bots think they
  // succeeded — that way they don't iterate on bypasses. The row is never
  // inserted into business_waitlist and never sent to Resend.
  //
  //   1. Honeypot: hidden "website" field on the form. Real humans don't
  //      see it; bots that auto-fill inputs do. Any non-empty value here
  //      is a spam signature.
  //   2. Time trap: real humans take 5+ seconds to fill out the 9-field
  //      form. Anything submitted in under 3,000ms is almost certainly a
  //      headless-browser bot. We also reject negative or absurdly large
  //      elapsed_ms values (clock drift / replay attacks).
  //
  // Both checks fire silently; we log the reason for analytics so we can
  // tune thresholds later if a real lead trips the filter.
  const honeypot = typeof body.website === "string" ? body.website.trim() : "";
  if (honeypot) {
    console.log(`business-waitlist: honeypot hit (website=${honeypot.slice(0, 60)}); silent reject`);
    return json({ ok: true, already_on_list: false });
  }
  const elapsed = typeof body.elapsed_ms === "number" ? body.elapsed_ms : 0;
  if (elapsed > 0 && elapsed < 3000) {
    console.log(`business-waitlist: time-trap hit (elapsed_ms=${elapsed}); silent reject`);
    return json({ ok: true, already_on_list: false });
  }
  // ────────────────────────────────────────────────────────────────────────

  const email = clamp(body.email, 320)?.toLowerCase() ?? "";
  if (!email || !EMAIL_RE.test(email)) {
    return json({ error: "Invalid email" }, 400);
  }

  const business_name = clamp(body.business_name, 200);
  if (!business_name) {
    return json({ error: "Business name is required" }, 400);
  }

  // Optional fields — normalize + cap length.
  const contact_name    = clamp(body.contact_name, 200);
  const phone           = clamp(body.phone, 40);
  const business_type   = normalizeFromSet(body.business_type, BUSINESS_TYPES);
  const pos_system      = normalizeFromSet(body.pos_system, POS_SYSTEMS);
  const sku_count_range = normalizeFromSet(body.sku_count_range, SKU_COUNT_RANGES);
  const description     = clamp(body.description, 2000);
  const source          = clamp(body.source, 200);

  // location_count: accept ints 1..10000, else null.
  let location_count: number | null = null;
  if (typeof body.location_count === "number" && Number.isFinite(body.location_count)) {
    const n = Math.floor(body.location_count);
    if (n >= 1 && n <= 10000) location_count = n;
  } else if (typeof body.location_count === "string" && body.location_count.trim()) {
    const n = Math.floor(Number(body.location_count));
    if (Number.isFinite(n) && n >= 1 && n <= 10000) location_count = n;
  }

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendApiKey   = Deno.env.get("RESEND_API_KEY");
  const audienceId     = Deno.env.get("RESEND_BUSINESS_AUDIENCE_ID");

  const country = req.headers.get("cf-ipcountry") || req.headers.get("x-vercel-ip-country") || null;

  const supa = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Insert into Supabase. Unique constraint on email (citext) makes
  //    re-submits idempotent — treat dupes as success so the user sees
  //    a friendly confirmation and we don't leak whether an email is
  //    already on the list (anti-enumeration).
  let dbOk = false;
  let alreadyOnList = false;
  try {
    const { error } = await supa
      .from("business_waitlist")
      .insert({
        email,
        contact_name,
        phone,
        business_name,
        business_type,
        location_count,
        sku_count_range,
        pos_system,
        description,
        source,
        ua_country: country,
      });
    if (!error) {
      dbOk = true;
    } else if (
      error.code === "23505" || /duplicate key|already exists/i.test(error.message)
    ) {
      dbOk = true;
      alreadyOnList = true;
    } else {
      console.error("supabase insert failed:", error.message);
    }
  } catch (e) {
    console.error("supabase insert threw:", (e as Error)?.message || e);
  }

  // 2. Resend audience (best-effort). Resend's contact API supports
  //    first_name/last_name; we map contact_name → first_name for the
  //    "Hi {first_name}" templating most B2B emails use.
  let resendOk = false;
  if (resendApiKey && audienceId) {
    try {
      const res = await fetch(
        `https://api.resend.com/audiences/${audienceId}/contacts`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type":  "application/json",
          },
          body: JSON.stringify({
            email,
            first_name: contact_name || business_name,
            unsubscribed: false,
          }),
        },
      );
      if (res.ok) {
        resendOk = true;
      } else {
        const detail = await res.text().catch(() => "");
        if (res.status === 409 || /already exists|already subscribed/i.test(detail)) {
          resendOk = true;
        } else {
          console.error(`resend add-contact ${res.status}: ${detail}`);
        }
      }
    } catch (e) {
      console.error("resend add-contact threw:", (e as Error)?.message || e);
    }
  }

  if (dbOk || resendOk) {
    console.log(`business-waitlist+ ${email} (${business_name}, ${business_type || "?"}, ${pos_system || "?"}, db=${dbOk}, resend=${resendOk}, dupe=${alreadyOnList})`);
    return json({ ok: true, already_on_list: alreadyOnList });
  }
  return json({ error: "Couldn't save your inquiry. Try again in a minute." }, 502);
});
