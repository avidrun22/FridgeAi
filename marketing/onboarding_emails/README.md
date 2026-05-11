# ok2eat — onboarding email sequence

Four HTML templates for the first 10 days after signup. Designed for Resend (you have `resend_api_key` and `resend_from_email = digest@ok2eat.com` in `telegram_config.json`).

## The sequence at a glance

| # | File | Send | Subject | Preview text | Primary CTA |
|---|------|------|---------|--------------|-------------|
| 1 | `01_welcome_day0.html` | Day 0 (on signup) | **Welcome to ok2eat** | "The average US household throws out $1,866 of food a year. Let's keep that money in your pocket." | Scan your first item |
| 2 | `02_profile_setup_day2.html` | Day 2 | **Two minutes that make the alerts actually useful** | "Two settings — household size and allergies — and the alerts start meaning something specific to you." | Finish your profile |
| 3 | `03_core_walkthrough_day5.html` | Day 5 | **Scan once. We'll handle the rest.** | "The whole app is built around one habit: scan groceries when you put them away. Here's the daily loop after that." | Scan your next grocery trip |
| 4 | `04_power_user_tips_day10.html` | Day 10 | **5 ok2eat tricks most users miss** | "Receipt OCR vs barcodes, the public shelf-life directory, and three other things most users don't find on their own." | Open the app |

Suggested `from`: `Greg from ok2eat <hello@ok2eat.com>` (warmer than `digest@`, matches the founder-signed copy). Reply-to should be a mailbox you actually read since email 4 explicitly invites replies.

## How it differentiates from Cooklist

Greg's note on the two Cooklist emails: *"All stuff I can do. But they are going mostly at the recipe angle."* These templates deliberately diverge on:

- **Lead with waste, not recipes.** Specific numbers ($1,866/yr via ReFED 2024) instead of vague "save money." Recipes are positioned as the cherry-on-top of the scan → alert → recipe loop, not the headline.
- **Source the shelf-life claim.** USDA FoodKeeper is named in every email. Cooklist says it "automatically calculates" without citing a source.
- **Founder-signed, not "The Team."** Each email ends with a personal sign-off from Greg, and email #4 invites direct reply.
- **The public `/shelf-life/` directory as a hook.** Cooklist has no public lead magnet equivalent. We mention it in emails 1 and 4 as a no-account-required reason to come back.
- **One clear CTA per email.** Cooklist's emails have no obvious buttons; ours each have a single forest-green action.

## Brand alignment

Pulled from `marketing_strategy/brand_context.md`:

- Cream background `#F0EADC`, surface `#F7F3E8`, forest green `#3E721D` primary, soft green `#A6D388` accent, text `#1C261C`.
- Font stack: `Bricolage Grotesque` for body/headlines, `DM Mono` for eyebrow/all-caps labels — both have system-stack fallbacks since email clients don't reliably load web fonts.
- Voice: specific over general, sourced when relevant, friendly not preachy, no emoji-stuffing, no hashtag walls.

## Merge tags

