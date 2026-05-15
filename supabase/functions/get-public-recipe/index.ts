// get-public-recipe — public read of a recipe_bank row by slug.
//
// Endpoint: GET /functions/v1/get-public-recipe?slug={url-safe-slug}
// Auth:     NONE — recipe_bank is intended to be publicly browseable. The
//           same recipes already render in the daily digest emails sent
//           to all subscribers, so there's no PII concern.
// Response: { recipe: { id, slug, name, emoji, time_minutes, time,
//             difficulty, meal_type, cuisine, dietary_tags, description,
//             ingredients, instructions, tip } }
//
// Why this exists:
//   v1.18 wired email digest recipe deep-links to https://ok2eat.com/recipes/{slug}
//   under the (correct) assumption that iOS users would Universal-Link
//   straight into the app and everyone else would land on a public web
//   page. The Universal Link side shipped via the in-app /recipes/ URL
//   handler; the public web page never did, so the digest links 404'd
//   in Safari + on every non-iOS recipient's browser. v1.21 closes that
//   gap by serving the recipe_bank row over this Edge Function and
//   rendering it via /recipes/index.html on the marketing site.
//
//   v1.21 sharable recipes also depend on this — the iOS recipe sheet's
//   Share button drops the same URL into Messages / Mail / etc.
//
// CORS: open. The marketing site at ok2eat.com/recipes is the primary
// caller; allowing any origin keeps the URL embeddable.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

// Slug shape: URL-safe ASCII, hyphen-delimited. Reject anything fancy so
// we never echo arbitrary text back into a 404. Daily-cache IDs are
// YYYYMMDD-prefixed (12-digit user id segment + position) — those are
// per-user and never live in recipe_bank, so we explicitly reject them
// to give a clearer 410 response than a generic 404.
const SLUG_RE          = /^[a-z0-9][a-z0-9-]{0,99}$/i;
const DAILY_CACHE_RE   = /^\d{8}-/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// Render time_minutes back into the human "X min" / "X hr Y min" string
// the iOS RecipeSheet + email digest expect. Keeps the public page reading
// identically to in-app.
function formatTime(minutes: number | null | undefined): string | null {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "GET") {
    return json({ error: "method not allowed" }, 405);
  }

  const url  = new URL(req.url);
  const slug = (url.searchParams.get("slug") || "").trim().toLowerCase();

  if (!slug) {
    return json({ error: "missing slug" }, 400);
  }
  if (DAILY_CACHE_RE.test(slug)) {
    // Daily-cache id leaked from an email-digest deep-link shared by a
    // recipient who doesn't have the app. The recipe was personalized to
    // the original recipient's fridge — we can't resolve it for a public
    // visitor. 410 (gone) communicates "this link is no longer valid"
    // better than a generic 404.
    return json({ error: "personalized_recipe_expired" }, 410);
  }
  if (!SLUG_RE.test(slug)) {
    return json({ error: "invalid slug" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase
    .from("recipe_bank")
    .select("id, slug, name, emoji, time_minutes, difficulty, meal_type, cuisine, dietary_tags, description, ingredients, instructions, tip")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    console.error("recipe_bank lookup failed:", error.message);
    return json({ error: "lookup failed" }, 500);
  }
  if (!data) {
    return json({ error: "not_found" }, 404);
  }

  return json({
    recipe: {
      id:           data.id,
      slug:         data.slug,
      name:         data.name,
      emoji:        data.emoji,
      time_minutes: data.time_minutes,
      time:         formatTime(data.time_minutes),
      difficulty:   data.difficulty,
      meal_type:    data.meal_type,
      cuisine:      data.cuisine,
      dietary_tags: data.dietary_tags || [],
      description:  data.description,
      ingredients:  data.ingredients,
      instructions: data.instructions,
      tip:          data.tip,
    },
  });
});
