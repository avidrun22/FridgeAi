# ok2eat web

The desktop / browser companion to the iOS app, served from app.ok2eat.com.
Same Supabase backend → users sign in with the same credentials and see the
same household inventory across both platforms.

## Stack

- Vite + React 18 (SPA)
- Tailwind CSS (palette mirrors `T` in `../App.js`)
- Supabase JS client (auth + Postgres + RLS)
- React Router for client-side routes

## Local development

```
cd web
cp .env.example .env       # fill in real anon key
npm install
npm run dev                # http://localhost:5173
```

The Supabase URL is fine in plain text; the anon key is also safe (RLS is
what actually protects data).

## Deploy

Hosted on Netlify as a separate site from the marketing one.

1. Create a new Netlify site → "Import from Git" → select this repo.
2. Set base directory = `web`.
3. Set environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Add a custom domain `app.ok2eat.com`. Netlify will give you a CNAME target;
   add it at Namecheap. Cert provisions automatically.
5. SPA fallback + asset caching are already declared in `netlify.toml`.

## Project structure

```
src/
├── main.jsx          – React entry, routes wrapper
├── App.jsx           – auth gate + route table
├── index.css         – Tailwind imports + base styles
├── lib/
│   ├── supabase.js   – createClient with the env vars
│   ├── constants.js  – CONTAINERS / CATEGORIES / RETAILERS / UNIT_OPTIONS
│   └── helpers.js    – daysUntil / expiryColor / rowToItem / formatQty
├── components/
│   └── AuthScreen.jsx
└── screens/
    └── Fridge.jsx
```

## Roadmap

- **Round 1 (✅ scaffolded)** – auth + read-only fridge view
- **Round 2** – sidebar layout + full Fridge screen with stats + categories
- **Round 3** – Add / Edit / Delete / Mark-as-opened modals
- **Round 4** – Plan tab (recipes + shopping list + retailer picker), Share + invite
- **Round 5** – Onboarding flow + polish + Realtime subscriptions

## Parity notes

When changing shared business logic, mirror it in:
- `../App.js` (iOS app)
- `../supabase/migrations/` (schema)
- `../supabase/functions/` (Edge Functions)
