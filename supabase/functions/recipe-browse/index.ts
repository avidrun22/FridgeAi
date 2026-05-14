// recipe-browse — v1.19
// =============================================================================
// Powers the new Recipes section in the Plan tab. Three modes via the `tab`
// field in the request body:
//
//   tab: "tonight"  → personalized picks ranked by how many of the user's
//                     expiring fridge items each recipe uses. Returns the 3
//                     daily_recipe_cache picks (if today's row exists) on top,
//                     then bank recipes ranked by overlap. Requires JWT.
//
//   tab: "browse"   → bank catalog filtered by meal_type + dietary_tags. No
//                     fridge context. Anon-accessible — recipe_bank RLS is
//                     public-read.
//
//   tab: "search"   → full-text search against recipe_bank (name + description)
//                     using the GIN tsvector index from the v1.19 migration.
//                     Anon-accessible.
//
// Card-shape output: each recipe returned is the SUBSET the iOS browse list
// needs (id, name, emoji, time, difficulty, meal_type, cuisine, dietary_tags,
// description, optional fridge_overlap_count). Full recipe (ingredients +
// instructions + tip) is loaded separately when the user taps into the
// RecipeSheet — the existing /recipes/{id} deep-link handler.
//
// Body shape:
//   { tab: "tonight" | "browse" | "search",
//     q?: string,                  // search query (search tab)
//     meal_type?: string,          // breakfast | lunch | dinner | snack | dessert
//     dietary?: string[],          // ["vegan", "gluten_free", ...] - all must match
//     limit?: number,              // default 24, max 50
//     offset?: number }            // default 0
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/**
 * Pull caller's user_id from the Authorization header. Returns null for
 * unauthenticated calls (browse + search still work in that case).
 */
async function getUserIdFromJwt(
  req: Request,
  supa: ReturnType<typeof serviceClient>,
): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  try {
    const { data } = await supa.auth.getUser(token);
    return data?.user?.id || null;
  } catch {
    return null;
  }
}

// ---- Public card shape -----------------------------------------------------

interface RecipeCard {
  id: string;              // bank.slug OR daily_recipe_cache id ("YYYYMMDD-{userid12}-{position}")
  source: "bank" | "daily_cache";
  name: string;
  emoji: string;
  time_minutes: number | null;
  difficulty: string | null;
  meal_type: string | null;
  cuisine: string | null;
  dietary_tags: string[];
  description: string | null;
  fridge_overlap_count?: number;  // present on Tonight tab only
}

// ---- Bank query helpers ----------------------------------------------------

function cardFromBank(row: Record<string, unknown>): RecipeCard {
  return {
    id: String(row.slug),
    source: "bank",
    name: String(row.name),
    emoji: String(row.emoji || "🍳"),
    time_minutes: typeof row.time_minutes === "number" ? row.time_minutes : null,
    difficulty: row.difficulty ? String(row.difficulty) : null,
    meal_type: row.meal_type ? String(row.meal_type) : null,
    cuisine: row.cuisine ? String(row.cuisine) : null,
    dietary_tags: Array.isArray(row.dietary_tags) ? (row.dietary_tags as string[]) : [],
    description: row.description ? String(row.description) : null,
  };
}

// daily_recipe_cache stores recipes as { id, name, emoji, time, difficulty,
// description, ingredients[], instructions[], tip, uses_items[] }. Note: `time`
// is a string like "20 min", not numeric. We parse it best-effort.
interface CachedRecipe {
  id: string;
  name: string;
  emoji: string;
  time?: string;
  difficulty?: string;
  description?: string;
}

function parseTimeString(t: string | undefined): number | null {
  if (!t) return null;
  const m = t.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function cardFromCache(r: CachedRecipe): RecipeCard {
  return {
    id: r.id,
    source: "daily_cache",
    name: r.name,
    emoji: r.emoji || "🍳",
    time_minutes: parseTimeString(r.time),
    difficulty: r.difficulty || null,
    meal_type: null,        // not tracked on cache rows
    cuisine: null,
    dietary_tags: [],       // we don't tag cache recipes; the user's profile already filtered them
    description: r.description || null,
  };
}

// ---- Tonight ranking -------------------------------------------------------

/**
 * Token-based overlap score. Tokenize each fridge item name + each recipe
 * ingredient item name; count distinct fridge items that share at least one
 * token with at least one ingredient. Plurals get a crude pass via trailing-s
 * strip — good enough for "egg" matching "eggs" and "tomato" matching
 * "tomatoes".
 */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "with", "without", "to", "in", "on",
  "for", "from", "fresh", "dried", "frozen", "raw", "cooked", "boneless",
  "skinless", "large", "small", "medium", "whole", "ground", "chopped",
  "diced", "sliced", "thinly", "thickly", "minced", "grated", "shredded",
  "extra", "virgin", "olive", "salt", "pepper", "water", "ice",
]);

