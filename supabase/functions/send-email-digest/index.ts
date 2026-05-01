// send-email-digest — fires once per hour via pg_cron, alongside send-daily-digest.
// For every user whose digest_hour == current hour in their timezone AND who
// has email_digest_enabled = true:
//   - load their auth email
//   - load expiring/expired fridge items
//   - render an HTML email and send via Resend
//   - record last_email_sent_at on success
//
// Auth: matches send-daily-digest — requires a shared CRON_SECRET header.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_URL = "https://api.resend.com/emails";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

// Current hour 0–23 in the given IANA timezone.
function hourInTimezone(tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", hour12: false,
    });
    const h = parseInt(fmt.format(new Date()), 10);
    if (h === 24) return 0;
    return h;
  } catch {
    return -1;
  }
}

// "Apr 28, 2026" in the user's timezone.
function dateLabel(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "long", month: "short", day: "numeric",
    }).format(new Date());
  } catch {
    return new Date().toDateString();
  }
}

interface UserRow {
  user_id: string;
  digest_hour: number;
  digest_timezone: string;
  expiring_within_days: number;
  unsubscribe_token: string;
}

interface FridgeItem {
  name: string;
  quantity: string | number | null;
  unit: string | null;
  expiry_date: string;
}

function formatItemPlain(it: FridgeItem): string {
  const q = it.quantity != null ? String(it.quantity) : "";
  const u = (it.unit || "").trim();
  const qty = u ? `${q} ${u}` : q;
  return qty.trim() ? `${it.name} (${qty.trim()})` : it.name;
}

function daysUntilExpiry(it: FridgeItem): number {
  const dt = new Date(it.expiry_date).getTime();
  if (Number.isNaN(dt)) return Infinity;
  const diff = dt - Date.now();
  return Math.ceil(diff / 86400000);
}

function categorize(items: FridgeItem[]) {
  const expiring: FridgeItem[] = [];
  const expired: FridgeItem[] = [];
  for (const it of items) {
    const d = daysUntilExpiry(it);
    if (!Number.isFinite(d)) continue;
    if (d < 0) expired.push(it);
    else expiring.push(it);
  }
  // Sort expiring soonest-first; expired most-overdue-first
  expiring.sort((a, b) => daysUntilExpiry(a) - daysUntilExpiry(b));
  expired.sort((a, b) => daysUntilExpiry(a) - daysUntilExpiry(b));
  return { expiring, expired };
}

