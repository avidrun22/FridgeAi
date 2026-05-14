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

## App Store submission checklist

**Every time we `eas submit` a new iOS version, the marketing site has to
move in lockstep.** The version-pill on ok2eat.com is the first thing
visitors see, and it had drifted to v1.16 while we were on v1.18 — that
shouldn't happen again. Going forward, "submit to App Store" is a 4-step
ritual, not 1 step:

1. **Bump `app.json`** — `version` field to the new MAJOR.MINOR (e.g. `1.19`).
2. **Run `eas build` + `eas submit`** in Greg's terminal.
3. **Update marketing site to match** — two spots in `ok2eat.html`:
   - The hero badge: `<div class="hero-badge">v1.NN · iOS + web</div>` (currently around line 1094).
   - The JSON-LD `softwareVersion` (around line 978) — Google Search uses
     this for the MobileApplication rich result.
4. **Deploy the marketing site** via `python3 scripts/deploy_website.py` or
   the Telegram `/deploy` shortcut.

The hero badge + JSON-LD always reflect the version that's currently APPROVED
and live in the App Store — never a pending submission, never a TestFlight
build. If we submit a new version that's still in review, the badge stays
on the previous live version until Apple approves. This matters because
visitors who tap "Download on the App Store" will get whatever Apple is
serving, not what our marketing claims is "current."

Historical version references in blog posts and the IG launch image
filename (`_v1_16_ig_image.html`, "rebuilt ok2eat around one question in
v1.16") are SAFE TO LEAVE. They refer to specific shipped versions in
context. Only the homepage badge + structured data are live-version
indicators.

## Web ships in lockstep with iOS

Starting v1.20: every user-facing feature added to `App.js` must ALSO be
added to `web/src/` in the same version. No more iOS-first / web-later.
This is a deliberate strategic choice — Greg gets direct user requests
from non-iOS users, and traffic from the ok2eat.com blog lands on the
web app, not the App Store. The two clients have to feel like the same
product.

When implementing a feature, the default sequence is:
1. Backend (Edge Function, migration, schema) — shared by both clients
2. App.js — iOS UI
3. web/src/ — web UI mirroring the same flow with React DOM equivalents
4. Tests both clients before calling the feature done

The backends are already shared (same Supabase functions, same tables).
Translation from iOS to web is mostly:
- `TouchableOpacity` → `<button>` / `<div onClick>`
- React Native `Modal` → portal / dialog (web uses a custom Modal component)
- `Ionicons` → `lucide-react` icons
- `Linking.openURL` → `window.open` / `window.location.href`
- Inline RN styles → Tailwind classes (web uses Tailwind)
- `expo-notifications` → no equivalent on web (it's iOS-only territory; web doesn't have push)

Android (v1.21+) follows the same rule once it lands. Treat iOS + web +
Android as three render targets for the same product.

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
