// POST /functions/v1/generate-recipes
// Body: { items: ["Milk", "Eggs", ...], servings?, cuisine?, protein?, max_ingredients? }
// Auth: required. Rate limit: GENERATE_RECIPES_DAILY_LIMIT/day/user (Claude-call paths only).
// Response: { recipes: [...], usage: {count, limit}, applied: {...}, source: 'cache'|'claude' }
//
// v1.16 Tier 2 — pulls the caller's user_settings (dietary_restrictions,
// allergens, household_size) and injects them into the prompt so the
// generated recipes respect lifestyle + safety constraints and scale to the
// right serving count. `servings` body param lets a single recipe override
// the user's default household_size (e.g. "this one's just for me tonight").
//
// v1.22 #236 — pre-generation filter hints (cuisine / protein / max_ingredients).
//
// v1.26 — Shared `generated_recipes_cache` lookup BEFORE the Claude call:
//   1. Normalize the requesting user's `items` array (lowercase, drop pantry
//      staples) → `normalized_items`.
//   2. Query `generated_recipes_cache` for recipes that:
//        - overlap with `normalized_items` by at least 2 entries
//        - match cuisine + protein filters (or filter is NULL = wildcard)
//        - are safe for the user's allergens (user.allergens ⊆ row.safe_for_allergens)
//        - honor the user's dietary requirements (user.dietary ⊆ row.dietary,
//          or the row has none of the user's dietary tags missing)
//      Ordered by last_served_at DESC, then serve_count DESC. LIMIT 3.
//   3. If ≥ 3 cache hits → return cache rows, bump serve_count + last_served_at,
//      DO NOT count against rate-limit (cache hits are free).
//   4. If < 3 hits → fall through to Claude, then INSERT each fresh recipe
//      into the cache tagged with the current dietary/allergen/filter context.
import { corsHeaders } from "../_shared/cors.ts";
import { getUserId, serviceClient } from "../_shared/supabase.ts";
import { checkAndIncrement } from "../_shared/rate_limit.ts";
import { callClaude, extractJson } from "../_shared/anthropic.ts";

const DAILY_LIMIT = parseInt(
  Deno.env.get("GENERATE_RECIPES_DAILY_LIMIT") || "10",
  10,
);

// v1.26 — pantry staples to exclude from `uses_items`. Items in this set
// are excluded from both the overlap query and the cache row's uses_items
// list. Conservative: only ingredients EVERY pantry contains. Expanding
// this set is safe (more pantry words → more cache hits); contracting it
// could lead to false-positive matches ("salt" overlap shouldn't earn a
// cache hit on its own).
const PANTRY_STAPLES = new Set([
  "salt", "kosher salt", "sea salt", "table salt",
  "pepper", "black pepper", "white pepper", "ground pepper",
  "oil", "olive oil", "vegetable oil", "canola oil", "cooking oil",
  "water",
]);

function normalizeItem(s: string): string {
  return s.toLowerCase().trim();
}

function notPantryStaple(name: string): boolean {
  return !PANTRY_STAPLES.has(name);
}

