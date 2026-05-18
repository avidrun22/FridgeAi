// send-onboarding-emails — fires the 4-step onboarding sequence via Resend.
//
// Endpoint: POST /functions/v1/send-onboarding-emails
// Auth:     x-cron-secret header (same shared secret as send-daily-digest).
// Schedule: hourly via pg_cron (see 20260512_v117_pg_cron_onboarding_emails.sql).
//
// For each pass we look up users who became eligible since the last run for
// each of the 4 emails (D0 / D2 / D5 / D10 since signup), dedupe against
// user_email_sends, render the matching template with merge tags, and send
// via the Resend HTTP API. A row is inserted into user_email_sends regardless
// of whether the send succeeded — so a permanently-failing send doesn't get
// retried forever. Status column captures whether it landed.
//
// Eligibility window logic:
//   threshold_ok        — created_at older than the email's "days since signup"
//                         (e.g. ≥ 5 days old for the D5 email).
//   max_age_ok          — created_at younger than threshold + max_lag_days
//                         (don't send the D10 email to a 6-month-old user
//                         who just opted back in; default lag is 30 days).
//   opt_in              — user_settings.email_digest_enabled is true.
//   not_yet_sent        — no user_email_sends row exists for (user, email_key).
//
// Body params (optional):
//   { "dry_run": true } — render-and-count only, no Resend call, no DB writes.
//   { "limit": 50 }     — cap the total emails sent in this run (per email_key).
//                         Defaults to 200 to keep a single cron tick bounded.
//
// Required Supabase secrets (set in Edge Function dashboard):
//   RESEND_API_KEY         — re_... same key used by send-email-digest.
//   CRON_SECRET            — shared header value protecting this endpoint.
//   ONBOARDING_FROM        — optional; defaults to "Greg from ok2eat <hello@ok2eat.com>"
//   ONBOARDING_REPLY_TO    — optional; defaults to "hello@ok2eat.com"
//   PUBLIC_APP_URL         — optional; used to build unsubscribe + CTA fallbacks.
//                            Defaults to "https://ok2eat.com".
//
// CTA URLs are deep links into the app — Universal Links handle iOS, the
// `https://app.ok2eat.com/...` fallback handles web users with no app.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// ─── Email sequence config ────────────────────────────────────────────────

interface EmailConfig {
  /** Stable key persisted to user_email_sends.email_key. */
  key: string;
  /** Filename in ./templates/ */
  template: string;
  /** Days since signup before this email is eligible. */
  delay_days: number;
  /** Max additional days after `delay_days` to still send. Stops "welcome a
   *  year-old user back" weirdness if the cron is reactivated on stale data. */
  max_lag_days: number;
  /** Resend subject. */
  subject: string;
  /** Hidden preheader text (shows in inbox preview). */
  preview: string;
  /** Where the primary CTA points (relative or absolute URL). Each template
   *  uses {{cta_url}} once for its single button. */
  cta_url: string;
}

const SEQUENCE: EmailConfig[] = [
  {
    key: "onboarding_d0",
    template: "01_welcome_day0.html",
    delay_days: 0,
    max_lag_days: 3,
    subject: "Welcome to ok2eat",
    preview:
      "The average US household throws out $1,866 of food a year. Let's keep that money in your pocket.",
    cta_url: "ok2eat://scan",
  },
  {
    key: "onboarding_d2",
    template: "02_profile_setup_day2.html",
    delay_days: 2,
    max_lag_days: 5,
    subject: "Two minutes that make the alerts actually useful",
    preview:
      "Two settings — household size and allergies — and the alerts start meaning something specific to you.",
    cta_url: "ok2eat://profile/edit",
  },
  {
    key: "onboarding_d5",
    template: "03_core_walkthrough_day5.html",
    delay_days: 5,
    max_lag_days: 7,
    subject: "Scan once. We'll handle the rest.",
    preview:
      "The whole app is built around one habit: scan groceries when you put them away. Here's the daily loop after that.",
    cta_url: "ok2eat://scan?source=onboarding_day5",
  },
  {
    key: "onboarding_d10",
    template: "04_power_user_tips_day10.html",
    delay_days: 10,
    max_lag_days: 30,
    subject: "5 ok2eat tricks most users miss",
    preview:
      "Receipt OCR vs barcodes, the public shelf-life directory, and three other things most users don't find on their own.",
    cta_url: "ok2eat://home",
  },
];

// ─── Behavioral triggers (RPC-driven eligibility) ─────────────────────────
// Each trigger calls a Postgres function (see migration 20260512_v117_behavioral_email_eligibility.sql)
// that returns the candidate users. Adding a new behavioral trigger = write a new
// SQL function + add an entry below + inline its template.

interface BehavioralTrigger {
  /** Stable key persisted to user_email_sends.email_key. */
  key: string;
  /** Filename in TEMPLATE_MAP. */
  template: string;
  /** Resend subject. */
  subject: string;
  /** Hidden preheader text. */
  preview: string;
  /** Where the CTA points. */
  cta_url: string;
  /** Name of the Postgres function that returns eligible users. Must return
   *  columns (user_id, email, first_name, unsubscribe_token). */
  rpc: string;
}

const BEHAVIORAL_TRIGGERS: BehavioralTrigger[] = [
  {
    key: "behavioral_quick_start",
    template: "05_behavioral_quick_start.html",
    subject: "Three ways to add your first item",
    preview: "Type, scan a barcode, or snap a photo of your grocery receipt.",
    cta_url: "ok2eat://scan?source=behavioral_quick_start",
    rpc: "eligible_behavioral_quick_start",
  },
  {
    key: "behavioral_try_receipt_scan",
    template: "06_behavioral_try_receipt_scan.html",
    subject: "The fastest way to fill your fridge",
    preview: "Snap one grocery receipt — AI pulls every line in, sets categories and expiry dates automatically.",
    cta_url: "ok2eat://scan-receipt?source=behavioral_try_receipt_scan",
    rpc: "eligible_behavioral_try_receipt_scan",
  },
];

