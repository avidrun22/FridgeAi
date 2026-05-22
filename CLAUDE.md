# Working preferences for Greg / ok2eat

Quick orientation for future Claude sessions on this project. Read this first
before defaulting to handoff-style workflows.

## Drive by default

If a task can be done by Claude — directly in the SQL editor via Chrome MCP,
through file edits, by calling MCP tools — Claude should DO it, not hand Greg
a list of commands to run. Driving is the default. Greg only runs commands
himself when the action genuinely requires his terminal (e.g. `eas build`
which needs his Apple credentials in Keychain, or `supabase functions deploy`
which needs his local Supabase CLI link).

When in doubt: drive. If it fails, fall back to handing off commands with
context about what was tried.

This applies especially to:
- **Supabase migrations** — paste into SQL Editor via Chrome MCP, click Run,
  handle the destructive-query confirmation, verify with a follow-up SELECT.
  Done it cleanly multiple times for v1.18 + v1.19; this is the path.
- **Web dashboard work** (App Store Connect, PostHog, Netlify, Resend) — same
  pattern. Open the page, navigate the UI, screenshot to verify.
- **Code edits** — make the edit, don't describe it.
- **File creation** — write the file, share via computer:// link.

Things that still need to land in Greg's terminal:
- `eas build` / `eas submit` (Apple Keychain access)
- `supabase functions deploy` (his local CLI link to the project)
- `git push` (his SSH key)
- Anything requiring the iOS Simulator or Xcode

## Store release notes & marketing copy: paste-in-chat, don't drive

When Greg needs to paste release notes, App Store listings, Play Console
fields, or any structured marketing copy into a web form, default to
**printing the exact copy-paste block in chat** — clearly labeled with
where each block goes. Do NOT offer to drive Chrome MCP into App Store
Connect / Play Console / similar dashboards for these pastes. Greg
prefers eyes-on control for store-listing moments and copies the text
into the relevant field himself.

Format: one fenced block per destination, labeled with the exact field
name (e.g. "App Store Connect → v1.23 → What's New in This Version").
Multiple blocks in one response are fine — Greg can scroll between them.

This applies to: App Store version notes, App Review reviewer notes,
Google Play release notes, Play Console reviewer notes, promotional
text, App Store / Play Store listing descriptions, keyword fields,
support URLs, and similar.

This does NOT apply to: setting changes that aren't user-facing copy
(SMTP settings, Supabase redirect URL allowlists, PostHog dashboard
config, EAS credentials) — driving those via Chrome MCP is still fine
and faster.

## Repo path on Greg's machines

When handing off commands, never assume `~/Documents/projects/fridgeai-native`
— different machines, different layouts.

- **Mac Mini (`Gregorys-Mac-mini`, hostname `logenbot@...`)** — repo lives at
  `~/fridgeai-native` (directly in home). This is the autonomous-agent host
  where the Telegram bot, scheduled tasks, and most `eas` / `supabase` /
  `python` commands run.
- If unsure on a given session, ask Greg to run `find ~ -maxdepth 5 -name
  fridgeai-native -type d 2>/dev/null` once and reuse the path he confirms.

Any deploy / submit / build snippet in chat should `cd` to the confirmed path,
not a guessed one. A failed `cd` continues silently in zsh and the rest of the
script runs from `~`, producing very confusing "file not found" errors deep
into the chain.

## Mobile release ritual — iOS + Android together, always

**Every release ships to BOTH platforms in the same pass.** No iOS-only or
Android-only submissions going forward — the platforms drift if treated
separately, and Greg's repeatedly burned cycles untangling drift. The
canonical build command targets BOTH:

```
cd ~/fridgeai-native && eas build --platform all --profile production --auto-submit
```

`--platform all` builds iOS and Android in parallel on EAS's servers.
`--auto-submit` chains the submit step automatically: iOS lands in App
Store Connect (TestFlight + ready to submit for review); Android lands in
Play Console internal testing track. Total: ~12-18 min wall-clock.

EAS auto-increments both `buildNumber` (iOS) and `versionCode` (Android)
via `appVersionSource: "remote"` in eas.json — never manually bump those.
Only bump `app.json.version` (the MAJOR.MINOR.PATCH user-visible string).

### 4-step ritual