function tokenize(name: string): Set<string> {
  const out = new Set<string>();
  for (const word of name.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!word || word.length < 3) continue;
    if (STOPWORDS.has(word)) continue;
    out.add(word);
    if (word.endsWith("es") && word.length > 4) out.add(word.slice(0, -2));
    else if (word.endsWith("s") && word.length > 3) out.add(word.slice(0, -1));
  }
  return out;
}

interface FridgeItemRow {
  name: string;
  household_id: string | null;
  user_id: string;
}

async function loadCallerFridgeTokens(
  supa: ReturnType<typeof serviceClient>,
  userId: string,
): Promise<Set<string>> {
  // Pull household ids
  const { data: members } = await supa
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId);
  const householdIds = (members || []).map(m => m.household_id).filter(Boolean);

  // fridge_items has no status column today — every row is implicitly active.
  // (v1.18 daily_recipes had this filter too, but it errored silently.)
  let q = supa
    .from("fridge_items")
    .select("name, household_id, user_id");

  if (householdIds.length > 0) q = q.in("household_id", householdIds);
  else q = q.eq("user_id", userId);

  const { data, error } = await q.limit(50);
  if (error || !data) return new Set();

  const tokens = new Set<string>();
  for (const row of data as FridgeItemRow[]) {
    for (const t of tokenize(row.name)) tokens.add(t);
  }
  return tokens;
}

interface IngredientEntry {
  item?: string;
  amount?: string;
}

function scoreRecipeAgainstFridge(
  ingredients: IngredientEntry[],
  fridgeTokens: Set<string>,
): number {
  if (fridgeTokens.size === 0) return 0;
  // Count distinct ingredients that match at least one fridge token.
  let hits = 0;
  for (const ing of ingredients) {
    const name = (ing.item || "").trim();
    if (!name) continue;
    const ingTokens = tokenize(name);
    let matched = false;
    for (const t of ingTokens) {
      if (fridgeTokens.has(t)) { matched = true; break; }
    }
    if (matched) hits++;
  }
  return hits;
}

// ---- Today's cache rows (for Tonight overlap) ------------------------------

async function todaysCacheCards(
  supa: ReturnType<typeof serviceClient>,
  userId: string,
  tz: string,
): Promise<RecipeCard[]> {
  // Compute today's date in user's tz.
  let forDate: string;
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    });
    forDate = fmt.format(new Date());
  } catch {
    forDate = new Date().toISOString().slice(0, 10);
  }

  const { data } = await supa
    .from("daily_recipe_cache")
    .select("recipes")
    .eq("user_id", userId)
    .eq("for_date", forDate)
    .maybeSingle();

  const recipes = (data?.recipes || []) as CachedRecipe[];
  return recipes.filter(r => r && r.id && r.name).map(cardFromCache);
}

// ---- Tabs ------------------------------------------------------------------

async function tonightTab(
  supa: ReturnType<typeof serviceClient>,
  userId: string,
  filters: { meal_type?: string; dietary?: string[] },
  limit: number,
): Promise<{ recipes: RecipeCard[]; total: number }> {
  // 1) Load user's tz from user_settings (defaults to UTC).
  const { data: settings } = await supa
    .from("user_settings")
    .select("digest_timezone")
    .eq("user_id", userId)
    .maybeSingle();
  const tz = settings?.digest_timezone || "UTC";

  // 2) Today's morning-digest picks (if any).
  const cacheCards = await todaysCacheCards(supa, userId, tz);
  const cacheCardSlugs = new Set(cacheCards.map(c => c.name.toLowerCase()));

  // 3) Score remaining bank rows by fridge overlap.
  const fridgeTokens = await loadCallerFridgeTokens(supa, userId);

  let q = supa
    .from("recipe_bank")
    .select("slug, name, emoji, time_minutes, difficulty, meal_type, cuisine, dietary_tags, description, ingredients");
  if (filters.meal_type) q = q.eq("meal_type", filters.meal_type);
  if (filters.dietary && filters.dietary.length > 0) q = q.contains("dietary_tags", filters.dietary);

  const { data: bank, error } = await q.limit(300);
  if (error) throw new Error(`recipe_bank query: ${error.message}`);

  type BankRow = Record<string, unknown> & { ingredients: IngredientEntry[]; name: string };
  const scored = (bank as BankRow[] || [])
    .filter(r => !cacheCardSlugs.has(String(r.name).toLowerCase()))
    .map(r => ({
      card: cardFromBank(r),
      score: scoreRecipeAgainstFridge(r.ingredients || [], fridgeTokens),
    }))
    // Stable sort: higher overlap first; ties broken by name for determinism.
    .sort((a, b) => (b.score - a.score) || a.card.name.localeCompare(b.card.name));

  // 4) Compose: cache picks first, then top-scored bank picks. Annotate overlap_count.
  const decoratedCache: RecipeCard[] = cacheCards.map(c => ({
    ...c,
    fridge_overlap_count: undefined,  // we don't re-score cache picks; they're already personalized
  }));
  const decoratedBank: RecipeCard[] = scored.map(s => ({
    ...s.card,
    fridge_overlap_count: s.score,
  }));

  const merged = [...decoratedCache, ...decoratedBank].slice(0, limit);
  return { recipes: merged, total: merged.length };
}

