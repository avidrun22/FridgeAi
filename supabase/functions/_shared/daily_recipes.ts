// _shared/daily_recipes.ts — v1.18
// =============================================================================
// One source of truth for "today's recipes" — used by:
//   • send-email-digest (renders recipes as cards in the morning email)
//   • send-smart-cook-night (drives the 6pm "make X tonight" push)
//
// Why a shared helper instead of HTTP-calling generate-recipes from cron?
//
//   generate-recipes is user-fronted: it expects a JWT, enforces a per-user
//   daily rate limit, and runs inside the user's auth context. Cron is
//   system-initiated — there's no user clicking anything. Trying to fake
//   user JWTs from cron, or burning the user's daily rate-limit budget on
//   automated digest sends, is the wrong shape.
//
//   Instead, this helper is a server-internal function that:
//     1. Loads the user's expiring fridge items from the service role
//     2. Loads the user's diet + household prefs from user_settings
//     3. Checks daily_recipe_cache for today's row
//     4. On cache miss, calls Claude directly via _shared/anthropic.ts
//     5. Writes the cache, returns recipes
//
// Caller responsibilities:
//   - Anyone calling getDailyRecipesForUser() should pass the service-role
//     supabase client (NOT the request's anon client). The cache table's
//     RLS only allows users to read their own rows; writes go through the
//     service role.
//   - The helper is intentionally permissive about failures — it returns
//     `null` on any error instead of throwing, so the digest can fall back
//     to "hide the recipe section" rather than crashing the whole send.
// =============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callClaude, extractJson } from "./anthropic.ts";

// ---- Public types ---------------------------------------------------------

export interface DailyRecipe {
  /** Stable per-user-per-day-per-position slug. Used for Universal Links. */
  id: string;
  name: string;
  time: string;        // "20 min"
  difficulty: string;  // "easy" | "medium" | "hard"
  emoji: string;
  description: string;
  ingredients: Array<{ item: string; amount: string }>;
  instructions: string[];
  tip: string;
  /** Subset of input fridge_items that this recipe uses. */
  uses_items: string[];
}

export interface DailyRecipesResult {
  recipes: DailyRecipe[];
  /** Items that were used as input to the prompt — for analytics. */
  sourceItems: string[];
  /** True if we hit the cache; false if we generated fresh. */
  fromCache: boolean;
}

// ---- Profile helpers (lifted from generate-recipes/index.ts) --------------

const DIETARY_PHRASES: Record<string, string> = {
  vegetarian:  "vegetarian (no meat, poultry, or fish)",
  vegan:       "vegan (no animal products at all — no meat, dairy, eggs, honey)",
  pescatarian: "pescatarian (no meat or poultry; fish is fine)",
  gluten_free: "gluten-free (no wheat, barley, rye, or conventional pasta/bread)",
  dairy_free:  "dairy-free (no milk, cheese, butter, yogurt, cream)",
  nut_free:    "nut-free (no peanuts or tree nuts)",
  low_carb:    "low-carb",
  keto:        "keto-friendly",
};

const ALLERGEN_PHRASES: Record<string, string> = {
  peanut:    "peanuts",
  tree_nut:  "tree nuts (almonds, walnuts, cashews, pecans, pistachios, etc.)",
  shellfish: "shellfish (shrimp, crab, lobster, scallops, mussels, clams)",
  fish:      "fish",
  egg:       "eggs",
  milk:      "milk or dairy",
  soy:       "soy",
  wheat:     "wheat",
  sesame:    "sesame",
};

interface UserProfile {
  dietary: string[];
  allergens: string[];
  householdSize: number;
}

