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
import { getDailyRecipesForUser, type DailyRecipe } from "../_shared/daily_recipes.ts";

const RESEND_URL = "https://api.resend.com/emails";

// v1.19 — PostHog server-side capture for digest deliverability tracking.
// Public project API key (same one the iOS/web clients use) — safe in env.
// Required to verify the Apple Private Relay fix actually delivers mail and
// to surface any future address-class deliverability regressions in our
// daily PostHog report. Set as a Supabase Function Secret named
// POSTHOG_API_KEY (the public project key starting with `phc_`).
const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/capture/";

/**
 * Fire-and-forget PostHog event from the Edge Function.
 *
 * We use this to capture `email_digest_sent` per recipient with an
 * `is_apple_relay` boolean so we can validate Apple Private Relay
 * deliverability after registering ok2eat.com as an approved sender.
 *
 * Failure modes are silent — we never want a PostHog hiccup to block a
 * legitimate email send. Returns a Promise the caller can choose to await
 * or ignore (we don't await, to keep digest throughput high).
 */
async function posthogCapture(
  apiKey: string | undefined,
  event: string,
  distinctId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  if (!apiKey) return;
  try {
    await fetch(POSTHOG_CAPTURE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event,
        distinct_id: distinctId,
        properties: {
          $lib: "ok2eat-edge-fn",
          $lib_version: "v1.19",
          ...properties,
        },
        timestamp: new Date().toISOString(),
      }),
      // Don't keep the event loop alive waiting for PostHog.
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    console.warn("[posthog] capture failed:", (e as Error)?.message || e);
  }
}

/** Best-effort Apple Private Relay detector. Apple uses two relay domains
 *  in practice: privaterelay.appleid.com (the standard one) and
 *  appleid.com aliases via Hide My Email. Case-insensitive match. */
function isApplePrivateRelay(email: string): boolean {
  const e = (email || "").toLowerCase().trim();
  return e.endsWith("@privaterelay.appleid.com");
}

// Featured blog post — surfaces a "// new on the blog" banner at the top of
// every digest. Edit `until` to take it down, or set FEATURED_POST = null to
// remove the slot entirely. Keep `until` ~7 days past publish so the post
// gets a full week of inbox exposure but doesn't outstay its welcome.
//
// To swap in a future post: change all four fields. The block renders only
// while now() < new Date(until + 'T23:59:59Z') AND FEATURED_POST is truthy.
const FEATURED_POST: {
  title: string;
  blurb: string;
  url: string;
  until: string; // YYYY-MM-DD; banner hides itself after this date
} | null = {
  title: "Groceries jumped 0.7% in April. Food waste just got more expensive too.",
  blurb: "April's CPI showed the biggest one-month grocery jump in nearly four years. When prices climb and 30% of what you buy still gets thrown away, the real cost increase is much bigger than the headline.",
  url: "https://ok2eat.com/blog/april-grocery-inflation.html?utm_source=email_digest&utm_medium=email&utm_campaign=blog_announce_grocery_inflation",
  until: "2026-05-21",
};

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
  // v1.19 — Stripped the leading 🥑 emoji prefix. Spam classifiers (especially
  // Gmail's) weight emoji-prefixed subjects as promotional/marketing, which
  // pushed early digests into Junk (confirmed via Greg's own inbox 5/14).
  // The body keeps the brand emoji + visual identity; subjects stay plain
  // text so transactional-class signals win.
  if (expiredCount > 0 && expiringCount > 0) {
    return `${expiringCount + expiredCount} fridge items need attention`;
  }
  if (expiredCount > 0) {
    return expiredCount === 1
      ? "1 item to toss in your fridge"
      : `${expiredCount} items to toss in your fridge`;
  }
  if (expiringCount > 0) {
    return expiringCount === 1
      ? "1 item expiring soon"
      : `${expiringCount} items expiring soon`;
  }
  // Empty-fridge / nothing-to-toss case. Neutral framing so the user still
  // opens it for the blog / recipe content.
  return "Your daily ok2eat";
}

