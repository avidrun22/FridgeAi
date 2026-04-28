// unsubscribe-email-digest — public endpoint linked from every digest email's
// footer (and the RFC 8058 List-Unsubscribe header). Accepts a token via GET
// or one-click POST and flips email_digest_enabled to false on the matching
// user_settings row.
//
// No auth required; the unsubscribe_token IS the credential. Tokens are UUIDs
// per row, generated server-side, never exposed except in the user's own
// emails — so guessing one to unsubscribe a stranger is computationally
// implausible.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function htmlPage(title: string, message: string, success: boolean): Response {
  const accent = success ? "#3E721D" : "#B23A3A";
  const icon = success ? "✓" : "⚠";
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title} · ok2eat</title>
<style>
  body { margin:0; padding:0; background:#F0EADC; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#1C261C; }
  .wrap { max-width:520px; margin:80px auto; padding:48px 32px; background:#F7F3E8; border-radius:12px; text-align:center; }
  h1 { font-family:Georgia,serif; font-size:28px; margin:0 0 12px; }
  .icon { font-size:48px; color:${accent}; margin-bottom:16px; }
  p { font-size:15px; line-height:1.6; color:#3A4A38; margin:0 0 16px; }
  .small { font-size:13px; color:#6B8264; margin-top:24px; }
  a { color:#3E721D; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="small">Changed your mind? Re-enable email digests in the ok2eat app under Settings.</p>
  </div>
</body>
</html>`;
  return new Response(body, {
    status: success ? 200 : 400,
    headers: { ...corsHeaders, "content-type": "text/html; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Token can come via query string (GET click from email) or POST body
  // (one-click unsubscribe per RFC 8058).
  let token: string | null = null;
  const url = new URL(req.url);
  token = url.searchParams.get("token");
  if (!token && req.method === "POST") {
    try {
      const ct = req.headers.get("content-type") || "";
      if (ct.includes("application/x-www-form-urlencoded")) {
        const form = await req.formData();
        token = (form.get("token") as string) || null;
      } else if (ct.includes("application/json")) {
        const j = await req.json();
        token = j.token || null;
      }
    } catch {
      // ignore parse errors; token stays null
    }
  }

  if (!token) {
    return htmlPage(
      "Invalid link",
      "This unsubscribe link is missing its token. If you reached this page from an email, try clicking the link directly instead of pasting fragments.",
      false,
    );
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await supa
    .from("user_settings")
    .update({ email_digest_enabled: false })
    .eq("unsubscribe_token", token)
    .select("user_id");

  if (error) {
    console.error("unsubscribe update failed:", error.message);
    return htmlPage(
      "Something went wrong",
      "We couldn't process the unsubscribe right now. Please try again in a few minutes, or email support@ok2eat.com.",
      false,
    );
  }

  if (!data || data.length === 0) {
    return htmlPage(
      "Link expired or invalid",
      "We couldn't find this unsubscribe token. It may have already been used, or the link may be from a very old email. If you're still receiving emails, please reply to one and we'll help.",
      false,
    );
  }

  return htmlPage(
    "You're unsubscribed",
    "You won't receive any more daily-digest emails from ok2eat. Push notifications (if you have them on) are unaffected.",
    true,
  );
});
