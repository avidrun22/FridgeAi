# Handoff prompt — paste into "complete fridgeai project tasks"

Pick up the ok2eat / fridgeai work I just did in another Claude project. Context below — no need to re-do anything, just continue from here.

## What was just produced

**Onboarding email sequence (4 HTML templates + README)** at `/Users/logenbot/fridgeai-native/marketing/onboarding_emails/`:

- `01_welcome_day0.html` — Subject: "Welcome to ok2eat." Leads with the ReFED $1,866/yr waste stat, single CTA to scan first item.
- `02_profile_setup_day2.html` — Subject: "Two minutes that make the alerts actually useful." Asks for household size + dietary/allergy preferences.
- `03_core_walkthrough_day5.html` — Subject: "Scan once. We'll handle the rest." Walks the scan → alert → recipe daily loop with a concrete yogurt example.
- `04_power_user_tips_day10.html` — Subject: "Five tricks most users miss." Receipt OCR, public `/shelf-life/` directory, USDA "best by" nuance, founder reply invite.
- `README.md` — subjects, send timing, `{{first_name}}` / `{{cta_url}}` / `{{unsubscribe_url}}` / `{{view_url}}` merge tags, Resend snippet, deliverability checklist, plus a "verify before sending" list of feature claims to eyeball against the current app.

All emails use the ok2eat palette (forest green `#3E721D` on cream `#F0EADC`), table-based layout for email-client compat, Bricolage Grotesque / DM Mono with system-font fallbacks, founder-signed by Greg. Deliberately differentiated from Cooklist (whose welcome + pantry emails were attached) by leading with waste/money saved and USDA sourcing rather than the recipe angle.

## Next-release backlog

Logged at `/Users/logenbot/fridgeai-native/.appstoreconnect/next_release_backlog.md`. Two items so far:

1. **Feature — container labels on receipt upload.** When uploading a receipt, user should be able to tag each item as fridge / pantry / freezer. One receipt can span multiple containers. Matters because shelf-life windows differ dramatically by container (chicken: 1–2 days fridge vs. 9 months freezer), so today's receipt-upload flow approximates incorrectly. Suggested UX: post-OCR review table with a fridge/pantry/freezer pill per row, smart defaults by category, bulk-edit, splits items into correct containers on save. Open question: schema change in Supabase, or does the item model already support container types?
2. **Bug — multi-item add has regressed.** Previously the user could batch-add items (likely via receipt-OCR review or multi-select); that path appears gone. Surface unconfirmed (likely iOS v1.13 and/or web). Suspect candidate: `web/src/components/ScanReceiptModal.jsx` — `open_decisions.md` notes a recent ghost-commit incident around that file. Bisect against last-known-good and fix before/with the container-label feature.

## Stated plan (Greg's words, paraphrased)

> "Let's fix the bugs and submit next version and then get started on this [the onboarding emails]. What are we staging for our next release? I have additional ideas."

So the order is: ship bug fixes + next release → then enable the onboarding sequence. **Important link:** email #4's tip 1 leads with receipt OCR. If multi-add is broken end-to-end, that tip points users at a busted path — hold the email sequence until the bug ships, or swap tip 1 with the shelf-life directory tip in the meantime. Same caveat is in the README and the backlog file.

## Other items I noticed while researching

These may already be on your radar; surface them in case they belong in the same release:

- **Push notifications for D1 retention** — `brand_context.md` says "built but not yet shipped — task #56." Plausibly the same release.
- **TestFlight build v1.0.10 build 12** is already in the pipeline per `brand_context.md`. Worth confirming whether this is the release we're staging or a separate train.
- **Version-number inconsistency.** `brand_context.md` says current version is v1.13, but social-launch assets reference v1.16 (`_v1_16_ig_image.png`). Worth reconciling before we cut release notes.

## What I'd ask Greg next

1. Which other ideas do you want in this release? (He said "I have additional ideas" — gather them before scoping.)
2. Is `.appstoreconnect/next_release_backlog.md` the right home for this list, or do you have a real tracker (GitHub Issues in `fridgeai-native`, etc.) where these should be filed?
3. For the container-label feature: start with three fixed buckets (fridge/pantry/freezer) or support custom containers from day one?
4. For email-sequence launch readiness: is `hello@ok2eat.com` the right `from`? (Resend config has `digest@ok2eat.com` — fine for daily reports but feels wrong for onboarding.)

Continue from there.