function extractUsesItems(recipe: unknown): string[] {
  const r = recipe as { ingredients?: Array<{ item?: string }> } | null;
  const ings = Array.isArray(r?.ingredients) ? r!.ingredients : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ing of ings) {
    const norm = normalizeItem(String(ing?.item || ""));
    if (!norm) continue;
    if (!notPantryStaple(norm)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

// Human-readable phrases for dietary / allergen tags. Keep in sync with the
// iOS + web profile screen lists.
const DIETARY_PHRASES: Record<string, string> = {
  vegetarian:   "vegetarian (no meat, poultry, or fish)",
  vegan:        "vegan (no animal products at all — no meat, dairy, eggs, honey)",
  pescatarian:  "pescatarian (no meat or poultry; fish is fine)",
  gluten_free:  "gluten-free (no wheat, barley, rye, or conventional pasta/bread)",
  dairy_free:   "dairy-free (no milk, cheese, butter, yogurt, cream)",
  nut_free:     "nut-free (no peanuts or tree nuts)",
  low_carb:     "low-carb",
  keto:         "keto-friendly",
};

const ALLERGEN_PHRASES: Record<string, string> = {
  peanut:      "peanuts",
  tree_nut:    "tree nuts (almonds, walnuts, cashews, pecans, pistachios, etc.)",
  shellfish:   "shellfish (shrimp, crab, lobster, scallops, mussels, clams)",
  fish:        "fish",
  egg:         "eggs",
  milk:        "milk or dairy",
  soy:         "soy",
  wheat:       "wheat",
  sesame:      "sesame",
};

interface ProfilePrefs {
  dietary: string[];
  allergens: string[];
  householdSize: number;
}

async function loadProfile(userId: string): Promise<ProfilePrefs> {
  const supa = serviceClient();
  const { data } = await supa
    .from("user_settings")
    .select("dietary_restrictions, allergens, household_size")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    dietary: Array.isArray(data?.dietary_restrictions) ? data!.dietary_restrictions : [],
    allergens: Array.isArray(data?.allergens) ? data!.allergens : [],
    householdSize: Number.isFinite(Number(data?.household_size))
      ? Math.max(1, Math.min(20, Number(data!.household_size)))
      : 1,
  };
}

function buildPromptPreamble(prefs: ProfilePrefs, overrideServings: number | null): string {
  const parts: string[] = [];

  const dietaryClauses = prefs.dietary
    .map(d => DIETARY_PHRASES[d])
    .filter(Boolean);
  if (dietaryClauses.length === 1) {
    parts.push(`I am ${dietaryClauses[0]}.`);
  } else if (dietaryClauses.length > 1) {
    parts.push(`I am ${dietaryClauses.join(" AND ")}.`);
  }

  const allergenClauses = prefs.allergens
    .map(a => ALLERGEN_PHRASES[a])
    .filter(Boolean);
  if (allergenClauses.length > 0) {
    parts.push(
      `I have a serious allergy to ${allergenClauses.join(", ")} — ` +
      `recipes MUST NOT contain these or any cross-contamination ingredients.`,
    );
  }

  const servings = overrideServings && Number.isFinite(overrideServings)
    ? Math.max(1, Math.min(20, Math.round(overrideServings)))
    : prefs.householdSize;
  parts.push(`Scale ingredient amounts to ${servings} ${servings === 1 ? "serving" : "servings"}.`);

  return parts.join(" ");
}

// ---- v1.26 cache helpers ----------------------------------------------------

interface CacheRow {
  id: string;
  recipe: unknown;
  uses_items: string[];
}

/**
 * Query generated_recipes_cache for compatible hits.
 * Returns up to 3 recipes ordered by recency.
 */
async function queryCache(
  normalizedItems: string[],
  filters: { cuisine: string | null; protein: string | null; maxIngredients: number | null },
  prefs: ProfilePrefs,
  needed: number = 3,
): Promise<CacheRow[]> {
  if (normalizedItems.length < 2) return [];

  const supa = serviceClient();
  // The query is a UDF-style filter chain — PostgREST handles the array
  // overlap via `overlaps` operator and subset via `contains`. The
  // intersection-≥-2 check requires raw SQL via .rpc() OR we filter in
  // application code. Doing it in app code is fine — we pull ~20 candidate
  // rows from the cuisine/protein-filtered slice and then check overlap.
  let q = supa
    .from("generated_recipes_cache")
    .select("id, recipe, uses_items, dietary, safe_for_allergens, serve_count, last_served_at")
    .overlaps("uses_items", normalizedItems)
    .order("last_served_at", { ascending: false })
    .order("serve_count", { ascending: false })
    .limit(Math.max(20, needed * 4));

  // Cuisine / protein filters: if user picked one, ONLY match cached rows
  // with the same cuisine/protein OR NULL (wildcard recipes).
  if (filters.cuisine) {
    q = q.or(`cuisine.eq.${filters.cuisine},cuisine.is.null`);
  }
  if (filters.protein) {
    q = q.or(`protein.eq.${filters.protein},protein.is.null`);
  }

  const { data, error } = await q;
  if (error || !data) return [];

  // Application-side filtering for the tricky predicates:
  // - overlap ≥ 2 (Greg's "loose overlap" rule)
  // - user.allergens ⊆ row.safe_for_allergens (allergen safety)
  // - user.dietary requirements honored (row tagged with each of user's diets)
  const hits: CacheRow[] = [];
  const userAllergens = prefs.allergens || [];
  const userDietary = prefs.dietary || [];
  for (const row of data) {
    const usesItems: string[] = Array.isArray(row.uses_items) ? row.uses_items : [];
    const overlap = usesItems.filter((i) => normalizedItems.includes(i)).length;
    if (overlap < 2) continue;
    const safeAllergens: string[] = Array.isArray(row.safe_for_allergens)
      ? row.safe_for_allergens
      : [];
    // User's allergens must all be in the row's safe-for list
    if (userAllergens.some((a) => !safeAllergens.includes(a))) continue;
    const rowDietary: string[] = Array.isArray(row.dietary) ? row.dietary : [];
    // User's dietary requirements must all be honored by the row
    if (userDietary.some((d) => !rowDietary.includes(d))) continue;
    hits.push({ id: String(row.id), recipe: row.recipe, uses_items: usesItems });
    if (hits.length >= needed) break;
  }
  return hits;
}

async function bumpServeCounters(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const supa = serviceClient();
    // Atomic single-round-trip bump via the v1.26 helper RPC.
    // See migration 20260520_v126_generated_recipes_cache.sql.
    const { error } = await supa.rpc("increment_generated_recipes_serve", { p_ids: ids });
    if (error) console.warn("increment_generated_recipes_serve failed:", error.message);
  } catch (e) {
    console.warn("bumpServeCounters failed (continuing):", e);
  }
}