Each template uses these placeholders. Replace before sending (Resend's raw HTML send doesn't templatize automatically — substitute on your side, or use Resend's React Email for typed templating).

| Placeholder | What it is |
|-------------|------------|
| `{{first_name}}` | User's first name. Fallback to "there" if you don't have it. |
| `{{cta_url}}` | Deep link to the relevant in-app screen. See per-email suggestions below. |
| `{{unsubscribe_url}}` | Resend gives you a `{{{RESEND_UNSUBSCRIBE_URL}}}` token; substitute that here, or use your own list-management URL. |
| `{{view_url}}` | Web-hosted version of the email. Optional — omit and remove the link if you don't host these. |

### Suggested CTA URLs

- Email 1 → `ok2eat://scan` (or `https://app.ok2eat.com/scan` for web users)
- Email 2 → `ok2eat://profile/edit`
- Email 3 → `ok2eat://scan?source=onboarding_day5`
- Email 4 → `ok2eat://home`

If you don't have universal links wired up yet, point all CTAs at `https://ok2eat.com/download` and let the user pick a surface.

## Resend snippet

```js
import { Resend } from "resend";
import { readFileSync } from "node:fs";

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendOnboardingEmail({ to, firstName, file, subject, ctaUrl, unsubscribeUrl, viewUrl }) {
  let html = readFileSync(`./templates/${file}`, "utf8");
  html = html
    .replaceAll("{{first_name}}", firstName || "there")
    .replaceAll("{{cta_url}}", ctaUrl)
    .replaceAll("{{unsubscribe_url}}", unsubscribeUrl)
    .replaceAll("{{view_url}}", viewUrl || "");

  return resend.emails.send({
    from: "Greg from ok2eat <hello@ok2eat.com>",
    to,
    subject,
    html,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}
```

Scheduling: pair this with a `scheduled_runs/` cron similar to your existing daily-report setup, querying Supabase for users whose `created_at` matches `now() - interval '2 days'` (etc.) and hasn't already received each email.

## Plain-text fallbacks

Resend will auto-generate text alternatives from the HTML, but you'll get better deliverability with handwritten text versions. If you want me to write them, just say "give me text versions" and I'll add `.txt` siblings.

## ✓ Feature claims — verified against v1.16 (audited 2026-05-11)

All four claims are now backed by shipped behavior. Audit notes:

1. **Recipes use multiple expiring items at once.** ✓ Shipped. The Eat Me First tab's per-item "Get recipes" button calls `generate-recipes` with the tapped item leading + the 4 next-most-urgent items as context — so the parfait recipe in Email 3 will plausibly use both the yogurt and the strawberries when they're both expiring soon. The "Cook with your top 5 expiring items" header CTA on the same tab does the same thing without a lead item.
2. **App shows both printed date and USDA shelf-life window.** ✓ Shipped. `fridge_items.expiry_usda_date` (migration 20260511_v116_expiry_usda_date.sql) stores the FoodKeeper-suggested date at item-add time. `ItemDetailModal` renders the secondary green "🌿 USDA shelf life: N days (M+ longer than your date)" pill when the FoodKeeper window is at least 2 days longer than the printed date. Validates Email 4 tip 4 verbatim.
3. **Recipe portions adjust based on household size.** ✓ Shipped. The `generate-recipes` Edge Function loads `user_settings.household_size` and injects `"Scale ingredient amounts to N servings."` into the prompt preamble. Body also accepts a per-request `servings` override (no UI control yet — see v1.17 backlog — but the email line says "you can override per recipe" which is currently aspirational; soften to "later you can override per recipe" or just drop the parenthetical if precision matters).
4. **Web app uses the same account.** ✓ Always shipped. Both iOS (`App.js`) and web (`web/src/lib/supabase.js`) authenticate against the same Supabase project (`qemarhvgeuzhlwybmbie`) — a signup on either surface signs the user into both. Household-share works cross-platform via `household_members`.

### Pre-cron tweaks recommended

- **Email 2** (`02_profile_setup_day2.html`): the "you can override per recipe" line is technically supported by the API but has no UI control in v1.16. Either soften to "(per-recipe overrides coming soon)" or drop the parenthetical for now. Low priority — most readers won't notice.
- **CTA URLs**: the README suggests `ok2eat://profile/edit` etc. scheme links, but the iOS app's `Linking` handler only parses UTM params, it doesn't route to specific tabs based on path. Until deep-link routing ships, point all four CTAs at `https://app.ok2eat.com/<route>`:
    - Email 1 → `https://app.ok2eat.com/fridge`
    - Email 2 → `https://app.ok2eat.com/settings`
    - Email 3 → `https://app.ok2eat.com/fridge`
    - Email 4 → `https://app.ok2eat.com/eat-me-first`
  The web app handles `/alerts` and `/how-to` redirects already, so v1.15 bookmark mismatches don't break.
- **Email 2 profile location**: text reads "set on your profile" — in v1.16 that's the new **Settings** tab (`/settings`), not the old Alerts/Reminders surface. If a reader scans the email and opens the app expecting a "Profile" screen, they'll find the same content in Settings. No copy change needed, but the deep link should point at `/settings`.

### Cron-enable checklist

Per the v1.16 release plan, the auto-send was held until the mega-ship lands. Re-enable on the day after v1.16 hits the App Store (NOT the day of — TestFlight delays can stretch by a day):

- [ ] Confirm v1.16 (build 21) is "Ready for Sale" in App Store Connect
- [ ] Patch the four CTA URLs in the HTML templates per the table above
- [ ] (Optional) Soften the "override per recipe" line in Email 2
- [ ] Run a single test send to `greg.h.goldberg@gmail.com` — confirm all four emails render in Gmail, Apple Mail, Outlook web
- [ ] Verify the Supabase `users_to_email` query reads from `auth.users.created_at` (not a custom column that may be stale)
- [ ] Enable the scheduled task / cron — see the `Resend snippet` section above for the pattern; pair with a `last_email_sent_at` column on `user_settings` so an outage doesn't double-fire
- [ ] Monitor Resend dashboard + the `digest_email_opened` PostHog event for the first 48 hours

Everything else is straight from the brand doc: scan via barcode/receipt OCR, USDA FoodKeeper for shelf life, 660 foods in the directory, public `/shelf-life/`, alert-day-before behavior.

## Spam/deliverability checklist

- ✓ Single forest-green CTA per email, no spammy multi-button stacks
- ✓ Plain-text preview headers (hidden inline) — search engines and inbox preview both pick these up
- ✓ Unsubscribe link in footer of every template (required by CAN-SPAM / GDPR)
- ✓ `mso` conditional comment for Outlook font fallback
- ✓ `width="600"` max with `max-width:600px` for retina/mobile rendering
- ✓ Table-based layout (still the email-client lowest common denominator)
- ✗ No web fonts loaded externally (intentional — Bricolage Grotesque is referenced but degrades to system stack)

Add a DKIM/SPF check via `mxtoolbox` against `ok2eat.com` before turning on the sequence if you haven't yet.

## File tree

```
fridgeai-native/marketing/onboarding_emails/
├── 01_welcome_day0.html
├── 02_profile_setup_day2.html
├── 03_core_walkthrough_day5.html
├── 04_power_user_tips_day10.html
├── README.md            ← this file
└── _handoff_prompt.md   ← context for the "complete fridgeai project tasks" Claude project
```
