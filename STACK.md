# ok2eat Tech Stack

A single source of truth for every service, library, and integration that
powers ok2eat. Update this when you add or remove a piece. Last reviewed:
2026-05-04.

---

## At a glance

```
                     ┌─────────────────────────────────────┐
                     │  Customer surfaces                  │
                     │                                     │
   ┌─── App Store ───│  iOS app (React Native + Expo)      │
   │                 │  app.ok2eat.com (React + Vite)      │
   │   Netlify ─────▶│  ok2eat.com (static HTML)           │
   │                 └─────────────────────────────────────┘
   │                              │
   │                              ▼
   │   ┌──────────────────────────────────────────────────┐
   │   │  Supabase (Postgres + Auth + Edge Functions +    │
   │   │  Storage + Realtime). Pro plan, Micro compute.   │
   │   └──────────────────────────────────────────────────┘
   │                  │                            │
   │                  ▼                            ▼
   │   ┌────────────────────────┐    ┌────────────────────────┐
   │   │ External APIs:         │    │ Operations:            │
   │   │ - Anthropic (recipes,  │    │ - PostHog (analytics)  │
   │   │   receipt OCR)         │    │ - Resend (email)       │
   │   │ - Open Food Facts      │    │ - Expo Push (push)     │
   │   │   (catalog ingest)     │    │ - Telegram bot (ops)   │
   │   │ - Apple iTunes Lookup  │    │ - launchd (cron)       │
   │   │   (in-app update prompt)│    └────────────────────────┘
   │   └────────────────────────┘
   │
   └──── DNS via Namecheap (apex + app subdomain)
```

---

## iOS app

| Piece | Tool | Notes |
|---|---|---|
| Framework | **React Native** | Single-file `App.js` (~5,000 lines). Convention: keep additions inline rather than splintering into modules. |
| Toolchain | **Expo SDK 50+** | Managed workflow with prebuild for native customization. `expo-camera`, `expo-notifications`, `expo-image-picker`, `expo-apple-authentication`, `expo-constants`. |
| Lang | JavaScript | No TypeScript. |
| State | **React hooks** (`useState`, `useEffect`, `useRef`) | No Redux/Zustand — local state per screen, Supabase as source of truth. |
| Local storage | **AsyncStorage** (`@react-native-async-storage/async-storage`) | Used for Supabase auth session + first-run tour flag. |
| Icons | **MaterialIcons + Ionicons** (`@expo/vector-icons`) | |
| OS support | iOS 17+ | Bundle ID: `com.gregorygoldberg.ok2eat`. App Store ID: `6761730687`. |
| Build cycle | See `BUILD_CYCLE.md` | prebuild → sed pbxproj → archive → upload → submit |
| Current version | v1.14 / build 18 (as of 2026-05-04) | App Store Connect manages signing, distribution. |

---

## Web app (app.ok2eat.com)

| Piece | Tool | Notes |
|---|---|---|
| Framework | **React 18** | Functional components + hooks. |
| Bundler | **Vite** | Dev: `npm run dev` on port 5173. Build: `npm run build` outputs to `web/dist/`. |
| Routing | **react-router-dom** | Multi-screen SPA: Fridge / Alerts / Plan / How To. |
| Styling | **Tailwind CSS** | Custom theme matching iOS color tokens (`accent`, `bg`, `card`, `border`, `text`, `textSoft`, `muted`, `warn`, `danger`). |
| Hosting | **Netlify** ($19/mo Personal plan) | Auto-deploy on `git push`. `web/` as base directory in `netlify.toml`. |
| Domain | `app.ok2eat.com` (Namecheap CNAME → Netlify) | Custom domain set up 2026-04-29. |
| Auth | Supabase Auth (web SDK) | Magic link + Sign in with Apple via OAuth. |

---

## Marketing site (ok2eat.com)

| Piece | Tool | Notes |
|---|---|---|
| Format | Static HTML | `ok2eat.html` (single file, ~900 lines + inline CSS). Lives at repo root. |
| Subpages | Static dirs | `/blog/`, `/privacy/`, `/join/`, `/.well-known/` (security.txt + apple-app-site-association). |
| Hosting | **Netlify** | Same Netlify project as web app, different deploy. |
| Domain | `ok2eat.com` (Namecheap apex) | |
| Deploy | `/deploy` Telegram command (Netlify API via PAT) | Or manual `netlify deploy --prod`. ~15-30 sec deploys. |
| Fonts | Bricolage Grotesque + DM Mono (Google Fonts CDN) | |
| SEO | JSON-LD (MobileApplication + FAQPage schema in `<head>`) | Validated at validator.schema.org. Search Console verified via Google Workspace. |

---

## Backend — Supabase