async function insertGeneratedRecipes(
  recipes: unknown[],
  ctx: {
    cuisine: string | null;
    protein: string | null;
    maxIngredients: number | null;
    dietary: string[];
    safeForAllergens: string[];
  },
): Promise<void> {
  if (!Array.isArray(recipes) || recipes.length === 0) return;
  try {
    const supa = serviceClient();
    const rows = recipes
      .map((r) => ({
        recipe: r,
        uses_items: extractUsesItems(r),
        cuisine: ctx.cuisine,
        protein: ctx.protein,
        max_ingredients: ctx.maxIngredients,
        dietary: ctx.dietary,
        safe_for_allergens: ctx.safeForAllergens,
      }))
      // Don't cache recipes with zero detectable ingredients (model glitch).
      .filter((r) => r.uses_items.length > 0);
    if (rows.length === 0) return;
    await supa.from("generated_recipes_cache").insert(rows);
  } catch (e) {
    console.warn("insertGeneratedRecipes failed (continuing):", e);
  }
}

// ---- handler ----------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const userId = await getUserId(req);
  if (!userId) return json({ error: "unauthenticated" }, 401);

  let body: {
    items?: string[];
    servings?: number;
    cuisine?: string;
    protein?: string;
    max_ingredients?: number;
    // v1.26 — generation mode. "today" (default) = 3 recipes for tonight.
    // "weekly" = 5 dinners for a Monday-Friday workweek. Other inputs
    // (filters, dietary prefs, serving size) apply identically across both
    // modes; only the recipe count + prompt wording changes.
    mode?: "today" | "weekly";
    // v1.26 #312 — Multi-cuisine constraint for weekly plans. When set,
    // recipes must be drawn from this set of cuisines (one per cuisine,
    // or spread across — Claude decides). Mutually exclusive with the
    // legacy single `cuisine` filter (cuisines[] wins). Today mode
    // ignores cuisines[]; it uses single `cuisine` like before.
    cuisines?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json body" }, 400);
  }
  const items = body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return json({ error: "items must be a non-empty array of strings" }, 400);
  }
  if (items.length > 100) {
    return json({ error: "too many items (max 100)" }, 413);
  }
  const cleaned = items
    .filter((i): i is string => typeof i === "string")
    .map((i) => i.trim())
    .filter(Boolean)
    .slice(0, 100);

  const overrideServings = Number.isFinite(Number(body?.servings))
    ? Number(body!.servings)
    : null;

  const safeSlug = (s: unknown): string | null => {
    if (typeof s !== "string") return null;
    const c = s.trim().toLowerCase().replace(/[^a-z_]/g, "");
    return c.length > 0 && c.length <= 30 ? c : null;
  };
  const cuisineFilter = safeSlug(body?.cuisine);
  const proteinFilter = safeSlug(body?.protein);
  // v1.26 #312 — multi-cuisine slug array. Sanitized through the same
  // safeSlug as the single filter so a bad input can't inject prompt
  // content. Capped at 8 cuisines (UI shows 12; we don't trust the wire).
  // Only honored in weekly mode — see prompt assembly below.
  const cuisinesArrRaw = Array.isArray(body?.cuisines) ? body!.cuisines! : [];
  const cuisinesFilter = cuisinesArrRaw
    .map((c) => safeSlug(c))
    .filter((c): c is string => !!c)
    .slice(0, 8);
  const rawMaxIng = Number(body?.max_ingredients);
  const maxIngredients = Number.isFinite(rawMaxIng) && rawMaxIng >= 3 && rawMaxIng <= 20
    ? Math.round(rawMaxIng)
    : null;
  // v1.26 — mode determines recipe count + prompt wording. "weekly" returns
  // 5 dinners for Mon-Fri (client tags day labels post-hoc); "today" stays
  // at 3 recipes (current behavior). Anything else falls back to "today".
  const mode: "today" | "weekly" = body?.mode === "weekly" ? "weekly" : "today";
  const recipeCount = mode === "weekly" ? 5 : 3;

  // v1.16 Tier 2 — load dietary + portion prefs. Failures degrade to defaults.
  let prefs: ProfilePrefs;
  try {
    prefs = await loadProfile(userId);
  } catch (e) {
    console.error("loadProfile error (continuing with defaults)", e);
    prefs = { dietary: [], allergens: [], householdSize: 1 };
  }

  // ---- v1.26 cache lookup (cheap path) -----------------------------------
  // Normalize the user's items to lowercase and drop pantry staples so the
  // overlap math reflects "real" ingredient matches.
  const normalizedItems = cleaned
    .map(normalizeItem)
    .filter(Boolean)
    .filter(notPantryStaple);
  // v1.26 #312 — Skip cache for weekly-with-cuisines[] requests. The cache
  // key is single-cuisine, so a multi-cuisine weekly plan would either
  // miss-everything or hit-wrong-cuisine. We let those go straight to
  // Claude. Today mode + single-cuisine weekly still benefit from cache.
  const skipCacheForMultiCuisine = mode === "weekly" && cuisinesFilter.length > 0;
  const cacheHits = skipCacheForMultiCuisine
    ? []
    : await queryCache(
        normalizedItems,
        { cuisine: cuisineFilter, protein: proteinFilter, maxIngredients },
        prefs,
        recipeCount,
      );
  if (cacheHits.length >= recipeCount) {
    // Cache hit — bump counters, return without calling Claude. This path
    // does NOT decrement the user's daily Claude budget; cache hits are free.
    await bumpServeCounters(cacheHits.map((r) => r.id));
    return json({
      recipes: cacheHits.slice(0, recipeCount).map((r) => r.recipe),
      usage: { count: 0, limit: DAILY_LIMIT },  // unchanged — cache doesn't bill
      applied: {
        servings: overrideServings ?? prefs.householdSize,
        dietary: prefs.dietary,
        allergens: prefs.allergens,
        cuisine: cuisineFilter,
        cuisines: cuisinesFilter,
        protein: proteinFilter,
        max_ingredients: maxIngredients,
        mode,
      },
      source: "cache",
      cache_hits: cacheHits.length,
    });
  }

  // ---- Cache miss → Claude (paid path) -----------------------------------

  let rl;
  try {
    rl = await checkAndIncrement(userId, "generate_recipes", DAILY_LIMIT);
  } catch (e) {
    console.error("rate_limit error", e);
    return json({ error: "rate limit check failed" }, 500);
  }
  if (!rl.allowed) {
    return json(
      {
        error: `daily limit reached (${rl.limit}/day). Try again tomorrow.`,
        count: rl.count,
        limit: rl.limit,
      },
      429,
    );
  }

  const preamble = buildPromptPreamble(prefs, overrideServings);

  const cuisineLabel = cuisineFilter ? cuisineFilter.replace(/_/g, " ") : null;
  const proteinLabel = proteinFilter;
  const filterClauses: string[] = [];
  // v1.26 #312 — weekly multi-cuisine wins over the single-cuisine filter.
  // Today mode ignores cuisines[] entirely (single cuisine fits today's
  // single-pick UX); weekly mode uses cuisines[] when present, else falls
  // back to the single cuisine filter, else lets Claude vary across all.
  const weeklyCuisineLabels = (mode === "weekly" && cuisinesFilter.length > 0)
    ? cuisinesFilter.map((c) => c.replace(/_/g, " "))
    : null;
  if (mode === "weekly" && weeklyCuisineLabels && weeklyCuisineLabels.length > 0) {
    filterClauses.push(
      `Draw the 5 dinners from these cuisines: ${weeklyCuisineLabels.join(", ")}. Spread across them (e.g. one or two of each) so the week shows real variety. Don't drift into other cuisines unless honoring a dietary/allergen constraint requires it.`,
    );
  } else if (cuisineLabel) {
    filterClauses.push(
      `Prefer ${cuisineLabel} cuisine — flavor profile, techniques, and pantry staples typical of that tradition.`,
    );
  }
  if (proteinLabel) {
    filterClauses.push(
      `Center the dishes around ${proteinLabel} as the main protein when possible.`,
    );
  }
  if (maxIngredients) {
    filterClauses.push(
      `Keep ingredient lists to roughly ${maxIngredients} items or fewer per recipe (pantry staples like salt/pepper/oil don't count).`,
    );
  }
  const filterBlock = filterClauses.length > 0 ? " " + filterClauses.join(" ") : "";

  try {
    // v1.26 — prompt wording branches on mode. Today = casual "tonight"
    // framing; weekly = explicit 5-dinner workweek framing so Claude picks
    // a variety of cuisines/proteins across the 5 instead of 5 similar
    // chicken dishes. Recipe count flows in via recipeCount.
    const modeClause = mode === "weekly"
      ? `Suggest 5 dinner recipes for a Monday-through-Friday workweek that use as many of these ingredients as possible across the 5 nights. Vary the cuisines, proteins, and cooking methods so the week doesn't feel repetitive — but every recipe must still respect any dietary/allergen constraints stated above.`
      : `Suggest 3 recipes that use as many of them as possible.`;
    const prompt =
      `${preamble} I have these ingredients on hand: ${cleaned.join(", ")}. ` +
      `${modeClause}${filterBlock} ` +
      `For "emoji", pick ONE Unicode food emoji that matches the dish's main protein or category — ` +
      `🍗 chicken, 🥩 beef, 🐟 fish, 🦐 shrimp, 🥚 egg, 🥗 salad, 🍝 pasta, 🍕 pizza, 🌮 taco, ` +
      `🍲 stew/soup, 🥘 paella/braise, 🍛 curry, 🍳 fried egg/breakfast, 🥪 sandwich. ` +
      `Never use 🧅 onion or 🥬 lettuce unless that ingredient is the actual star of the dish. ` +
      `Respond ONLY with JSON array (no markdown): ` +
      `[{"name":"","time":"","difficulty":"","emoji":"","description":"","ingredients":[{"item":"","amount":""}],"instructions":[""],"tip":""}]`;
    const { text } = await callClaude({
      // Weekly needs more output tokens since we're returning 5 full recipes
      // (~400 tokens each) vs 3. Bumping to 3500 leaves headroom.
      max_tokens: mode === "weekly" ? 3500 : 2000,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    });
    const recipes = extractJson<unknown[]>(text);
    if (!Array.isArray(recipes)) return json({ error: "bad model output" }, 502);

    // v1.26 — write fresh recipes into the shared cache for future users.
    // The user's dietary/allergens become the cache row's safety tags;
    // Claude was instructed to honor both, so we trust the output.
    insertGeneratedRecipes(recipes, {
      cuisine: cuisineFilter,
      protein: proteinFilter,
      maxIngredients,
      dietary: prefs.dietary,
      safeForAllergens: prefs.allergens,
    }).catch((e) => console.warn("cache insert failed:", e));

    return json({
      recipes,
      usage: { count: rl.count, limit: rl.limit },
      applied: {
        servings: overrideServings ?? prefs.householdSize,
        dietary: prefs.dietary,
        allergens: prefs.allergens,
        cuisine: cuisineFilter,
        cuisines: cuisinesFilter,
        protein: proteinFilter,
        max_ingredients: maxIngredients,
        mode,
      },
      source: "claude",
    });
  } catch (e) {
    console.error("anthropic error", e);
    return json({ error: "recipe generation failed" }, 502);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