async function browseTab(
  supa: ReturnType<typeof serviceClient>,
  filters: { meal_type?: string; dietary?: string[] },
  limit: number,
  offset: number,
): Promise<{ recipes: RecipeCard[]; total: number }> {
  let q = supa
    .from("recipe_bank")
    .select("slug, name, emoji, time_minutes, difficulty, meal_type, cuisine, dietary_tags, description", { count: "exact" });
  if (filters.meal_type) q = q.eq("meal_type", filters.meal_type);
  if (filters.dietary && filters.dietary.length > 0) q = q.contains("dietary_tags", filters.dietary);

  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`recipe_bank browse: ${error.message}`);

  return {
    recipes: (data || []).map(cardFromBank),
    total: count || (data?.length ?? 0),
  };
}

async function searchTab(
  supa: ReturnType<typeof serviceClient>,
  q: string,
  filters: { meal_type?: string; dietary?: string[] },
  limit: number,
  offset: number,
): Promise<{ recipes: RecipeCard[]; total: number }> {
  // Postgres .textSearch with 'websearch' config gives a Google-like query parser
  // — quoted phrases, OR, etc. Falls back gracefully on single-word queries.
  let query = supa
    .from("recipe_bank")
    .select("slug, name, emoji, time_minutes, difficulty, meal_type, cuisine, dietary_tags, description", { count: "exact" })
    .textSearch("name", q, { type: "websearch", config: "english" });
  if (filters.meal_type) query = query.eq("meal_type", filters.meal_type);
  if (filters.dietary && filters.dietary.length > 0) query = query.contains("dietary_tags", filters.dietary);

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw new Error(`recipe_bank search: ${error.message}`);

  return {
    recipes: (data || []).map(cardFromBank),
    total: count || (data?.length ?? 0),
  };
}

// ---- Handler ---------------------------------------------------------------

interface Body {
  tab?: "tonight" | "browse" | "search";
  q?: string;
  meal_type?: string;
  dietary?: string[];
  limit?: number;
  offset?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supa = serviceClient();

  let body: Body = {};
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  const tab = body.tab || "browse";
  if (!["tonight", "browse", "search"].includes(tab)) {
    return json({ error: `invalid tab: ${tab}` }, 400);
  }

  // Clamp pagination
  const limit = Math.min(Math.max(parseInt(String(body.limit ?? 24), 10) || 24, 1), 50);
  const offset = Math.max(parseInt(String(body.offset ?? 0), 10) || 0, 0);

  const filters = {
    meal_type: typeof body.meal_type === "string" ? body.meal_type : undefined,
    dietary: Array.isArray(body.dietary) ? body.dietary : undefined,
  };

  try {
    if (tab === "tonight") {
      const userId = await getUserIdFromJwt(req, supa);
      if (!userId) return json({ error: "tonight tab requires authentication" }, 401);
      const out = await tonightTab(supa, userId, filters, limit);
      return json({ tab, ...out });
    }

    if (tab === "search") {
      const q = (body.q || "").trim();
      if (!q) return json({ tab, recipes: [], total: 0 });
      const out = await searchTab(supa, q, filters, limit, offset);
      return json({ tab, ...out });
    }

    // browse
    const out = await browseTab(supa, filters, limit, offset);
    return json({ tab, ...out });
  } catch (e) {
    console.error(`recipe-browse error (tab=${tab}):`, e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