async function loadProfile(supa: SupabaseClient, userId: string): Promise<UserProfile> {
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

/**
 * Stable hash of a user's profile state — used to invalidate the cache when
 * the user changes their dietary prefs mid-day. Sorting keys ensures
 * {dietary: ["a","b"]} hashes the same as {dietary: ["b","a"]}.
 */
function profileHash(p: UserProfile): string {
  const norm = {
    d: [...p.dietary].sort().join(","),
    a: [...p.allergens].sort().join(","),
    h: p.householdSize,
  };
  return JSON.stringify(norm);
}

function buildPromptPreamble(p: UserProfile): string {
  const parts: string[] = [];
  const dietary = p.dietary.map(d => DIETARY_PHRASES[d]).filter(Boolean);
  if (dietary.length === 1) parts.push(`I am ${dietary[0]}.`);
  else if (dietary.length > 1) parts.push(`I am ${dietary.join(" AND ")}.`);

  const allergens = p.allergens.map(a => ALLERGEN_PHRASES[a]).filter(Boolean);
  if (allergens.length > 0) {
    parts.push(
      `I have a serious allergy to ${allergens.join(", ")} — ` +
      `recipes MUST NOT contain these or any cross-contamination ingredients.`,
    );
  }
  parts.push(`Scale ingredient amounts to ${p.householdSize} ` +
    `${p.householdSize === 1 ? "serving" : "servings"}.`);
  return parts.join(" ");
}

// ---- Item-loading ---------------------------------------------------------

/**
 * Pulls the items most worth cooking from today — soonest-to-spoil first,
 * filtered to "active" status (excludes any pending or already-used items).
 * Caps at 12 items so the Claude prompt stays focused.
 */
async function loadExpiringItems(
  supa: SupabaseClient,
  userId: string,
  householdIds: string[],
): Promise<string[]> {
  // Pull from user's household, not just their own user_id, so a shared
  // fridge surfaces all relevant items.
  const ids = householdIds.length > 0 ? householdIds : null;

  // NOTE: fridge_items has no `status` column. A previous version selected it
  // and threw "column does not exist", silently returning [] → the digest's
  // recipe section quietly hid for every user. The v1.18/v1.19 hotfix
  // removed the `.or("status.is.null,status.eq.active")` filter but missed
  // the SELECT clause itself, so the bug persisted. Fix is to drop `status`
  // entirely — every fridge_items row is implicitly active.
  let q = supa
    .from("fridge_items")
    .select("name, expiry_date, is_opened, expiry_opened_days")
    .order("expiry_date", { ascending: true })
    .limit(12);

  if (ids) q = q.in("household_id", ids);
  else q = q.eq("user_id", userId);

  const { data, error } = await q;
  if (error || !data) return [];

  // Dedup by name — multiple yogurt entries shouldn't bias Claude toward
  // a yogurt-heavy menu.
  const seen = new Set<string>();
  const items: string[] = [];
  for (const row of data) {
    const name = (row.name || "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    items.push(name);
  }
  return items;
}

export async function getUserHouseholdIds(supa: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await supa
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId);
  return (data || []).map(r => r.household_id).filter(Boolean);
}

// ---- Cache I/O ------------------------------------------------------------

function todayKey(tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    });
    return fmt.format(new Date()); // YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

interface CacheRow {
  recipes: DailyRecipe[];
  source_items: string[];
  profile_hash: string;
}

async function readCache(
  supa: SupabaseClient,
  userId: string,
  forDate: string,
): Promise<CacheRow | null> {
  const { data } = await supa
    .from("daily_recipe_cache")
    .select("recipes, source_items, profile_hash")
    .eq("user_id", userId)
    .eq("for_date", forDate)
    .maybeSingle();
  return (data as CacheRow | null) || null;
}

async function writeCache(
  supa: SupabaseClient,
  userId: string,
  forDate: string,
  recipes: DailyRecipe[],
  sourceItems: string[],
  hash: string,
): Promise<void> {
  await supa.from("daily_recipe_cache").upsert(
    {
      user_id: userId,
      for_date: forDate,
      recipes,
      source_items: sourceItems,
      profile_hash: hash,
    },
    { onConflict: "user_id,for_date" },
  );
}

// ---- Recipe ID ------------------------------------------------------------

/**
 * Stable, URL-safe slug for a generated recipe. The id is composed of:
 *   - the user's id (truncated)
 *   - the for_date
 *   - the recipe's position in the array (0/1/2)
 *
 * That keeps the iOS app's Universal Link handler simple: /recipes/{id} maps
 * directly to a (user, date, position) tuple it can fetch from the cache.
 */
function makeRecipeId(userId: string, forDate: string, position: number): string {
  const u = userId.replace(/-/g, "").slice(0, 12);
  const d = forDate.replace(/-/g, "");
  return `${d}-${u}-${position}`;
}

// ---- Claude prompt --------------------------------------------------------

interface RawRecipe {
  name?: string;
  time?: string;
  difficulty?: string;
  emoji?: string;
  description?: string;
  ingredients?: Array<{ item?: string; amount?: string }>;
  instructions?: string[];
  tip?: string;
  uses_items?: string[];
}