function buildEmailHtml(p: {
  dateLabel: string;
  expiring: FridgeItem[];
  expired: FridgeItem[];
  recipeQuery: string;
  unsubscribeUrl: string;
  appUrl: string;
  /** Total fridge_items count (any expiry). When 0, hero switches to the
   *  empty-fridge activation variant. */
  totalItems: number;
  /** v1.18 — personalized recipes from getDailyRecipesForUser. Empty array
   *  hides the section (e.g. Anthropic failed, or fridge is empty). */
  recipes: DailyRecipe[];
}): string {

  // Item rows — give each one a real surface (white card on the cream
  // section background) so the list reads as scannable cards rather than
  // a thin-bordered table. Expiry tag is a pill with stronger color
  // contrast so urgency is the first thing the eye lands on.
  const itemRow = (it: FridgeItem, dim = false) => {
    const pillBg = dim ? "#FBE6E0" : "#E4F0D6";
    const pillClr = dim ? "#9B2A18" : "#2A4F12";
    const expiryTxt = dim ? `expired ${escapeHtml(expiryLabel(it))}` : `expires ${escapeHtml(expiryLabel(it))}`;
    return `
      <tr>
        <td style="padding:6px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border-radius:10px;border:1px solid #E5DFCE;">
            <tr>
              <td style="padding:14px 16px;font-size:16px;color:#1C261C;font-weight:700;font-family:'Georgia',serif;">${escapeHtml(formatItemPlain(it))}</td>
              <td align="right" style="padding:14px 16px;white-space:nowrap;">
                <span style="display:inline-block;padding:5px 11px;background:${pillBg};color:${pillClr};border-radius:999px;font-size:12px;font-family:'DM Mono',monospace;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;">${expiryTxt}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  };

  // Featured-post block — sits after Recipe ideas (the digest's main payload
  // is fridge urgency + recipes; the blog is supplemental reading, not the
  // lead). Two-part structure: a Georgia-serif title OUTSIDE the card so it
  // reads as a peer of "Your fridge today," then a cream-tinted card with a
  // green left border holding the blurb + CTA. Self-hides after `until` so
  // a stale link can't outlive a deploy.
  const featuredSection = (() => {
    if (!FEATURED_POST) return "";
    try {
      const cutoff = new Date(FEATURED_POST.until + "T23:59:59Z").getTime();
      if (Date.now() > cutoff) return "";
    } catch { /* malformed date — skip section rather than crash send */
      return "";
    }
    return `
    <tr><td style="padding:32px 32px 8px;">
      <h2 style="margin:0 0 14px;font-family:'Georgia',serif;font-size:28px;font-weight:700;color:#1C261C;letter-spacing:-0.5px;line-height:1.2;">Latest from the blog</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:20px 24px;background:#EDE6D2;border-radius:12px;border-left:4px solid #3E721D;">
          <a href="${escapeHtml(FEATURED_POST.url)}" style="text-decoration:none;color:inherit;">
            <h3 style="margin:0 0 10px;font-family:'Georgia',serif;font-size:20px;font-weight:700;color:#1C261C;line-height:1.3;letter-spacing:-0.2px;">${escapeHtml(FEATURED_POST.title)}</h3>
          </a>
          <p style="margin:0 0 12px;font-size:15px;color:#3A4A38;line-height:1.5;">${escapeHtml(FEATURED_POST.blurb)}</p>
          <a href="${escapeHtml(FEATURED_POST.url)}" style="font-size:14px;color:#3E721D;font-weight:700;text-decoration:none;">Read the full breakdown →</a>
        </td></tr>
      </table>
    </td></tr>`;
  })();

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

  // v1.18 — native recipe cards. Replaces the AllRecipes/NYT/Epicurious
  // search buttons with personalized recipes from getDailyRecipesForUser.
  // Each card deep-links into the iOS app via Universal Link
  // (https://ok2eat.com/recipes/{id}) — see iOS handler for the routing
  // logic. Web fallback opens the same URL on ok2eat.com which renders the
  // recipe inline.
  //
  // Hide the section entirely if Claude returned nothing (network failure,
  // empty fridge, etc.) — we're done with external search buttons; this is
  // the differentiator now.
  const recipeCard = (r: DailyRecipe) => {
    const usesHint = (r.uses_items || []).slice(0, 4).join(", ");
    const deepLink = `https://ok2eat.com/recipes/${encodeURIComponent(r.id)}?utm_source=email_digest&utm_medium=email&utm_campaign=daily_recipe`;
    return `
      <tr><td style="padding:6px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border-radius:10px;border:1px solid #E5DFCE;">
          <tr><td style="padding:16px 18px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:24px;width:40px;vertical-align:top;line-height:1;padding-top:2px;">${escapeHtml(r.emoji || "🍳")}</td>
                <td style="vertical-align:top;">
                  <a href="${escapeHtml(deepLink)}" style="text-decoration:none;color:inherit;">
                    <h3 style="margin:0 0 4px;font-family:'Georgia',serif;font-size:17px;font-weight:700;color:#1C261C;line-height:1.25;">${escapeHtml(r.name)}</h3>
                  </a>
                  ${r.time ? `<p style="margin:0 0 6px;font-size:11px;color:#6B8264;font-family:'DM Mono',monospace;letter-spacing:0.3px;text-transform:uppercase;">${escapeHtml(r.time)}${r.difficulty ? ` · ${escapeHtml(r.difficulty)}` : ""}</p>` : ""}
                  ${r.description ? `<p style="margin:0 0 8px;font-size:14px;color:#3A4A38;line-height:1.45;">${escapeHtml(r.description)}</p>` : ""}
                  ${usesHint ? `<p style="margin:0 0 8px;font-size:12px;color:#3E721D;"><span style="font-family:'DM Mono',monospace;letter-spacing:0.3px;text-transform:uppercase;font-size:10px;font-weight:700;">Uses:</span> ${escapeHtml(usesHint)}</p>` : ""}
                  <a href="${escapeHtml(deepLink)}" style="font-size:13px;color:#3E721D;font-weight:700;text-decoration:none;">Open in ok2eat →</a>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>`;
  };

  const recipeSection = (p.recipes && p.recipes.length > 0) ? `
    <tr><td style="padding:32px 32px 0;">
      <h2 style="margin:0 0 4px;font-family:'Georgia',serif;font-size:20px;font-weight:700;color:#1C261C;">🍳 Tonight's recipe ideas</h2>
      <p style="margin:0 0 16px;font-size:13px;color:#6B8264;">Built from what's in your fridge right now.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${p.recipes.slice(0, 3).map(recipeCard).join("")}
      </table>
    </td></tr>` : "";

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

      <!-- Hero — three variants:
           1. Items need attention → "Your fridge today" + colored pill (green
              when only expiring, red when anything's expired)
           2. Has items but none expiring → "Your fridge today" + green
              "all good" pill, so the digest still feels like a fridge update
           3. Empty fridge → "Your fridge is empty" + activation CTA,
              targeting signed-up users who haven't added items yet
           v1.18: removed the "skip if both empty" gate on the function side,
           so we now always reach this template. -->
      <tr><td style="padding:36px 32px 12px;">
        ${(() => {
          const total = p.expired.length + p.expiring.length;
          const isEmptyFridge = (p.totalItems || 0) === 0;

          if (isEmptyFridge) {
            return `
              <h1 style="margin:0 0 14px;font-family:'Georgia',serif;font-size:34px;font-weight:700;color:#1C261C;letter-spacing:-0.8px;line-height:1.1;">Your fridge is empty.</h1>
              <p style="margin:0 0 18px;font-size:16px;color:#3A4A38;line-height:1.55;">Add items to get recipe suggestions and keep track of what's expiring.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="background:#1C261C;border-radius:10px;">
                  <a href="${escapeHtml(p.appUrl)}" style="display:inline-block;padding:14px 22px;color:#F0EADC;text-decoration:none;font-size:15px;font-weight:700;">Add your first item →</a>
                </td>
              </tr></table>
            `;
          }

          if (total === 0) {
            return `
              <h1 style="margin:0 0 14px;font-family:'Georgia',serif;font-size:34px;font-weight:700;color:#1C261C;letter-spacing:-0.8px;line-height:1.1;">Your fridge today</h1>
              <p style="margin:0;font-size:15px;color:#3A4A38;line-height:1.6;"><span style="display:inline-block;padding:6px 14px;background:#E4F0D6;color:#2A4F12;border-radius:999px;font-size:13px;font-family:'DM Mono',monospace;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;">All good — nothing needs attention</span></p>
            `;
          }

          const hasExpired = p.expired.length > 0;
          const pillBg = hasExpired ? "#FBE6E0" : "#E4F0D6";
          const pillClr = hasExpired ? "#9B2A18" : "#2A4F12";
          return `
            <h1 style="margin:0 0 14px;font-family:'Georgia',serif;font-size:34px;font-weight:700;color:#1C261C;letter-spacing:-0.8px;line-height:1.1;">Your fridge today</h1>
            <p style="margin:0;font-size:15px;color:#3A4A38;line-height:1.6;"><span style="display:inline-block;padding:6px 14px;background:${pillBg};color:${pillClr};border-radius:999px;font-size:13px;font-family:'DM Mono',monospace;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;">${total} item${total === 1 ? "" : "s"} need attention</span></p>
          `;
        })()}
      </td></tr>

      ${expiringSection}
      ${expiredSection}
      ${recipeSection}

      <!-- Featured blog post (after recipes; self-expires by FEATURED_POST.until) -->
      ${featuredSection}

      <!-- App CTA -->
      <tr><td style="padding:32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" style="padding:20px;background:#1C261C;border-radius:10px;">
            <a href="${escapeHtml(p.appUrl)}" style="display:inline-block;color:#F0EADC;text-decoration:none;font-size:16px;font-weight:700;">Open ok2eat →</a>
          </td>
        </tr></table>
      </td></tr>

      <!-- Free public resource — shelf-life directory -->
      <tr><td style="padding:18px 32px;border-top:1px solid #E5DFCE;background:#F7F3E8;">
        <p style="margin:0 0 4px;font-size:10px;color:#6B8264;font-family:'DM Mono',monospace;letter-spacing:0.6px;text-transform:uppercase;">// free resource</p>
        <p style="margin:0;font-size:13px;color:#3A4A38;line-height:1.5;">
          Wondering how long something lasts?
          <a href="https://ok2eat.com/shelf-life/?utm_source=email_digest&amp;utm_medium=email&amp;utm_campaign=shelf_life_link" style="color:#3E721D;text-decoration:underline;font-weight:600;">Look it up free in our shelf-life directory →</a>
        </p>
        <p style="margin:4px 0 0;font-size:11px;color:#6B8264;">660 foods, sourced from the USDA FoodKeeper dataset. No signup.</p>
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
  totalItems: number;
  recipes: DailyRecipe[];
}): string {
  const lines: string[] = [];
  lines.push(`ok2eat — ${p.dateLabel}`);
  lines.push("");
  if ((p.totalItems || 0) === 0) {
    lines.push("Your fridge is empty.");
    lines.push("Add items to get recipe suggestions and keep track of what's expiring.");
    lines.push("");
    lines.push(`Add your first item: ${p.appUrl}`);
  } else {
    const total = p.expired.length + p.expiring.length;
    if (total === 0) {
      lines.push("Your fridge today: all good — nothing needs attention.");
    } else {
      lines.push(`Your fridge today: ${total} item${total === 1 ? "" : "s"} need attention.`);
    }
  }
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
  if (p.recipes && p.recipes.length > 0) {
    lines.push("Tonight's recipe ideas (built from what's in your fridge):");
    for (const r of p.recipes.slice(0, 3)) {
      const uses = (r.uses_items || []).slice(0, 4).join(", ");
      lines.push(`  · ${r.emoji || "🍳"} ${r.name}${r.time ? ` (${r.time})` : ""}`);
      if (uses) lines.push(`    Uses: ${uses}`);
      lines.push(`    Open: https://ok2eat.com/recipes/${encodeURIComponent(r.id)}`);
    }
    lines.push("");
  }
  lines.push(`Open ok2eat: ${p.appUrl}`);
  lines.push("");
  lines.push("Wondering how long something lasts? Free public directory of 660 foods (USDA data, no signup):");
  lines.push("  https://ok2eat.com/shelf-life/?utm_source=email_digest&utm_medium=email&utm_campaign=shelf_life_link");
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
  // v1.19 — optional; if unset, posthog_capture is a no-op. Set as a
  // Supabase Function Secret named POSTHOG_API_KEY (the public phc_ key).
  const posthogApiKey = Deno.env.get("POSTHOG_API_KEY");
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

    // Total fridge_items count (regardless of expiry) — used by the hero to
    // pick between "Your fridge today" and the empty-fridge activation
    // variant. A user with items expiring 30 days from now is NOT an empty-
    // fridge user, even if `items` (windowed) returns 0 rows. Counted via
    // head:true + count:'exact' to avoid pulling rows we don't need.
    const { count: totalItems } = await supa
      .from("fridge_items")
      .select("*", { count: "exact", head: true })
      .eq("user_id", row.user_id);

    const { expiring, expired } = categorize((items || []) as FridgeItem[]);

    // 2026-05-13 — previously: `if (expiring.length===0 && expired.length===0) continue;`
    // Removed by Greg's call. The digest has standalone value beyond fridge
    // activity (Latest from the blog, shelf-life directory, brand presence).
    // For users with nothing expiring, we render an empty-fridge hero that
    // doubles as an activation nudge for users who signed up but haven't
    // added items yet.
    //
    // This also fixes a hidden filter bug: users with `expiring_within_days`
    // set lower than their actual item expiry dates were silently skipped.

    const recipeNames = topItemNames(expiring, expired, 4);
    const recipeQuery = recipeNames.join(", ");

    // v1.18 — fetch personalized recipes via the shared helper. Returns
    // null on any failure (Anthropic hiccup, etc.); the email builders
    // hide the recipe section in that case, so the digest still goes out.
    // Cache (daily_recipe_cache) means this is free on subsequent calls
    // within the same day — including the 6pm Smart Cook Night push.
    let recipes: DailyRecipe[] = [];
    if ((totalItems || 0) > 0) {
      try {
        const dr = await getDailyRecipesForUser(supa, row.user_id, row.digest_timezone || "UTC");
        if (dr && dr.recipes) recipes = dr.recipes;
      } catch (e) {
        console.error("daily recipes failed for", row.user_id, e);
        // Continue with recipes=[]; section just hides.
      }
    }

    const unsubscribeUrl = `${supabaseUrl}/functions/v1/unsubscribe-email-digest?token=${row.unsubscribe_token}`;
    // v1.1.0 — Universal Link. iOS opens ok2eat directly when installed (one
    // tap from email). Falls back to ok2eat.com landing for non-install
    // users. Requires apple-app-site-association at /.well-known/ + the
    // associatedDomains entitlement in v1.1.0+ of the app.
    //
    // v1.15 — UTM-tagged so the iOS deep link handler fires
    // `digest_email_opened` in PostHog when a user clicks through. Without
    // these tags we couldn't measure click-through from the digest.
    const appUrl = "https://ok2eat.com/open?utm_source=email_digest&utm_medium=email&utm_campaign=daily_digest";

    const subject = buildSubject(expiring.length, expired.length);
    const html = buildEmailHtml({
      dateLabel: dateLabel(row.digest_timezone),
      expiring, expired, recipeQuery, unsubscribeUrl, appUrl,
      totalItems: totalItems || 0,
      recipes,
    });
    const text = buildEmailText({
      dateLabel: dateLabel(row.digest_timezone),
      expiring, expired, recipeQuery, unsubscribeUrl, appUrl,
      totalItems: totalItems || 0,
      recipes,
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

    // v1.19 — capture deliverability signal regardless of success. The
    // event has `ok` + `is_apple_relay` so the daily PostHog report can
    // split delivery rate by recipient class and surface a regression on
    // Apple Private Relay (the bug pattern we fixed by registering the
    // sending domain in Apple Developer's Email Communication settings).
    const isRelay = isApplePrivateRelay(toEmail);
    posthogCapture(posthogApiKey, "email_digest_sent", row.user_id, {
      ok: result.ok,
      resend_status: result.status,
      is_apple_relay: isRelay,
      email_domain: (toEmail.split("@")[1] || "").toLowerCase(),
      had_recipes: (recipes?.length || 0) > 0,
      had_expiring: expiring.length > 0,
      had_expired: expired.length > 0,
      total_items: totalItems || 0,
      digest_hour: row.digest_hour,
      digest_timezone: row.digest_timezone,
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