| Piece | Detail |
|---|---|
| Project URL | `https://qemarhvgeuzhlwybmbie.supabase.co` |
| Region | aws-1-us-east-2 (Ohio) |
| Plan | **Pro** ($25/mo) |
| Compute | **Micro** (1 GB RAM, 2-core ARM) — included in Pro |
| Disk | 8 GB ceiling. Currently using ~2 GB (mostly the OFF catalog). |
| Postgres | 15.x with extensions: `pg_trgm` (fuzzy search), `pgcrypto` (UUIDs), pgvector planned for v1.17. |
| Connection | Session pooler at `aws-1-us-east-2.pooler.supabase.com:5432` for direct psql work. |

**Schema highlights:**

| Table | Purpose |
|---|---|
| `auth.users` + `auth.identities` | Supabase Auth managed |
| `public.households` + `household_members` + `household_invites` | Multi-user shared inventory (v1.0.8+) |
| `public.fridge_items` | Core inventory: name, category, container, expiry, opened state |
| `public.shopping_lists` + `shopping_list_items` | Multi-list shopping (v1.1.0+) |
| `public.searchable_products` | OFF-derived catalog (~855K rows) |
| `public.expo_push_tokens` | Per-device push tokens for digest |
| `public.user_settings` | Per-user prefs (digest hour, notifications enabled, onboarding state) |
| `public.user_recipes` | Generated recipes cache |
| `public.money_saved_events` | Schema in place, UI deferred to Stage 2 |

**RLS:** All tables have row-level security. `user_household_ids()` SECURITY DEFINER helper handles the household-scoped lookups. RLS policies enforce that users only see/edit data in households they're a member of.

**RPCs (key ones):** `ensure_household_for_user`, `create_household_invite`, `redeem_household_invite`, `list_household_members`, `search_products`.

**Edge Functions:**
| Function | Purpose | Provider |
|---|---|---|
| `scan-receipt` | Receipt OCR + item extraction | Anthropic Claude (Sonnet) |
| `generate-recipes` | Recipe ideas from inventory | Anthropic Claude (Sonnet) |
| `send-email-digest` | Daily fridge summary email | Resend |
| `subscribe-newsletter` | Marketing site signup form | Resend |
| `unsubscribe-email-digest` | RFC 8058 one-click unsubscribe | — |

---

## Authentication

| Provider | Where used | Notes |
|---|---|---|
| **Supabase Auth (email)** | iOS magic link, web magic link, web password | Resend handles outbound email via SMTP. Confirm-email setting ON. |
| **Sign in with Apple** | iOS native + web OAuth | Services ID: `com.ok2eat.app.web`. Key ID: `5TLUJNBB2Z`. JWT secret rotates every 6 months — calendar reminder set for 2026-09-25. |

---

## External APIs

| Service | Purpose | Cost | Where keys live |
|---|---|---|---|
| **Anthropic (Claude API)** | Recipe generation, receipt OCR | Pay-per-use (~$5-15/mo so far) | Edge Function env vars |
| **Open Food Facts** | Product catalog (barcodes, names, nutrition) | Free, open data | None — public API |
| **Apple iTunes Lookup** | In-app update prompt version check | Free | None — public API |
| **Expo Push Service** | Push notifications | Free | Project ID in `app.json` extras |
| **PostHog** | Product analytics | Free tier (1M events/mo) | Project key `phc_szxhjw...` in `App.js` line 30 |
| **Resend** | Transactional email (digests, magic links, signups) | Free tier (3K emails/mo) | API key in Supabase Edge Function secrets + Supabase Auth SMTP config |
| **Telegram Bot API** | Ops + alerts | Free | Bot token + chat ID in `~/.config/ok2eat/telegram.env` (local Mac mini) |
| **Netlify** | Static hosting | $19/mo Personal | API PAT in `~/.config/ok2eat/netlify.env` (used by `/deploy` Telegram cmd) |

---

## Affiliate / commerce

| Retailer | Network | Status |
|---|---|---|
| **Amazon** | Amazon Associates (tag `ok2eat-20`) | Approved + earning |
| **Instacart** | Impact Marketplace | Declined 2026-04-28; reapply target ~6 weeks once traffic + content milestones hit |
| **Walmart** | Impact Marketplace | Same as Instacart — Impact-only, declined |
| **Target** | Impact Marketplace | Pending application; deferred. Open issue: Target paid $0/grocery historically |
| **Misfits Market, Imperfect Foods, Thrive Market, Hungryroot, Vitacost, ButcherBox** | Direct programs (in plan) | Backlog item — apply after first 3-month review post lands |

Reorder picker order in app: Instacart → Amazon → Walmart.

---

## Analytics + observability

