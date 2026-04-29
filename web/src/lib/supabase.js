import { createClient } from "@supabase/supabase-js";

// Same Supabase project as the iOS app — that's how cross-device sync works.
// User signs in here with the same email + password they use on iOS, gets the
// same auth.uid(), reads the same household_id, sees the same fridge_items.

const url     = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loudly during dev so missing env vars are obvious. In prod the build
  // would still work but Supabase calls would error out.
  console.error(
    "[ok2eat] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
    "Copy .env.example to .env and fill in real values."
  );
}

export const supabase = createClient(url || "", anonKey || "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // localStorage is fine for a logged-in app — no SSR rehydration to worry
    // about since this is a pure SPA.
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});