async function generateRecipesViaClaude(
  preamble: string,
  items: string[],
): Promise<DailyRecipe[] | null> {
  const prompt =
    `${preamble} I have these ingredients on hand: ${items.join(", ")}. ` +
    `Suggest 3 recipes that use as many of them as possible, prioritizing ` +
    `the ones I listed first (they're closest to spoiling). ` +
    `For each recipe include a "uses_items" array listing which of my ingredients it uses. ` +
    `Respond ONLY with JSON array (no markdown): ` +
    `[{"name":"","time":"","difficulty":"","emoji":"","description":"",` +
    `"ingredients":[{"item":"","amount":""}],"instructions":[""],"tip":"",` +
    `"uses_items":[""]}]`;

  try {
    const { text } = await callClaude({
      max_tokens: 2000,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    });
    const raw = extractJson<RawRecipe[]>(text);
    if (!Array.isArray(raw)) return null;

    // Normalize — id is filled in by the caller (needs userId + forDate).
    return raw.slice(0, 3).map((r): DailyRecipe => ({
      id: "", // filled in below
      name: String(r.name || "").trim() || "Recipe",
      time: String(r.time || "").trim(),
      difficulty: String(r.difficulty || "").trim(),
      emoji: String(r.emoji || "🍳").trim(),
      description: String(r.description || "").trim(),
      ingredients: Array.isArray(r.ingredients)
        ? r.ingredients.map(i => ({
            item: String(i.item || "").trim(),
            amount: String(i.amount || "").trim(),
          })).filter(i => i.item)
        : [],
      instructions: Array.isArray(r.instructions)
        ? r.instructions.map(s => String(s).trim()).filter(Boolean)
        : [],
      tip: String(r.tip || "").trim(),
      uses_items: Array.isArray(r.uses_items)
        ? r.uses_items.map(s => String(s).trim()).filter(Boolean)
        : [],
    }));
  } catch (e) {
    console.error("generateRecipesViaClaude error:", e);
    return null;
  }
}

// ---- Public API -----------------------------------------------------------

/**
 * Fetches (or generates + caches) today's 3 recipes for the given user.
 * Returns `null` on any error — callers should fall back gracefully
 * (hide the section in the digest, skip the push, etc.).
 *
 * @param supa Service-role Supabase client.
 * @param userId User id (auth.users.id).
 * @param tz IANA timezone — used to determine "today's" date boundary.
 *           Falls back to UTC if undefined.
 */
export async function getDailyRecipesForUser(
  supa: SupabaseClient,
  userId: string,
  tz: string = "UTC",
): Promise<DailyRecipesResult | null> {
  try {
    const forDate = todayKey(tz);

    // Load profile early; we need its hash to validate any cache hit.
    const profile = await loadProfile(supa, userId);
    const hash = profileHash(profile);

    // Cache check — only honor the row if the user's profile hasn't changed
    // since generation. Profile change should invalidate even if the cache
    // row is fresh.
    const cached = await readCache(supa, userId, forDate);
    if (cached && cached.profile_hash === hash &&
        Array.isArray(cached.recipes) && cached.recipes.length > 0) {
      return {
        recipes: cached.recipes,
        sourceItems: cached.source_items || [],
        fromCache: true,
      };
    }

    // Cache miss (or invalidated by profile change) — fetch items and
    // call Claude.
    const householdIds = await getUserHouseholdIds(supa, userId);
    const items = await loadExpiringItems(supa, userId, householdIds);
    if (items.length === 0) {
      // No fridge items → no recipes. Cache an empty row anyway so we
      // don't hammer the user_settings + fridge_items queries on every
      // cron tick today. Empty cache means "we tried and there was
      // nothing to suggest."
      await writeCache(supa, userId, forDate, [], [], hash);
      return { recipes: [], sourceItems: [], fromCache: false };
    }

    const preamble = buildPromptPreamble(profile);
    const generated = await generateRecipesViaClaude(preamble, items);
    if (!generated) return null;

    // Fill in stable ids before persisting.
    const withIds: DailyRecipe[] = generated.map((r, i) => ({
      ...r,
      id: makeRecipeId(userId, forDate, i),
    }));

    // Persist before returning so the next call (from the 6pm push) hits
    // the cache. Don't fail the whole call if the cache write errors —
    // we'd rather serve a non-cached recipe than nothing.
    try {
      await writeCache(supa, userId, forDate, withIds, items, hash);
    } catch (e) {
      console.error("daily_recipes cache write failed (continuing):", e);
    }

    return { recipes: withIds, sourceItems: items, fromCache: false };
  } catch (e) {
    console.error("getDailyRecipesForUser failed:", e);
    return null;
  }
}