| Tool | What it shows | Access |
|---|---|---|
| **PostHog** | DAU/WAU/MAU, session length, custom events (signups, item adds, swipes, reorders, recipes, household invites, etc.), retention cohorts, funnels | [app.posthog.com](https://app.posthog.com) |
| **Supabase Reports** | Database IOPS, CPU, memory, connection counts, query performance | Supabase Dashboard → Reports |
| **Daily metrics digest** | Combined Supabase + PostHog snapshot, sent at 9pm Pacific via launchd cron | Email |
| **Telegram bot ops** | `/metrics`, `/users`, `/recent` — instant pull of key numbers from anywhere | Telegram chat |
| **Netlify analytics** | Site traffic to ok2eat.com / app.ok2eat.com (basic) | Netlify dashboard |
| **Google Search Console** | Search impressions, clicks, indexing status | search.google.com/search-console |

PostHog instrumentation lives in `App.js`: `track(event, properties)` helper at line 32. ~25+ events tracked across signups, item interactions, household flows, recipes, reorders.

---

## Operations

| Service | Purpose |
|---|---|
| **Mac mini** (Greg's local) | Runs the Telegram bot loop, scheduled tasks (daily digest), Claude agent for ops commands |
| **Telegram bot** | `/idea` (capture backlog), `/deploy` (push site live), `/metrics`, `/ping`, `/backlog` |
| **launchd** | macOS-native cron for daily 9pm Pacific metrics digest |
| **GitHub** | Source repo. Auto-builds Netlify on `main` push. |
| **Apple Developer Program** | $99/yr — required for App Store distribution |
| **Apple App Store Connect** | App listing, TestFlight, submissions |

---

## Domains + DNS (Namecheap)

| Domain | Purpose | Configured |
|---|---|---|
| `ok2eat.com` | Marketing site (apex) | A → Netlify load balancer |
| `app.ok2eat.com` | Web app | CNAME → Netlify |
| `qemarhvgeuzhlwybmbie.supabase.co` | Backend (Supabase-managed) | N/A |

---

## Email aliases (Google Workspace)

8 aliases set up 2026-04-27 — all forward to Greg's primary inbox:

`support@`, `privacy@`, `security@`, `press@`, `legal@`, `partnerships@`, `greg@`, `noreply@`, `digest@` — all `@ok2eat.com`.

---

## Recurring monthly costs (current)

| Item | Cost |
|---|---|
| Apple Developer Program | $99/yr ≈ **$8.25/mo** |
| Supabase Pro | **$25/mo** |
| Netlify Personal | **$19/mo** |
| Google Workspace (1 user) | **$7/mo** |
| Anthropic API | ~$5-15/mo (variable) |
| Namecheap (ok2eat.com renewal) | ~$15/yr ≈ $1.25/mo |
| PostHog | $0 (free tier) |
| Resend | $0 (free tier) |
| Expo | $0 (free tier) |
| **Total** | **~$67-77/mo** |

---

## Where things live (file-system map)

```
fridgeai-native/
├── App.js                     # iOS app — single file, ~5K lines
├── app.json                   # Expo config (version, build #, plugins)
├── ok2eat.html                # Marketing site homepage
├── BACKLOG.md                 # Capture / triage / ship doc
├── BUILD_CYCLE.md             # iOS ship playbook
├── COMMANDS.md                # Telegram bot command reference
├── STACK.md                   # ← this doc
├── lib/                       # Shared JS libraries
│   ├── openFoodFacts.js       # OFF API client (lookup + search)
│   └── SEARCH_ARCHITECTURE.md # Search layering plan (v1.16-v1.18)
├── scripts/                   # One-off + recurring utilities
│   ├── apple_sign_in_jwt.py   # Mints Apple JWT for Supabase
│   ├── caption_screenshots.py # ASC screenshot caption overlay
│   ├── deploy_website.py      # Netlify deploy helper
│   ├── ingest_off_dump.py     # Loads OFF catalog → Supabase
│   └── redact_screenshots.py  # PII removal from screenshots
├── supabase/migrations/       # Postgres schema + data migrations
├── docs/                      # Setup notes + audits
│   ├── apple-sign-in-web-setup.md
│   ├── push-notifications-audit.md
│   └── screenshot-redaction.md
├── web/                       # React app at app.ok2eat.com
│   ├── src/
│   ├── public/
│   ├── index.html
│   └── package.json
├── blog/                      # Marketing site /blog/ subpages
├── privacy/                   # /privacy/ static page
├── join/                      # /join/?code=XXX deep-link landing
└── ios/, android/             # Auto-generated by Expo prebuild — gitignored
```

---

## When this doc gets stale

Update when you:
- Add a new external service or API
- Change Supabase plan or compute tier
- Onboard a new domain
- Cancel a subscription
- Add a new email alias
- Add a new recurring cost
- Restructure the file system

A 5-min "is this still right?" review every quarter is enough to keep it useful.