1. **Bump `app.json`** — `version` field. PATCH bump for hotfixes (1.26.1 →
   1.26.2); MINOR bump for features (1.26 → 1.27).
2. **Run the build command above** — Greg's terminal only (Apple Keychain +
   Play Console credentials live there).
3. **Paste release notes into both stores** — Claude prints two paste-blocks
   in chat per the "Store release notes" section above, one per destination:
   - App Store Connect → version → What's New in This Version
   - Google Play Console → Internal testing release → Release notes (en-US)
   Reviewer notes (App Store) and reviewer notes (Play Console) only when
   the release introduces a new AI feature or significant flow change.
4. **Marketing site bump — only after Apple approves the iOS build:**
   - `ok2eat.html` hero badge: `<div class="hero-badge">v1.NN · iOS + web</div>`
   - `ok2eat.html` JSON-LD `softwareVersion`
   - `datePublished` to today's date
   - Deploy via `python3 scripts/deploy_website.py` or Telegram `/deploy`

   The hero badge + JSON-LD reflect what's APPROVED and live in App Store —
   never a pending submission, never a TestFlight build. Android approval
   doesn't gate the marketing bump (Android updates roll silently); iOS does.

### Per-platform release-notes constraints

- **App Store Connect:** no hard character cap on What's New, but keep
  scannable (4-5 short bullets max). Use plain text, not markdown.
- **Google Play Console:** 500-char cap on release notes. Be more terse —
  reuse the App Store copy but tighten to fit.

### Historical context-leave-alone notes

Version references in blog posts and IG launch image filenames
(`_v1_16_ig_image.html`, "rebuilt ok2eat around one question in v1.16")
are SAFE TO LEAVE. They refer to specific shipped versions in context.
Only the homepage badge + structured data are live-version indicators.

## Three-platform parity — iOS, Android, web

Starting **v1.22** (after Android shipped to Google Play internal testing in
v1.21): every user-facing change touches all THREE clients in the same
version. No iOS-first, no Android-later, no web-deferred. The product has
to feel like the same product no matter where the user opens it.

The good news: **iOS and Android share `App.js`**, so most changes are
"App.js edit + web/src edit". The Android-specific work is occasional
platform-shimming (status bar insets, system camera vs in-app camera,
FCM nuances) — most days the only extra cost over iOS is testing on the
Pixel 9 emulator after Metro reload.

