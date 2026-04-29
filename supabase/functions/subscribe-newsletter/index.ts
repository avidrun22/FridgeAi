// subscribe-newsletter — adds an email to the ok2eat blog audience in Resend.
//
// Endpoint: POST /functions/v1/subscribe-newsletter
// Body:    { "email": "...", "source": "/blog/why-i-built-ok2eat.html" }
//
// Required Supabase secrets (set via `supabase secrets set` or the dashboard):
//   RESEND_API_KEY      — Resend API key with at least audiences.write scope
//   RESEND_AUDIENCE_ID  — UUID of the "ok2eat blog newsletter" audience
//
// Behavior:
//   - Validates email format.
//   - Calls Resend's POST /audiences/{id}/contacts to add the subscriber.
//   - Returns 200 on success or already-subscribed (idempotent for the user).
//   - Returns 4xx with a JSON error for client errors, 5xx for server errors.
//
// CORS: open to all origins because the form is on ok2eat.com (a different
// origin than the Edge Function host).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

  const apiKey     = Deno.env.get("RESEND_API_KEY");
  const audienceId = Deno.env.get("RESEND_AUDIENCE_ID");
  if (!apiKey || !audienceId) {
    console.error("Missing RESEND_API_KEY or RESEND_AUDIENCE_ID env var");
    return json({ error: "Newsletter not configured. Try again later." }, 500);
  }

  try {
    const res = await fetch(
      `https://api.resend.com/audiences/${audienceId}/contacts`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({ email, unsubscribed: false }),
      },
    );

    // Resend returns 200 on success and a 422-ish error on duplicate. We
    // treat duplicates as success so the user sees a friendly confirmation
    // either way (this also prevents email-enumeration via error-code probing).
    if (res.ok) {
      console.log(`subscribed ${email} (source=${source})`);
      return json({ ok: true });
    }

    const detail = await res.text().catch(() => "");
    if (res.status === 409 || /already exists|already subscribed/i.test(detail)) {
      console.log(`re-subscribed (already exists) ${email}`);
      return json({ ok: true, note: "already_subscribed" });
    }

    console.error(`Resend error ${res.status}: ${detail}`);
    return json({ error: "Couldn't add to newsletter. Try again later." }, 502);
  } catch (e) {
    console.error("Unexpected error:", e);
    return json({ error: "Unexpected error. Try again later." }, 500);
  }
});