// Pick top items (by name only) to seed recipe-search URLs. Prefers expiring
// items so the suggestions actually help the user use what's about to go bad.
function topItemNames(expiring: FridgeItem[], expired: FridgeItem[], limit = 4): string[] {
  const names: string[] = [];
  for (const it of [...expiring, ...expired]) {
    if (!names.includes(it.name)) names.push(it.name);
    if (names.length >= limit) break;
  }
  return names;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function expiryLabel(it: FridgeItem): string {
  const d = daysUntilExpiry(it);
  if (d < 0) return d === -1 ? "1 day ago" : `${-d} days ago`;
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  return `in ${d} days`;
}

function buildSubject(expiringCount: number, expiredCount: number): string {
  if (expiredCount > 0 && expiringCount > 0) {
    return `🥑 ${expiringCount + expiredCount} fridge items need attention`;
  }
  if (expiredCount > 0) {
    return expiredCount === 1
      ? `🥑 1 item to toss in your fridge`
      : `🥑 ${expiredCount} items to toss in your fridge`;
  }
  if (expiringCount > 0) {
    return expiringCount === 1
      ? `🥑 1 item expiring soon`
      : `🥑 ${expiringCount} items expiring soon`;
  }
  return "🥑 ok2eat daily digest";
}

function buildEmailHtml(p: {
  dateLabel: string;
  expiring: FridgeItem[];
  expired: FridgeItem[];
  recipeQuery: string;
  unsubscribeUrl: string;
  appUrl: string;
}): string {
  const recipeQ = encodeURIComponent(p.recipeQuery);
  const allRecipes = `https://www.allrecipes.com/search?q=${recipeQ}`;
  const nytCooking = `https://cooking.nytimes.com/search?q=${recipeQ}`;
  const epicurious = `https://www.epicurious.com/search/${recipeQ}`;

  const itemRow = (it: FridgeItem, dim = false) => {
    const expiryClr = dim ? "#B23A3A" : "#3E721D";
    const expiryTxt = dim ? `expired ${escapeHtml(expiryLabel(it))}` : `expires ${escapeHtml(expiryLabel(it))}`;
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #E5DFCE;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-size:15px;color:#1C261C;font-weight:600;">${escapeHtml(formatItemPlain(it))}</td>
            <td align="right" style="font-size:13px;color:${expiryClr};font-family:'DM Mono',monospace;white-space:nowrap;">${expiryTxt}</td>
          </tr></table>
        </td>
      </tr>`;
  };

  const expiringSection = p.expiring.length === 0 ? "" : `
    <tr><td style="padding:32px 32px 0;">
      <h2 style="margin:0 0 12px;font-family:'Georgia',serif;font-size:20px;font-weight:700;color:#1C261C;">⏳ Expiring soon</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${p.expiring.slice(0, 8).map(it => itemRow(it, false)).join("")}
      </table>
      ${p.expiring.length > 8 ? `<p style="margin:12px 0 0;font-size:13px;color:#6B8264;">…and ${p.expiring.length - 8} more in the app</p>` : ""}
    </td></tr>`;

  const expiredSection = p.expired.length === 0 ? "" : `
    <tr><td style="padding:24px 32px 0;">
      <h2 style="margin:0 0 12px;font-family:'Georgia',serif;font-size:20px;font-weight:700;color:#1C261C;">🗑 Already expired</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${p.expired.slice(0, 8).map(it => itemRow(it, true)).join("")}
      </table>
      ${p.expired.length > 8 ? `<p style="margin:12px 0 0;font-size:13px;color:#6B8264;">…and ${p.expired.length - 8} more in the app</p>` : ""}
    </td></tr>`;

  const recipeSection = !p.recipeQuery ? "" : `
    <tr><td style="padding:32px 32px 8px;">
      <h2 style="margin:0 0 8px;font-family:'Georgia',serif;font-size:20px;font-weight:700;color:#1C261C;">🍳 Recipe ideas</h2>
      <p style="margin:0 0 16px;font-size:14px;color:#3A4A38;">Search for something to cook with what's expiring:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="padding:0 8px 8px 0;"><a href="${allRecipes}" style="display:inline-block;padding:10px 16px;background:#3E721D;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">AllRecipes →</a></td>
        <td style="padding:0 8px 8px 0;"><a href="${nytCooking}" style="display:inline-block;padding:10px 16px;background:#3E721D;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">NYT Cooking →</a></td>
        <td style="padding:0 0 8px 0;"><a href="${epicurious}" style="display:inline-block;padding:10px 16px;background:#3E721D;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">Epicurious →</a></td>
      </tr></table>
      <p style="margin:8px 0 0;font-size:11px;color:#6B8264;font-family:'DM Mono',monospace;">Searches: ${escapeHtml(p.recipeQuery)}</p>
    </td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>ok2eat — ${escapeHtml(p.dateLabel)}</title>
</head>
<body style="margin:0;padding:0;background:#F0EADC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F0EADC;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#F7F3E8;border-radius:12px;overflow:hidden;">

      <!-- Header -->
      <tr><td style="padding:32px 32px 24px;border-bottom:1px solid #E5DFCE;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="font-size:22px;font-weight:700;color:#3E721D;">🥑 ok2eat</td>
          <td align="right" style="font-size:12px;color:#6B8264;font-family:'DM Mono',monospace;">${escapeHtml(p.dateLabel)}</td>
        </tr></table>
      </td></tr>

      <!-- Hero -->
      <tr><td style="padding:32px 32px 8px;">
        <h1 style="margin:0 0 8px;font-family:'Georgia',serif;font-size:28px;font-weight:700;color:#1C261C;letter-spacing:-0.5px;">Your fridge today</h1>
        <p style="margin:0;font-size:15px;color:#3A4A38;line-height:1.5;">${p.expired.length + p.expiring.length} item${p.expired.length + p.expiring.length === 1 ? "" : "s"} need attention.</p>
      </td></tr>

      ${expiringSection}
      ${expiredSection}
      ${recipeSection}

      <!-- App CTA -->
      <tr><td style="padding:32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" style="padding:20px;background:#1C261C;border-radius:10px;">
            <a href="${escapeHtml(p.appUrl)}" style="display:inline-block;color:#F0EADC;text-decoration:none;font-size:16px;font-weight:700;">Open ok2eat →</a>
          </td>
        </tr></table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:24px 32px 32px;border-top:1px solid #E5DFCE;">
        <p style="margin:0 0 6px;font-size:11px;color:#6B8264;font-family:'DM Mono',monospace;">ok2eat · Less waste, more savings.</p>
        <p style="margin:0;font-size:11px;color:#6B8264;line-height:1.6;">
          <a href="https://ok2eat.com/#privacy" style="color:#6B8264;text-decoration:underline;">Privacy</a>
          &nbsp;·&nbsp;
          <a href="https://ok2eat.com/#support" style="color:#6B8264;text-decoration:underline;">Support</a>
          &nbsp;·&nbsp;
          <a href="${escapeHtml(p.unsubscribeUrl)}" style="color:#6B8264;text-decoration:underline;">Unsubscribe</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function buildEmailText(p: {
  dateLabel: string;
  expiring: FridgeItem[];
  expired: FridgeItem[];
  recipeQuery: string;
  unsubscribeUrl: string;
  appUrl: string;
}): string {
  const lines: string[] = [];
  lines.push(`ok2eat — ${p.dateLabel}`);
  lines.push("");
  lines.push(`Your fridge today: ${p.expired.length + p.expiring.length} items need attention.`);
  lines.push("");
  if (p.expiring.length) {
    lines.push("Expiring soon:");
    for (const it of p.expiring.slice(0, 8)) {
      lines.push(`  · ${formatItemPlain(it)} — expires ${expiryLabel(it)}`);
    }
    if (p.expiring.length > 8) lines.push(`  · …and ${p.expiring.length - 8} more`);
    lines.push("");
  }
  if (p.expired.length) {
    lines.push("Already expired:");
    for (const it of p.expired.slice(0, 8)) {
      lines.push(`  · ${formatItemPlain(it)} — ${expiryLabel(it)}`);
    }
    if (p.expired.length > 8) lines.push(`  · …and ${p.expired.length - 8} more`);
    lines.push("");
  }
  if (p.recipeQuery) {
    const q = encodeURIComponent(p.recipeQuery);
    lines.push("Recipe ideas:");
    lines.push(`  · AllRecipes:    https://www.allrecipes.com/search?q=${q}`);
    lines.push(`  · NYT Cooking:   https://cooking.nytimes.com/search?q=${q}`);
    lines.push(`  · Epicurious:    https://www.epicurious.com/search/${q}`);
    lines.push("");
  }
  lines.push(`Open ok2eat: ${p.appUrl}`);
  lines.push("");
  lines.push(`Unsubscribe: ${p.unsubscribeUrl}`);
  lines.push("Privacy: https://ok2eat.com/#privacy");
  return lines.join("\n");
}

async function sendResendEmail(args: {
  apiKey: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const resp = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `ok2eat <${args.fromEmail}>`,
      to: args.toEmail,
      reply_to: "hello@ok2eat.com",
      subject: args.subject,
      html: args.html,
      text: args.text,
      headers: {
        // RFC 8058 one-click unsubscribe (Gmail/Apple Mail honor this)
        "List-Unsubscribe": `<${args.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  const body = await resp.text();
  return { ok: resp.ok, status: resp.status, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Cron-secret guard, same pattern as send-daily-digest
  const expected = Deno.env.get("CRON_SECRET");
  if (expected) {
    const got = req.headers.get("x-cron-secret");
    if (got !== expected) return json({ error: "forbidden" }, 403);
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "digest@ok2eat.com";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  if (!resendApiKey) return json({ error: "RESEND_API_KEY not configured" }, 500);

  const supa = serviceClient();

  // Pull all candidate users (email-opted-in + push-notifications-on so we
  // share the digest_hour/timezone schedule with the push channel)
  const { data: settings, error: settingsErr } = await supa
    .from("user_settings")
    .select("user_id, digest_hour, digest_timezone, expiring_within_days, unsubscribe_token")
    .eq("notifications_enabled", true)
    .eq("email_digest_enabled", true);
  if (settingsErr) return json({ error: settingsErr.message }, 500);

  const targets: UserRow[] = (settings || []).filter((row: UserRow) => {
    return hourInTimezone(row.digest_timezone) === row.digest_hour;
  });

  let emailsSent = 0;
  let usersChecked = 0;
  const failures: { user_id: string; reason: string }[] = [];

  for (const row of targets) {
    usersChecked += 1;

    // Look up the user's email via the auth admin API
    const { data: userData, error: userErr } = await supa.auth.admin.getUserById(row.user_id);
    if (userErr || !userData?.user?.email) {
      failures.push({ user_id: row.user_id, reason: userErr?.message || "no email on auth user" });
      continue;
    }
    const toEmail = userData.user.email;

    // Pull their items inside the expiring window
    const cutoff = new Date(Date.now() + row.expiring_within_days * 86400000).toISOString();
    const { data: items, error: itemsErr } = await supa
      .from("fridge_items")
      .select("name, quantity, unit, expiry_date")
      .eq("user_id", row.user_id)
      .lte("expiry_date", cutoff);
    if (itemsErr) {
      failures.push({ user_id: row.user_id, reason: `items: ${itemsErr.message}` });
      continue;
    }

    const { expiring, expired } = categorize((items || []) as FridgeItem[]);
    if (expiring.length === 0 && expired.length === 0) continue; // nothing to say

    const recipeNames = topItemNames(expiring, expired, 4);
    const recipeQuery = recipeNames.join(", ");

    const unsubscribeUrl = `${supabaseUrl}/functions/v1/unsubscribe-email-digest?token=${row.unsubscribe_token}`;
    // v1.1.0 — Universal Link. iOS opens ok2eat directly when installed (one
    // tap from email). Falls back to ok2eat.com landing for non-install
    // users. Requires apple-app-site-association at /.well-known/ + the
    // associatedDomains entitlement in v1.1.0+ of the app.
    const appUrl = "https://ok2eat.com/open";

    const subject = buildSubject(expiring.length, expired.length);
    const html = buildEmailHtml({
      dateLabel: dateLabel(row.digest_timezone),
      expiring, expired, recipeQuery, unsubscribeUrl, appUrl,
    });
    const text = buildEmailText({
      dateLabel: dateLabel(row.digest_timezone),
      expiring, expired, recipeQuery, unsubscribeUrl, appUrl,
    });

    const result = await sendResendEmail({
      apiKey: resendApiKey,
      fromEmail,
      toEmail,
      subject,
      html,
      text,
      unsubscribeUrl,
    });

    if (!result.ok) {
      failures.push({ user_id: row.user_id, reason: `resend ${result.status}: ${result.body.slice(0, 200)}` });
      continue;
    }

    // Record successful send
    const { error: updateErr } = await supa
      .from("user_settings")
      .update({ last_email_sent_at: new Date().toISOString() })
      .eq("user_id", row.user_id);
    if (updateErr) {
      console.error("last_email_sent_at update failed for", row.user_id, updateErr.message);
      // Non-fatal — email already sent.
    }

    emailsSent += 1;
  }

  return json({ ok: true, usersChecked, emailsSent, failures });
});
