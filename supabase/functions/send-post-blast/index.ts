// send-post-blast — fan out a new blog post to every newsletter subscriber.
//
// Endpoint: POST /functions/v1/send-post-blast
// Auth:     x-cron-secret header (same shared secret as send-daily-digest).
//
// Request body:
//   {
//     "post_url":     "https://ok2eat.com/blog/cut-grocery-bill-25-percent.html",
//     "subject":      "How we cut our grocery bill 25%",
//     "preview":      "No coupons, no bulk runs. Just one change: stop buying what we already have.",  // optional
//     "excerpt_html": "<p>Optional override. If omitted, the function fetches post_url and extracts <article>.</p>",
//     "post_title":   "Optional override for the email H1. Falls back to <article-title> from the page.",
//     "dry_run":      false   // when true, returns the rendered HTML without creating/sending a broadcast
//   }
//
// What this does (production path):
//   1. Validates the secret + body.
//   2. Renders the email (founder-voice header, post excerpt, "Read the full post" CTA, footer with unsubscribe).
//   3. POSTs to Resend's Broadcasts API to create a draft tied to the existing
//      `RESEND_AUDIENCE_ID` (so unsubscribes / suppression are handled by Resend).
//   4. POSTs to /broadcasts/{id}/send to fire it immediately.
//   5. Returns { broadcast_id, audience_id, recipient_count? }.
//
// Why broadcasts (not per-recipient sends): Resend's Broadcasts endpoint
// natively respects each contact's `unsubscribed` flag and the audience
// suppression list, so we don't have to mirror that state in Supabase. It also
// gives us open/click analytics in the Resend dashboard for free.
//
// Required Supabase secrets:
//   RESEND_API_KEY      — same key used by subscribe-newsletter
//   RESEND_AUDIENCE_ID  — same audience used by subscribe-newsletter
//   CRON_SECRET         — shared with send-daily-digest; required on incoming reqs
//   BLAST_FROM          — optional; defaults to "Greg from ok2eat <hello@ok2eat.com>"
//   BLAST_REPLY_TO      — optional; defaults to "hello@ok2eat.com"
//
// Companion CLI: scripts/send_post_blast.py wraps this with a friendly Telegram
// confirmation + post-URL → subject auto-fill flow.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

interface BlastRequest {
  post_url:      string;
  subject:       string;
  preview?:      string;
  excerpt_html?: string;
  post_title?:   string;
  dry_run?:      boolean;
}

// Extract the inner HTML of <article>…</article> from a fetched page.
// Falls back to the raw HTML if no <article> tag is present.
function extractArticle(html: string): string {
  const m = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  return m ? m[1] : html;
}

// Pull the visible post title — looks for the first <h1 class="article-title">,
// then any <h1>, then a <title> tag, then returns null.
function extractTitle(html: string): string | null {
  let m = html.match(/<h1[^>]*class="[^"]*article-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : null;
}

// Render an email-safe HTML wrapper. Inline styles only — Gmail/Outlook strip
// <style> blocks. Fixed 600px content column. Cream/green palette matches
// the marketing site.
function renderEmail(opts: {
  postTitle:   string;
  postUrl:     string;
  excerptHtml: string;
  preview:     string;
}): string {
  const { postTitle, postUrl, excerptHtml, preview } = opts;
  const escapedTitle = postTitle.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapedPreview = preview.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapedTitle}</title>
</head>
<body style="margin:0;padding:0;background:#F0EADC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1C261C;line-height:1.6;">

<!-- Hidden preheader (shows in inbox previews under the subject) -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F0EADC;opacity:0;">
  ${escapedPreview}
</div>