// deno-lint-ignore no-explicit-any
async function findEligibleBehavioralUsers(supa: any, trigger: BehavioralTrigger, limit: number): Promise<EligibleUser[]> {
  const { data, error } = await supa.rpc(trigger.rpc);
  if (error) {
    console.error(`RPC ${trigger.rpc} failed:`, error.message);
    return [];
  }
  const rows = (data || []) as Array<{ user_id: string; email: string; first_name: string; unsubscribe_token: string }>;
  return rows.slice(0, limit).map((r) => ({
    user_id: r.user_id,
    email: r.email,
    first_name: r.first_name || "there",
    unsubscribe_token: r.unsubscribe_token,
  }));
}


// ─── Inlined HTML templates ───────────────────────────────────────────────
// HTML kept as TS template strings so the Supabase CLI bundles them with the
// function. Edit the originals at marketing/onboarding_emails/*.html and
// re-run the inline script when you want to update copy.

const TPL_D0 = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>Welcome to ok2eat</title>
  <!--[if mso]>
  <style>
    body, table, td, a { font-family: Georgia, 'Times New Roman', serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#F0EADC; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">

  <!-- Preview text (hidden) -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F0EADC;">
    The average US household throws out $1,866 of food a year. Let's keep that money in your pocket.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F0EADC;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Container -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%; background-color:#F7F3E8; border-radius:12px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td align="left" style="padding:28px 32px 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:22px;font-weight:700;color:#3E721D;font-family:'Georgia',serif;">🥑 ok2eat</td>
                  <td align="right" style="font-size:12px;color:#6B8264;font-family:'DM Mono',monospace;letter-spacing:0.08em;">WELCOME · DAY 0</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Headline -->
          <tr>
            <td style="padding:8px 32px 0 32px;">
              <h1 style="margin:0; font-family:'Georgia', serif; font-size:28px; line-height:1.25; color:#1C261C; font-weight:700; letter-spacing:-0.5px;">
                Welcome to ok2eat, {{first_name}}.
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:16px 32px 8px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.6; color:#1C261C;">
              <p style="margin:0 0 16px 0;">
                We help people stop throwing food away. According to ReFED's 2024 data, the average US household trashes about <strong>$1,866 of food a year</strong>. Most of it because we forgot it was in there.
              </p>
              <p style="margin:0 0 8px 0;">Here's how ok2eat works:</p>
              <ul style="margin:0 0 16px 0; padding-left:20px;">
                <li style="margin:0 0 6px 0;"><strong>Snap a receipt.</strong> Our AI reads every line and fills your fridge in seconds — each item gets a smart shelf-life date from USDA FoodKeeper data (980+ foods).</li>
                <li style="margin:0 0 6px 0;"><strong>Open Eat Me First.</strong> Your fridge already ranked by what spoils soonest. Tap any item for three recipes that use it, plus the four next-most-urgent items alongside.</li>
                <li style="margin:0 0 6px 0;"><strong>Build a shopping list automagically.</strong> Pick a recipe and only the missing ingredients hit your list — no more buying spinach you already have.</li>
              </ul>
              <p style="margin:0 0 24px 0;">
                The fastest way to feel the difference is to scan one thing right now. Open the app and point your camera at whatever's closest in your fridge.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="left" style="padding:0 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#3E721D" style="border-radius:8px;">
                    <a href="{{cta_url}}" target="_blank" style="display:inline-block; padding:14px 24px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:16px; font-weight:600; color:#F7F3E8; text-decoration:none; border-radius:8px;">
                      Scan your first item
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- PS -->
          <tr>
            <td style="padding:24px 32px 8px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.6; color:#1C261C;">
              <p style="margin:0 0 12px 0;">Prefer to start with your last grocery receipt? Snap a photo and we read every line — a 30-item haul lands in seconds.</p>
              <p style="margin:24px 0 0 0; color:#1C261C;">Reply to any of our emails with anything broken or confusing — read same day.<br><br>— Greg<br>founder, ok2eat</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <div style="border-top:1px solid #A6D388; height:1px; line-height:1px; font-size:1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- P.S. block -->
          <tr>
            <td style="padding:16px 32px 28px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:14px; line-height:1.6; color:#3E721D;">
              <p style="margin:0;"><strong>P.S.</strong> Our shelf-life directory at <a href="https://ok2eat.com/shelf-life/" style="color:#3E721D;">ok2eat.com/shelf-life</a> covers 980+ foods with USDA numbers — no account needed. Useful for one-off "is this still good?" texts.</p>
            </td>
          </tr>

        </table>

        <!-- Footer -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%;">
          <tr>
            <td align="center" style="padding:20px 16px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:12px; line-height:1.6; color:#1C261C;">
              ok2eat • <a href="https://ok2eat.com" style="color:#3E721D; text-decoration:none;">ok2eat.com</a><br>
              <a href="{{unsubscribe_url}}" style="color:#1C261C;">Unsubscribe</a> &nbsp;·&nbsp;
              <a href="{{view_url}}" style="color:#1C261C;">View in browser</a>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>
`;

const TPL_D2 = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>Two minutes to make ok2eat actually useful</title>
  <!--[if mso]>
  <style>
    body, table, td, a { font-family: Georgia, 'Times New Roman', serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#F0EADC; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">

  <!-- Preview text -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F0EADC;">
    Two settings — household size and allergies — and the alerts start meaning something specific to you.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F0EADC;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Container -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%; background-color:#F7F3E8; border-radius:12px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td align="left" style="padding:28px 32px 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:22px;font-weight:700;color:#3E721D;font-family:'Georgia',serif;">🥑 ok2eat</td>
                  <td align="right" style="font-size:12px;color:#6B8264;font-family:'DM Mono',monospace;letter-spacing:0.08em;">PROFILE SETUP · DAY 2</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Headline -->
          <tr>
            <td style="padding:8px 32px 0 32px;">
              <h1 style="margin:0; font-family:'Georgia', serif; font-size:26px; line-height:1.25; color:#1C261C; font-weight:700;">
                Two minutes that make the alerts actually useful.
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:16px 32px 8px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.6; color:#1C261C;">
              <p style="margin:0 0 16px 0;">
                Quick one, {{first_name}}. Out of the box, ok2eat works on shelf life — but the recipe suggestions and the dollar numbers only get sharp once two things are set on your profile.
              </p>
            </td>
          </tr>

          <!-- Item 1: Household size -->
          <tr>
            <td style="padding:8px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#EDE6D2; border-left:4px solid #3E721D; border-radius:8px;">
                <tr>
                  <td style="padding:16px 20px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#1C261C;">
                    <div style="font-family:'DM Mono', 'Courier New', monospace; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#2A4F12; margin-bottom:6px;">01 &nbsp;·&nbsp; Household size</div>
                    <div style="font-size:16px; line-height:1.65;">
                      Drives both the personalized waste estimate (a 1-person household isn't trashing $1,866 — a 4-person one might be) and the recipe portion sizes. Pick whichever number you cook for most often; you can override per recipe.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Item 2: Dietary & allergies -->
          <tr>
            <td style="padding:12px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#EDE6D2; border-left:4px solid #3E721D; border-radius:8px;">
                <tr>
                  <td style="padding:16px 20px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#1C261C;">
                    <div style="font-family:'DM Mono', 'Courier New', monospace; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#2A4F12; margin-bottom:6px;">02 &nbsp;·&nbsp; Diet &amp; allergies</div>
                    <div style="font-size:16px; line-height:1.65;">
                      So we don't suggest a peanut recipe to someone with a peanut allergy, or a beef dish to a vegetarian. Vegetarian, vegan, gluten-free, dairy-free, nut-free — pick what applies and we'll filter from there.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="left" style="padding:24px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#3E721D" style="border-radius:8px;">
                    <a href="{{cta_url}}" target="_blank" style="display:inline-block; padding:14px 24px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:16px; font-weight:600; color:#F7F3E8; text-decoration:none; border-radius:8px;">
                      Finish your profile
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding:24px 32px 4px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.6; color:#1C261C;">
              <p style="margin:0;">Less than two minutes, promise.</p>
              <p style="margin:20px 0 0 0;">Reply to any of our emails with anything broken or confusing — read same day.<br><br>— Greg<br>founder, ok2eat</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <div style="border-top:1px solid #A6D388; height:1px; line-height:1px; font-size:1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- Tease next -->
          <tr>
            <td style="padding:16px 32px 28px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:14px; line-height:1.6; color:#3E721D;">
              <p style="margin:0;"><strong>Next email:</strong> the 90-second daily loop that does most of the work — scan, alert, recipe. The thing most users figure out by week two; we'll get you there by day five.</p>
            </td>
          </tr>

        </table>

        <!-- Footer -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%;">
          <tr>
            <td align="center" style="padding:20px 16px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:12px; line-height:1.6; color:#1C261C;">
              ok2eat • <a href="https://ok2eat.com" style="color:#3E721D; text-decoration:none;">ok2eat.com</a><br>
              <a href="{{unsubscribe_url}}" style="color:#1C261C;">Unsubscribe</a> &nbsp;·&nbsp;
              <a href="{{view_url}}" style="color:#1C261C;">View in browser</a>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>
`;

const TPL_D5 = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>Scan once, save the rest of the week</title>
  <!--[if mso]>
  <style>
    body, table, td, a { font-family: Georgia, 'Times New Roman', serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#F0EADC; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">

  <!-- Preview text -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F0EADC;">
    The whole app is built around one habit: scan groceries when you put them away. Here's the daily loop after that.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F0EADC;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Container -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%; background-color:#F7F3E8; border-radius:12px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td align="left" style="padding:28px 32px 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:22px;font-weight:700;color:#3E721D;font-family:'Georgia',serif;">🥑 ok2eat</td>
                  <td align="right" style="font-size:12px;color:#6B8264;font-family:'DM Mono',monospace;letter-spacing:0.08em;">CORE WALKTHROUGH · DAY 5</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Headline -->
          <tr>
            <td style="padding:8px 32px 0 32px;">
              <h1 style="margin:0; font-family:'Georgia', serif; font-size:28px; line-height:1.25; color:#1C261C; font-weight:700; letter-spacing:-0.5px;">
                Scan once. See what to cook tonight.
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:16px 32px 8px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.6; color:#1C261C;">
              <p style="margin:0 0 16px 0;">
                Be honest, {{first_name}} — when's the last time you opened the fridge and found something fuzzy in the back? That's the problem ok2eat is built around, and there's really only one habit you need to make it work.
              </p>
              <p style="margin:0 0 16px 0;">
                <strong>Scan your groceries when you put them away.</strong> That's it.
              </p>
              <p style="margin:0 0 16px 0;">
                Two seconds per barcode, or one photo for the whole receipt. Once it's in, ok2eat takes over.
              </p>
            </td>
          </tr>

          <!-- Daily loop diagram -->
          <tr>
            <td style="padding:8px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#EDE6D2; border-left:4px solid #3E721D; border-radius:8px;">
                <tr>
                  <td style="padding:20px 24px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#1C261C;">

                    <div style="margin-bottom:14px;">
                      <span style="font-family:'DM Mono', 'Courier New', monospace; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#2A4F12;">01 &nbsp;·&nbsp; Scan</span>
                      <div style="font-size:16px; line-height:1.65; margin-top:4px;">Barcode for one-off items, receipt photo for the whole haul. We pull the product info and assign a shelf-life window from USDA FoodKeeper data — 980+ foods covered.</div>
                    </div>

                    <div style="margin-bottom:14px;">
                      <span style="font-family:'DM Mono', 'Courier New', monospace; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#2A4F12;">02 &nbsp;·&nbsp; Eat Me First</span>
                      <div style="font-size:16px; line-height:1.65; margin-top:4px;">Every item ranked by urgency, with the chicken that expires tomorrow at the top. Not a generic "your fridge needs you" — a specific, ordered list of what to eat now.</div>
                    </div>

                    <div>
                      <span style="font-family:'DM Mono', 'Courier New', monospace; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#2A4F12;">03 &nbsp;·&nbsp; Recipe → shopping list</span>
                      <div style="font-size:16px; line-height:1.65; margin-top:4px;">Tap any item for three recipes that use it. Pick one, and only the missing ingredients hit your shopping list — no more buying spinach you already have.</div>
                    </div>

                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Concrete example -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <div style="border-left:3px solid #A6D388; padding:8px 16px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.6; color:#1C261C; font-style:italic;">
                Example: <span style="font-style:normal;">scan a tub of Greek yogurt → it slots into Eat Me First by urgency → tap it for a parfait recipe that also uses the strawberries from the same shop.</span>
              </div>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="left" style="padding:24px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#3E721D" style="border-radius:8px;">
                    <a href="{{cta_url}}" target="_blank" style="display:inline-block; padding:14px 24px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:16px; font-weight:600; color:#F7F3E8; text-decoration:none; border-radius:8px;">
                      Scan your next grocery trip
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding:24px 32px 4px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.6; color:#1C261C;">
              <p style="margin:0;">Try it this week — scan everything from your next grocery run as you unpack. Usually takes under five minutes. Then open Eat Me First and see your fridge ranked.</p>
              <p style="margin:20px 0 0 0;">Reply to any of our emails with anything broken or confusing — read same day.<br><br>— Greg<br>founder, ok2eat</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <div style="border-top:1px solid #A6D388; height:1px; line-height:1px; font-size:1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- Tease next -->
          <tr>
            <td style="padding:16px 32px 28px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:14px; line-height:1.6; color:#3E721D;">
              <p style="margin:0;"><strong>Next email:</strong> the five less-obvious things in ok2eat — receipt scan vs. barcode, the public shelf-life directory, and a few others most users don't find on their own.</p>
            </td>
          </tr>

        </table>

        <!-- Footer -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%;">
          <tr>
            <td align="center" style="padding:20px 16px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:12px; line-height:1.6; color:#1C261C;">
              ok2eat • <a href="https://ok2eat.com" style="color:#3E721D; text-decoration:none;">ok2eat.com</a><br>
              <a href="{{unsubscribe_url}}" style="color:#1C261C;">Unsubscribe</a> &nbsp;·&nbsp;
              <a href="{{view_url}}" style="color:#1C261C;">View in browser</a>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>
`;

const TPL_D10 = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>Five things most ok2eat users haven't tried yet</title>
  <!--[if mso]>
  <style>
    body, table, td, a { font-family: Georgia, 'Times New Roman', serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#F0EADC; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">

  <!-- Preview text -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F0EADC;">
    Receipt scanning, the public shelf-life directory, the recipe browser that knows your fridge, and two more.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F0EADC;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Container -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%; background-color:#F7F3E8; border-radius:12px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td align="left" style="padding:28px 32px 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:22px;font-weight:700;color:#3E721D;font-family:'Georgia',serif;">🥑 ok2eat</td>
                  <td align="right" style="font-size:12px;color:#6B8264;font-family:'DM Mono',monospace;letter-spacing:0.08em;">POWER USER TIPS · DAY 10</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Headline -->
          <tr>
            <td style="padding:8px 32px 0 32px;">
              <h1 style="margin:0; font-family:'Georgia', serif; font-size:28px; line-height:1.25; color:#1C261C; font-weight:700; letter-spacing:-0.5px;">
                Five things most users haven't tried yet.
              </h1>
            </td>
          </tr>

          <!-- Body intro -->
          <tr>
            <td style="padding:16px 32px 8px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.6; color:#1C261C;">
              <p style="margin:0 0 8px 0;">
                {{first_name}} — by now you've probably scanned a few items and caught at least one alert. Here's the stuff that's harder to discover on your own.
              </p>
            </td>
          </tr>

          <!-- Tip 1 -->
          <tr>
            <td style="padding:12px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#EDE6D2; border-left:4px solid #3E721D; border-radius:8px;">
                <tr>
                  <td style="padding:16px 20px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#1C261C;">
                    <div style="font-family:'DM Mono', 'Courier New', monospace; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#2A4F12; margin-bottom:4px;">01 &nbsp;·&nbsp; Receipt scan beats barcodes for big trips</div>
                    <div style="font-size:16px; line-height:1.65;">Snap a photo of your grocery receipt — our AI reads every line in about 5 seconds, with categories and shelf-life dates set automatically. Barcodes are great for the one yogurt you grabbed at the corner store; receipts win for the Sunday haul.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Tip 2 -->
          <tr>
            <td style="padding:10px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#EDE6D2; border-left:4px solid #3E721D; border-radius:8px;">
                <tr>
                  <td style="padding:16px 20px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#1C261C;">
                    <div style="font-family:'DM Mono', 'Courier New', monospace; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#2A4F12; margin-bottom:4px;">02 &nbsp;·&nbsp; The shelf-life directory works without the app</div>
                    <div style="font-size:16px; line-height:1.65;">
                      <a href="https://ok2eat.com/shelf-life/" style="color:#3E721D; text-decoration:underline;">ok2eat.com/shelf-life</a> covers 980+ foods with USDA FoodKeeper numbers. No sign-in. Bookmark it on your phone for the "is this still good?" texts from your partner standing in front of the fridge.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Tip 3 -->
          <tr>
            <td style="padding:10px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#EDE6D2; border-left:4px solid #3E721D; border-radius:8px;">
                <tr>
                  <td style="padding:16px 20px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#1C261C;">
                    <div style="font-family:'DM Mono', 'Courier New', monospace; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#2A4F12; margin-bottom:4px;">03 &nbsp;·&nbsp; The recipe browser knows what's already in your fridge</div>
                    <div style="font-size:16px; line-height:1.65;">Open the Plan tab, pick a cuisine (Italian, Mexican, Thai, and 9 more), and every recipe card shows which ingredients you already have. Tap one → only the missing items hit your shopping list. No more buying spinach twice.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Tip 4 -->
          <tr>
            <td style="padding:10px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#EDE6D2; border-left:4px solid #3E721D; border-radius:8px;">
                <tr>
                  <td style="padding:16px 20px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#1C261C;">
                    <div style="font-family:'DM Mono', 'Courier New', monospace; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#2A4F12; margin-bottom:4px;">04 &nbsp;·&nbsp; "Best by" is not a safety date</div>
                    <div style="font-size:16px; line-height:1.65;">USDA: most printed dates are quality indicators, not safety ones. Our shelf-life numbers are the actual edible window — which is usually longer than the carton suggests. The app shows both, so you stop trashing yogurt that's fine.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Tip 5 -->
          <tr>
            <td style="padding:10px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#EDE6D2; border-left:4px solid #3E721D; border-radius:8px;">
                <tr>
                  <td style="padding:16px 20px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#1C261C;">
                    <div style="font-family:'DM Mono', 'Courier New', monospace; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#2A4F12; margin-bottom:4px;">05 &nbsp;·&nbsp; Reply to this email — it goes to me</div>
                    <div style="font-size:16px; line-height:1.65;">Solo founder, no support team filter. If something in the app is broken, confusing, or missing, I want to know. I read every reply.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="left" style="padding:24px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#3E721D" style="border-radius:8px;">
                    <a href="{{cta_url}}" target="_blank" style="display:inline-block; padding:14px 24px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:16px; font-weight:600; color:#F7F3E8; text-decoration:none; border-radius:8px;">
                      See what's expiring tonight →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding:24px 32px 28px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.6; color:#1C261C;">
              <p style="margin:0;">Thanks for sticking with ok2eat through the first ten days. The boring secret is: the app gets noticeably better the more you scan. There's no shortcut.</p>
              <p style="margin:20px 0 0 0;">Reply to any of our emails with anything broken or confusing — read same day.<br><br>— Greg<br>founder, ok2eat</p>
            </td>
          </tr>

        </table>

        <!-- Footer -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%;">
          <tr>
            <td align="center" style="padding:20px 16px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:12px; line-height:1.6; color:#1C261C;">
              ok2eat • <a href="https://ok2eat.com" style="color:#3E721D; text-decoration:none;">ok2eat.com</a><br>
              <a href="{{unsubscribe_url}}" style="color:#1C261C;">Unsubscribe</a> &nbsp;·&nbsp;
              <a href="{{view_url}}" style="color:#1C261C;">View in browser</a>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>
`;

const TPL_QUICK_START = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>Three ways to add your first item</title>
  <!--[if mso]>
  <style>
    body, table, td, a { font-family: Georgia, 'Times New Roman', serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#F0EADC; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">

  <!-- Preview text (hidden) -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F0EADC;">
    Type, scan a barcode, or snap a photo of your grocery receipt. 30 seconds either way.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F0EADC;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%; background-color:#F7F3E8; border-radius:12px; overflow:hidden;">

          <tr>
            <td align="left" style="padding:28px 32px 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:22px;font-weight:700;color:#3E721D;font-family:'Georgia',serif;">🥑 ok2eat</td>
                  <td align="right" style="font-size:12px;color:#6B8264;font-family:'DM Mono',monospace;letter-spacing:0.08em;">QUICK START</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 32px 0 32px;">
              <h1 style="margin:0; font-family:'Georgia', serif; font-size:28px; line-height:1.25; color:#1C261C; font-weight:700; letter-spacing:-0.5px;">
                Add one thing, {{first_name}}.
              </h1>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 32px 8px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.6; color:#1C261C;">
              <p style="margin:0 0 12px 0;">
                ok2eat doesn't tell you what's expiring until it knows what's in your fridge. The fastest way to get there: add one item right now.
              </p>
              <p style="margin:0 0 0 0; color:#3A4A38;">
                Three ways. Pick whichever is fastest:
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="padding:14px 16px; background-color:#EDE6D2; border-radius:10px;">
                    <div style="font-family:'DM Mono', 'Courier New', monospace; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#2A4F12; margin-bottom:6px;">// Option 1 · 10 seconds</div>
                    <div style="font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, sans-serif; font-size:16px; font-weight:700; color:#1C261C; margin-bottom:4px;">Type it.</div>
                    <div style="font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, sans-serif; font-size:14px; color:#3A4A38; line-height:1.5;">
                      Tap + and start with the leftover you're most worried about. The USDA shelf-life lookup fills in the dates for you.
                    </div>
                  </td>
                </tr>
                <tr><td style="height:10px;"></td></tr>
                <tr>
                  <td style="padding:14px 16px; background-color:#EDE6D2; border-radius:10px;">
                    <div style="font-family:'DM Mono', 'Courier New', monospace; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#2A4F12; margin-bottom:6px;">// Option 2 · 5 seconds</div>
                    <div style="font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, sans-serif; font-size:16px; font-weight:700; color:#1C261C; margin-bottom:4px;">Scan a barcode.</div>
                    <div style="font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, sans-serif; font-size:14px; color:#3A4A38; line-height:1.5;">
                      Point your camera at any packaged item — milk jug, yogurt container, cheese. The name, category, and shelf life come back in two seconds.
                    </div>
                  </td>
                </tr>
                <tr><td style="height:10px;"></td></tr>
                <tr>
                  <td style="padding:14px 16px; background-color:#EDE6D2; border-radius:10px;">
                    <div style="font-family:'DM Mono', 'Courier New', monospace; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#2A4F12; margin-bottom:6px;">// Option 3 · 30 seconds, dozens of items</div>
                    <div style="font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, sans-serif; font-size:16px; font-weight:700; color:#1C261C; margin-bottom:4px;">Photo your last receipt.</div>
                    <div style="font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, sans-serif; font-size:14px; color:#3A4A38; line-height:1.5;">
                      AI pulls every line into your fridge, sets categories and expiry dates automatically. The biggest unlock for most new users.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:28px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-radius:8px; background-color:#1C261C;">
                    <a href="{{cta_url}}" style="display:inline-block; padding:14px 28px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, sans-serif; font-size:16px; font-weight:700; color:#F0EADC; text-decoration:none; border-radius:8px;">
                      Open ok2eat →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Founder note -->
          <tr>
            <td style="padding:20px 32px 28px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, sans-serif; font-size:14px; line-height:1.6; color:#3A4A38;">
              <p style="margin:0 0 16px 0;">
                Once you've added a handful of items, open the new <strong>Eat Me First</strong> tab — it ranks your fridge by urgency and suggests three recipes for whatever's closest to spoiling. That's the moment ok2eat starts paying you back.
              </p>
              <p style="margin:0; color:#1C261C;">Reply to any of our emails with anything broken or confusing — read same day.<br><br>— Greg<br>founder, ok2eat</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:0 32px 28px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, sans-serif; font-size:12px; line-height:1.6; color:#6B8264;">
              <hr style="border:none; border-top:1px solid #E5DFCE; margin:0 0 16px 0;">
              <p style="margin:0;">
                Don't want these? <a href="{{unsubscribe_url}}" style="color:#3E721D;">Unsubscribe</a>. Reply with any question and a human reads it the same day.
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
`;

const TPL_TRY_RECEIPT = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>The fastest way to fill your fridge</title>
  <!--[if mso]>
  <style>
    body, table, td, a { font-family: Georgia, 'Times New Roman', serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#F0EADC; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">

  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F0EADC;">
    Snap one grocery receipt — AI pulls every line in, sets categories and expiry dates automatically.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F0EADC;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%; background-color:#F7F3E8; border-radius:12px; overflow:hidden;">

          <tr>
            <td align="left" style="padding:28px 32px 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:22px;font-weight:700;color:#3E721D;font-family:'Georgia',serif;">🥑 ok2eat</td>
                  <td align="right" style="font-size:12px;color:#6B8264;font-family:'DM Mono',monospace;letter-spacing:0.08em;">RECEIPT SCAN TIPS</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 32px 0 32px;">
              <h1 style="margin:0; font-family:'Georgia', serif; font-size:28px; line-height:1.25; color:#1C261C; font-weight:700; letter-spacing:-0.5px;">
                The fastest way to fill your fridge, {{first_name}}.
              </h1>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 32px 8px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.6; color:#1C261C;">
              <p style="margin:0 0 12px 0;">
                You've added items the typed way — nice work. But the fastest path is to scan a grocery receipt: AI reads every line in <strong>about 5 seconds</strong>, sets categories, and sets shelf-life dates automatically.
              </p>
              <p style="margin:0; color:#3A4A38;">
                The point isn't typing speed. It's that scanning catches the half of your fridge you'd never bother to type in — sour cream, croutons, that bag of frozen edamame. Once it's all there, ok2eat's daily expiry alerts and Eat Me First ranking get a lot more useful.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#EDE6D2; border-radius:12px;">
                <tr>
                  <td style="padding:18px 22px;">
                    <div style="font-family:'DM Mono', 'Courier New', monospace; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#2A4F12; margin-bottom:10px;">// How it works</div>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, sans-serif; font-size:16px; color:#1C261C; line-height:1.7;">
                          <div style="margin-bottom:8px;"><strong style="color:#3E721D;">1.</strong>&nbsp;&nbsp;Tap <strong>+</strong> → <strong>Scan Receipt</strong> at the top.</div>
                          <div style="margin-bottom:8px;"><strong style="color:#3E721D;">2.</strong>&nbsp;&nbsp;Snap a photo of your last grocery receipt, or pick one from your camera roll.</div>
                          <div style="margin-bottom:8px;"><strong style="color:#3E721D;">3.</strong>&nbsp;&nbsp;Review the extracted items — edit anything that's off, then hit Add All.</div>
                          <div style="margin-bottom:0;"><strong style="color:#3E721D;">4.</strong>&nbsp;&nbsp;Done. Your fridge has 15-30 items in under a minute.</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:28px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-radius:8px; background-color:#1C261C;">
                    <a href="{{cta_url}}" style="display:inline-block; padding:14px 28px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, sans-serif; font-size:16px; font-weight:700; color:#F0EADC; text-decoration:none; border-radius:8px;">
                      Scan a receipt →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 32px 28px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, sans-serif; font-size:14px; line-height:1.6; color:#3A4A38;">
              <p style="margin:0 0 16px 0;">
                No receipt handy? The barcode scanner works for one item at a time. Either way, the more ok2eat knows about your fridge, the more useful it gets at the 6pm <em>"what should we eat?"</em> moment.
              </p>
              <p style="margin:0; color:#1C261C;">Reply to any of our emails with anything broken or confusing — read same day.<br><br>— Greg<br>founder, ok2eat</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 28px 32px; font-family:'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, sans-serif; font-size:12px; line-height:1.6; color:#6B8264;">
              <hr style="border:none; border-top:1px solid #E5DFCE; margin:0 0 16px 0;">
              <p style="margin:0;">
                Don't want these? <a href="{{unsubscribe_url}}" style="color:#3E721D;">Unsubscribe</a>. Reply with any question and a human reads it the same day.
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
`;

const TEMPLATE_MAP: Record<string, string> = {
  "01_welcome_day0.html": TPL_D0,
  "02_profile_setup_day2.html": TPL_D2,
  "03_core_walkthrough_day5.html": TPL_D5,
  "04_power_user_tips_day10.html": TPL_D10,
  "05_behavioral_quick_start.html": TPL_QUICK_START,
  "06_behavioral_try_receipt_scan.html": TPL_TRY_RECEIPT,
};

function loadTemplate(filename: string): string {
  const tpl = TEMPLATE_MAP[filename];
  if (!tpl) throw new Error(`unknown template: ${filename}`);
  return tpl;
}

function renderTemplate(html: string, merges: Record<string, string>): string {
  let out = html;
  for (const [k, v] of Object.entries(merges)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}

// ─── First-name extraction ────────────────────────────────────────────────
// Pulled from auth.users.raw_user_meta_data when available. Sources, in
// order: explicit "first_name", "given_name" (OAuth Google), "name" (OAuth
// Apple often emits a single "name"), then the local-part of the email
// before "@" as a last-ditch personalization. Falls back to "there".

function extractFirstName(
  email: string | null,
  meta: Record<string, unknown> | null,
): string {
  const tryMeta = (k: string) => {
    if (!meta) return "";
    const v = meta[k];
    if (typeof v !== "string") return "";
    return v.trim();
  };
  let n = tryMeta("first_name") || tryMeta("given_name");
  if (!n) {
    const full = tryMeta("name") || tryMeta("full_name");
    if (full) n = full.split(/\s+/)[0];
  }
  if (!n && email && email.includes("@")) {
    const local = email.split("@")[0];
    // Don't use ugly local-parts (e.g. random hash addresses)
    if (/^[a-z][a-z\-_.]{1,20}$/i.test(local)) {
      // Capitalize first letter
      n = local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
    }
  }
  return n || "there";
}

// ─── Resend send ──────────────────────────────────────────────────────────

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  unsubscribeUrl: string;
  preview: string;
}

async function sendEmail(args: SendArgs): Promise<{ id: string | null; error: string | null }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { id: null, error: "RESEND_API_KEY not set" };

  const from = Deno.env.get("ONBOARDING_FROM") || "Greg from ok2eat <hello@ok2eat.com>";
  const replyTo = Deno.env.get("ONBOARDING_REPLY_TO") || "hello@ok2eat.com";

  const body = {
    from,
    to: args.to,
    reply_to: replyTo,
    subject: args.subject,
    html: args.html,
    // RFC 8058 one-click unsubscribe — Gmail + Apple Mail render the
    // native unsubscribe affordance when both headers are present.
    headers: {
      "List-Unsubscribe": `<${args.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = (data as { message?: string })?.message || `HTTP ${resp.status}`;
      return { id: null, error: msg.slice(0, 500) };
    }
    return { id: (data as { id?: string })?.id || null, error: null };
  } catch (e) {
    return { id: null, error: String(e).slice(0, 500) };
  }
}

// ─── Eligibility query for a single email ─────────────────────────────────

interface EligibleUser {
  user_id: string;
  email: string;
  first_name: string;
  unsubscribe_token: string;
}

async function findEligibleUsers(
  // deno-lint-ignore no-explicit-any
  supa: any,
  cfg: EmailConfig,
  limit: number,
): Promise<EligibleUser[]> {
  // Lower bound: signed up at least delay_days ago.
  // Upper bound: signed up no more than delay_days + max_lag_days ago.
  const now = Date.now();
  const dayMs = 86400000;
  const lowerSignupTime = new Date(now - cfg.delay_days * dayMs).toISOString();
  const upperSignupTime = new Date(now - (cfg.delay_days + cfg.max_lag_days) * dayMs).toISOString();

  // Pull candidate user_settings rows (opted in only). We then cross-check
  // signup time in auth.users and dedupe against user_email_sends.
  const { data: optedIn, error: optInErr } = await supa
    .from("user_settings")
    .select("user_id, unsubscribe_token, email_digest_enabled")
    .eq("email_digest_enabled", true)
    .limit(2000);
  if (optInErr) {
    console.error("opt-in query failed:", optInErr.message);
    return [];
  }
  if (!optedIn || optedIn.length === 0) return [];

  // Already-sent set for this key
  const userIds = optedIn.map((r: { user_id: string }) => r.user_id);
  const { data: alreadySent } = await supa
    .from("user_email_sends")
    .select("user_id")
    .eq("email_key", cfg.key)
    .in("user_id", userIds);
  const alreadySentSet = new Set((alreadySent || []).map((r: { user_id: string }) => r.user_id));

  // Pull auth.users for signup time + email + raw_user_meta_data
  const remaining = userIds.filter((id: string) => !alreadySentSet.has(id));
  if (remaining.length === 0) return [];

  const result: EligibleUser[] = [];

  // The admin.listUsers API is paginated and not chunkable by user_id, so
  // we do a single admin.getUserById per remaining user. At v1.17 scale this
  // is fine; at >1K users we'd want to add an indexed `created_at` column
  // to user_settings or switch to a SQL function.
  for (const id of remaining) {
    if (result.length >= limit) break;
    const { data, error } = await supa.auth.admin.getUserById(id);
    if (error || !data?.user) continue;
    const u = data.user;
    if (!u.email || !u.email_confirmed_at) continue;  // never email unverified addresses
    const createdAtMs = u.created_at ? new Date(u.created_at).getTime() : 0;
    if (!createdAtMs) continue;
    // threshold + lag bounds
    if (createdAtMs > new Date(lowerSignupTime).getTime()) continue;  // too young
    if (createdAtMs < new Date(upperSignupTime).getTime()) continue;  // too old

    const settingsRow = optedIn.find((r: { user_id: string }) => r.user_id === id);
    result.push({
      user_id: id,
      email: u.email,
      first_name: extractFirstName(u.email, u.user_metadata || u.raw_user_meta_data || null),
      unsubscribe_token: settingsRow?.unsubscribe_token || "",
    });
  }

  return result;
}

// ─── Main handler ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expected = Deno.env.get("CRON_SECRET");
  if (expected) {
    const got = req.headers.get("x-cron-secret");
    if (got !== expected) return json({ error: "forbidden" }, 403);
  }

  let body: { dry_run?: boolean; limit?: number } = {};
  try {
    const txt = await req.text();
    if (txt) body = JSON.parse(txt);
  } catch { /* ignore — empty body is fine */ }

  const dryRun = Boolean(body.dry_run);
  const limit = Math.min(Math.max(body.limit ?? 200, 1), 500);
  const publicAppUrl = Deno.env.get("PUBLIC_APP_URL") || "https://ok2eat.com";
  const supa = serviceClient();

  const summary: Record<string, { eligible: number; sent: number; failed: number }> = {};

  for (const cfg of SEQUENCE) {
    summary[cfg.key] = { eligible: 0, sent: 0, failed: 0 };
    const eligible = await findEligibleUsers(supa, cfg, limit);
    summary[cfg.key].eligible = eligible.length;

    if (eligible.length === 0) continue;

    const tpl = loadTemplate(cfg.template);

    // Reuses the existing unsubscribe-email-digest endpoint: same token,
    // same effect (flips email_digest_enabled to false, which also halts
    // future onboarding emails since we filter on that flag above).
    const supaUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
    const unsubBase = `${supaUrl}/functions/v1/unsubscribe-email-digest`;

    for (const u of eligible) {
      const unsubscribeUrl = `${unsubBase}?token=${u.unsubscribe_token}`;

      const html = renderTemplate(tpl, {
        first_name: u.first_name,
        cta_url: cfg.cta_url,
        unsubscribe_url: unsubscribeUrl,
        view_url: "",  // Not hosting web versions yet — empty string strips the link.
      });

      if (dryRun) {
        summary[cfg.key].sent += 1;
        continue;
      }

      const { id: resendId, error: sendErr } = await sendEmail({
        to: u.email,
        subject: cfg.subject,
        html,
        unsubscribeUrl,
        preview: cfg.preview,
      });

      const status = sendErr ? "failed" : "sent";
      const errMsg = sendErr ?? null;
      const { error: insertErr } = await supa
        .from("user_email_sends")
        .insert({
          user_id: u.user_id,
          email_key: cfg.key,
          resend_email_id: resendId,
          status,
          error_message: errMsg,
        });
      if (insertErr) {
        console.error("user_email_sends insert failed:", insertErr.message);
      }

      if (sendErr) summary[cfg.key].failed += 1;
      else summary[cfg.key].sent += 1;
    }
  }

  // ── Behavioral triggers (RPC-driven) ──────────────────────────────────
  const supaUrlBh = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const unsubBaseBh = `${supaUrlBh}/functions/v1/unsubscribe-email-digest`;

  for (const trg of BEHAVIORAL_TRIGGERS) {
    summary[trg.key] = { eligible: 0, sent: 0, failed: 0 };
    const eligible = await findEligibleBehavioralUsers(supa, trg, limit);
    summary[trg.key].eligible = eligible.length;

    if (eligible.length === 0) continue;
    const tpl = loadTemplate(trg.template);

    for (const u of eligible) {
      const unsubscribeUrl = `${unsubBaseBh}?token=${u.unsubscribe_token}`;
      const html = renderTemplate(tpl, {
        first_name: u.first_name,
        cta_url: trg.cta_url,
        unsubscribe_url: unsubscribeUrl,
        view_url: "",
      });

      if (dryRun) {
        summary[trg.key].sent += 1;
        continue;
      }

      const { id: resendId, error: sendErr } = await sendEmail({
        to: u.email,
        subject: trg.subject,
        html,
        unsubscribeUrl,
        preview: trg.preview,
      });

      const status = sendErr ? "failed" : "sent";
      const errMsg = sendErr ?? null;
      const { error: insertErr } = await supa
        .from("user_email_sends")
        .insert({
          user_id: u.user_id,
          email_key: trg.key,
          resend_email_id: resendId,
          status,
          error_message: errMsg,
        });
      if (insertErr) {
        console.error("user_email_sends insert failed:", insertErr.message);
      }

      if (sendErr) summary[trg.key].failed += 1;
      else summary[trg.key].sent += 1;
    }
  }

  return json({ ok: true, dry_run: dryRun, summary });
});
