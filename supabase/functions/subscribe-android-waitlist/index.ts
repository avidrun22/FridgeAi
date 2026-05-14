// subscribe-android-waitlist — captures an email signup for the upcoming
// Android version of ok2eat (planned v1.21+).
//
// Endpoint: POST /functions/v1/subscribe-android-waitlist
// Body:    { "email": "...", "source": "/" }
//
// Dual-write pattern (analytics + email blast readiness):
//   1. INSERT into public.android_waitlist (source of truth, queryable).
//   2. POST to Resend audiences/{id}/contacts (so we can blast "Android is
//      live" from Resend with one click when the day comes).
//
// Either write failing alone is not fatal — we want to capture the email
// even if Resend is having a moment. Both failing returns 502.
//
// Required Supabase Function Secrets:
//   SUPABASE_URL              — (default secret)
//   SUPABASE_SERVICE_ROLE_KEY — (default secret)
//   RESEND_API_KEY            — same key used by subscribe-newsletter
//   RESEND_ANDROID_AUDIENCE_ID — UUID of a NEW Resend audience for Android
//                                 waitlist (different from blog newsletter)
//
// CORS: open to all origins because the form lives on ok2eat.com.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: { email?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const email  = (body?.email ?? "").trim().toLowerCase();
  const source = (body?.source ?? "").slice(0, 200);

  if (!email || !EMAIL_RE.test(email)) {
    return json({ error: "Invalid email" }, 400);
  }

  const supabaseUrl     = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendApiKey    = Deno.env.get("RESEND_API_KEY");
  const androidAudience = Deno.env.get("RESEND_ANDROID_AUDIENCE_ID");

  // Read country header from Cloudflare-style proxy (Supabase Edge runtime
  // sometimes surfaces a CF-IPCountry header for geo signals — purely
  // optional). Falls through to null if not present.
  const country = req.headers.get("cf-ipcountry") || req.headers.get("x-vercel-ip-country") || null;

  const supa = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Insert into Supabase. The unique constraint on email (citext) makes
  //    re-submits idempotent — we treat dupes as success so the user sees a
  //    friendly confirmation either way and we don't leak whether an email
  //    is already on the list (anti-enumeration).
  let dbOk = false;
  let alreadyOnList = false;
  try {
    const { error } = await supa
      .from("android_waitlist")
      .insert({ email, source, ua_country: country });
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

  // 2. Add to the Resend audience (best-effort; doesn't block on failure).
  let resendOk = false;
  if (resendApiKey && androidAudience) {
    try {
      const res = await fetch(
        `https://api.resend.com/audiences/${androidAudience}/contacts`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type":  "application/json",
          },
          body: JSON.stringify({ email, unsubscribed: false }),
        },
      );
      if (res.ok) {
        resendOk = true;
      } else {
        const detail = await res.text().catch(() => "");
        // 409 / "already exists" — that's fine, count it as success.
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

  // Decision: either write succeeded → 200. Both failed → 502.
  if (dbOk || resendOk) {
    console.log(`waitlist+ ${email} (source=${source}, db=${dbOk}, resend=${resendOk}, dupe=${alreadyOnList})`);
    return json({ ok: true, already_on_list: alreadyOnList });
  }
  return json({ error: "Couldn't save your signup. Try again in a minute." }, 502);
});