<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F0EADC;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:#F7F3E8;border-radius:12px;overflow:hidden;">

        <!-- Header / brand strip -->
        <tr>
          <td style="padding:28px 32px 8px 32px;">
            <a href="https://ok2eat.com/" style="text-decoration:none;color:#3E721D;font-family:Georgia,serif;font-weight:700;font-size:22px;letter-spacing:-0.5px;">🥑 ok2eat</a>
            <div style="font-family:'DM Mono',ui-monospace,Menlo,monospace;font-size:11px;color:#6B8264;margin-top:4px;text-transform:uppercase;letter-spacing:1px;">// new post</div>
          </td>
        </tr>

        <!-- Headline -->
        <tr>
          <td style="padding:0 32px 16px 32px;">
            <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;margin:0;color:#1C261C;">
              ${escapedTitle}
            </h1>
          </td>
        </tr>

        <!-- Excerpt / body -->
        <tr>
          <td style="padding:0 32px 24px 32px;font-size:15px;color:#3A4A38;">
            ${excerptHtml}
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td align="center" style="padding:0 32px 32px 32px;">
            <a href="${postUrl}" style="display:inline-block;background:#3E721D;color:#F7F3E8;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;">Read the full post →</a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 32px 32px 32px;border-top:1px solid #E2DCCB;font-size:12px;color:#6B8264;text-align:center;">
            <p style="margin:0 0 8px 0;">You're getting this because you subscribed to ok2eat at <a href="https://ok2eat.com/blog/" style="color:#3E721D;">ok2eat.com/blog</a>.</p>
            <p style="margin:0;">
              <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#6B8264;text-decoration:underline;">Unsubscribe</a>
              &nbsp;·&nbsp;
              <a href="https://app.ok2eat.com" style="color:#6B8264;text-decoration:underline;">Open the app</a>
              &nbsp;·&nbsp;
              <a href="mailto:hello@ok2eat.com" style="color:#6B8264;text-decoration:underline;">Reply</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Soft auth — same pattern as send-daily-digest.
  const expected = Deno.env.get("CRON_SECRET");
  if (expected) {
    const got = req.headers.get("x-cron-secret");
    if (got !== expected) return json({ error: "forbidden" }, 403);
  }

  let body: BlastRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const postUrl  = (body?.post_url || "").trim();
  const subject  = (body?.subject || "").trim();
  const preview  = (body?.preview || "").trim();
  const dryRun   = Boolean(body?.dry_run);

  if (!postUrl || !/^https:\/\/ok2eat\.com\/blog\/.+\.html?$/.test(postUrl)) {
    return json({ error: "post_url must be an https://ok2eat.com/blog/...html URL" }, 400);
  }
  if (!subject || subject.length > 140) {
    return json({ error: "subject required (≤140 chars)" }, 400);
  }

  const apiKey     = Deno.env.get("RESEND_API_KEY");
  const audienceId = Deno.env.get("RESEND_AUDIENCE_ID");
  if (!apiKey || !audienceId) {
    console.error("Missing RESEND_API_KEY or RESEND_AUDIENCE_ID");
    return json({ error: "Newsletter not configured" }, 500);
  }
  const fromAddr   = Deno.env.get("BLAST_FROM")     || "Greg from ok2eat <hello@ok2eat.com>";
  const replyTo    = Deno.env.get("BLAST_REPLY_TO") || "hello@ok2eat.com";

  // Either use the caller-provided excerpt or fetch the post and strip out
  // <article>. Skipping the fetch is mostly useful for testing / dry-runs.
  let excerptHtml = (body?.excerpt_html || "").trim();
  let postTitle   = (body?.post_title   || "").trim();

  if (!excerptHtml || !postTitle) {
    try {
      const resp = await fetch(postUrl, { headers: { "User-Agent": "ok2eat-blast/1.0" } });
      if (!resp.ok) {
        return json({ error: `failed to fetch post_url: HTTP ${resp.status}` }, 502);
      }
      const html = await resp.text();
      if (!excerptHtml) excerptHtml = extractArticle(html);
      if (!postTitle)   postTitle   = extractTitle(html) || subject;
    } catch (e) {
      console.error("post fetch failed:", e);
      return json({ error: "failed to fetch post_url" }, 502);
    }
  }

  const html = renderEmail({
    postTitle,
    postUrl,
    excerptHtml,
    preview: preview || `${subject} — new on the ok2eat blog.`,
  });

  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      audience_id: audienceId,
      from: fromAddr,
      reply_to: replyTo,
      subject,
      post_title: postTitle,
      html_bytes: html.length,
      html_preview: html.slice(0, 800),
    });
  }

  // Build a slug-shaped name for the Resend dashboard so multiple blasts are
  // easy to disambiguate. e.g. "blog-2026-05-05-cut-grocery-bill-25-percent".
  const slug = postUrl.replace(/^https:\/\/ok2eat\.com\/blog\//, "").replace(/\.html?$/, "");
  const today = new Date().toISOString().slice(0, 10);
  const broadcastName = `blog-${today}-${slug}`.slice(0, 100);

  // 1. Create the broadcast (draft).
  let broadcastId: string;
  try {
    const createRes = await fetch("https://api.resend.com/broadcasts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        audience_id: audienceId,
        from:        fromAddr,
        subject,
        html,
        reply_to:    replyTo,
        name:        broadcastName,
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text().catch(() => "");
      console.error(`Resend create-broadcast ${createRes.status}: ${detail}`);
      return json({ error: "failed to create broadcast", status: createRes.status, detail }, 502);
    }
    const created = await createRes.json();
    broadcastId = created?.id;
    if (!broadcastId) {
      return json({ error: "Resend response missing broadcast id", raw: created }, 502);
    }
  } catch (e) {
    console.error("create-broadcast threw:", e);
    return json({ error: "create-broadcast network error" }, 502);
  }

  // 2. Send it. Resend's send endpoint is POST /broadcasts/{id}/send and
  //    accepts an empty body (or {scheduled_at} for delayed sends).
  try {
    const sendRes = await fetch(
      `https://api.resend.com/broadcasts/${broadcastId}/send`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type":  "application/json",
        },
        body: "{}",
      },
    );
    if (!sendRes.ok) {
      const detail = await sendRes.text().catch(() => "");
      console.error(`Resend send-broadcast ${sendRes.status}: ${detail}`);
      // The broadcast is created; surface the id so the caller can retry the
      // send manually from the Resend dashboard if this fails.
      return json({
        error: "broadcast created but send failed",
        broadcast_id: broadcastId,
        status: sendRes.status,
        detail,
      }, 502);
    }
  } catch (e) {
    console.error("send-broadcast threw:", e);
    return json({ error: "send-broadcast network error", broadcast_id: broadcastId }, 502);
  }

  console.log(`blast sent: ${broadcastId} (${broadcastName})`);
  return json({
    ok: true,
    broadcast_id: broadcastId,
    audience_id:  audienceId,
    name:         broadcastName,
    subject,
    post_url:     postUrl,
  });
});