When implementing a feature, the default sequence is:
1. **Backend** (Edge Function, migration, schema) — shared by all clients
2. **App.js** — iOS + Android UI (single React Native codebase)
3. **web/src/** — web UI mirroring the same flow with React DOM equivalents
4. **Test all three** — iOS Simulator, Pixel 9 emulator, browser — before
   marking a feature done. Tasks stay `in_progress` until all three pass.

Translation from React Native (`App.js`) to web (`web/src/`):
- `TouchableOpacity` → `<button>` / `<div onClick>`
- React Native `Modal` → portal / dialog (web uses a custom Modal component)
- `Ionicons` → `lucide-react` icons
- `Linking.openURL` → `window.open` / `window.location.href`
- Inline RN styles → Tailwind classes (web uses Tailwind)
- `expo-notifications` → no equivalent on web (mobile-only; web fallback
  is the existing email digest, which is already platform-agnostic)
- `Platform.OS === "android"` blocks — handle inline in App.js; web
  doesn't see these. Common cases: `ANDROID_TOP_INSET` for status bar,
  `paddingBottom: 24` for gesture handle clearance.

Treat iOS + Android + web as three render targets for the same product.
If a v1.22+ commit touches only one or two, it's incomplete — add a TODO
comment in the missing clients and a TaskList entry to close the gap
before the version ships.

## Repo orientation

- **App.js** — React Native iOS app (and Android once v1.21 ships). Single-file by convention.
- **web/** — Vite + React web app at app.ok2eat.com. Ships in lockstep with App.js.
- **website/** — Marketing site at ok2eat.com (built/deployed via Netlify).
- **supabase/functions/** — Deno Edge Functions. `_shared/` for cross-fn modules.
- **supabase/migrations/** — naming convention `YYYYMMDD_v1NN_<short>.sql`.
- **scripts/** — Python scripts (mostly). Use `scripts/ingest_off_dump.py` as
  the reference for Supabase service-role + telegram_config.json credential pattern.
  - `scripts/build_shelf_life_pages.py` — regenerates `/shelf-life/{slug}.html`
    from `data/foodkeeper.json` + `data/shelf_life_extended.json`. Self-prunes
    orphans. Re-run after any change to either dataset.
  - `scripts/expand_shelf_life.py` — Phase 2 shelf-life expansion. Calls
    Claude Haiku over a 2,500+ candidate list, validates each row against the
    extended-JSON schema, dedups against FoodKeeper, and appends to
    `data/shelf_life_extended.json`. Greg runs from his terminal (sandbox
    proxy 401s the Anthropic key). See script docstring for CLI usage and
    `--emit-migration` for auto-generated SQL.
- **.appstoreconnect/** — Daily PostHog report + Telegram bot + Claude agent.
- **docs/** — Strategic specs (e.g. v1_19_recipe_browser_spec.md). Reach for
  this folder when something is bigger than a single feature.
- **marketing/** — Release notes per version, social drafts, copy artifacts.
- **BACKLOG.md** — Near-term backlog. The TaskList tool is the live tracker;
  BACKLOG.md is the human-friendly summary updated at version-ship time.

## Conventions

- Migrations are **idempotent**. Use `CREATE TABLE IF NOT EXISTS`, `DROP
  POLICY IF EXISTS` before each `CREATE POLICY`, `DROP TRIGGER IF EXISTS`
  before each `CREATE TRIGGER`. Re-running a migration should be a no-op.
- The migration history table in Supabase is unreliable because old
  pre-folder migrations were applied manually. **Don't use `supabase db push`
  for migrations** — it'll try to replay everything from scratch and hit the
  v1.0.5 `ALTER DATABASE` permission wall. Apply migrations via the SQL editor.
- `supabase functions deploy <name>` works fine — it doesn't touch migration
  history. CLI is the right tool there.
- Cron jobs that need `app.cron_secret` — **inline the literal**
  (`'k7Mq3vP9xT2nL5wB8cR4yH6jE1fD0aZs'`), don't use
  `current_setting('app.cron_secret', true)`. The DB-level setting isn't
  configured; existing crons (`ok2eat-daily-digest`, `ok2eat-email-digest`,
  `ok2eat-onboarding-emails`, `ok2eat-smart-cook-night`) all use the literal.
- **Recipe data shape** is canonical across the system. The DailyRecipe
  interface (`id`, `name`, `time`, `difficulty`, `emoji`, `description`,
  `ingredients[]`, `instructions[]`, `tip`, `uses_items[]`) is in
  `supabase/functions/_shared/daily_recipes.ts`. The recipe_bank table
  matches this shape so the same recipe-sheet modal renders bank + cache +
  saved recipes generically.
- **Universal Links** at ok2eat.com/recipes/{id} deep-link to the recipe
  sheet in iOS. Both `daily_recipe_cache` ids (format
  `YYYYMMDD-{userid12}-{position}`) and `recipe_bank` slugs route through
  the same handler in App.js.

## Brand voice for any copy

Greg's tone (calibrated from his edits over time):
- Benefit-led headings ("Your fridge knows what's expiring" not "Fridge
  inventory tracking").
- Second-person CTAs ("See what's worth cooking tonight" not "View tonight's
  recipes").
- "Control what is in your power" framing — empowering vs. preachy.
- Closes with "Reply to any of our emails with anything broken or confusing —
  read same day. — Greg". This personal signoff is non-negotiable.
- Em-dashes (—) and ranges (3-5) are fine. Avoid: marketing buzzwords,
  "revolutionary", "game-changing", emoji-stuffed bullet points.

Tone notes also live at `.appstoreconnect/marketing_strategy/brand_context.md`
which is the canonical brand voice doc.

## Credentials (where to find what)

- `.appstoreconnect/telegram_config.json` is the central secrets file. Read
  pattern: env vars → fall back to this JSON. Used by all Python scripts.
- Keys present there: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, supabase_anon_key,
  anthropic_api_key, telegram_bot_token, posthog_*, resend_api_key, etc.
- Cron secret value: `k7Mq3vP9xT2nL5wB8cR4yH6jE1fD0aZs` (set inline in each
  pg_cron job, not at DB level).
