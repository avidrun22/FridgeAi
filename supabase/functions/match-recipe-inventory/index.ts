// match-recipe-inventory — v1.19
// =============================================================================
// The differentiating piece of the v1.19 recipe browser. When a user taps
// "Make this — set up shopping list" on a recipe, this function:
//
//   1. Loads the recipe (bank.slug OR daily_recipe_cache.id format)
//   2. Loads the user's current fridge_items (household-aware)
//   3. Asks Claude to judge "which of these fridge items satisfy which
//      recipe ingredient?" — returns a per-ingredient match
//   4. Caches the result by (user_id, recipe_id, fridge_hash) so re-taps
//      within the same fridge state are free
//   5. Returns a confirmation-sheet-shaped payload
//
// Claude is the matcher because exact string match is too brittle for the
// "red onion" / "onion" / "sweet onion" / "yellow onion" / "EVOO vs olive
// oil" long tail. We pay ~$0.001-0.003 per uncached call; cached hits are
// free. See §3e of docs/v1_19_recipe_browser_spec.md.
//
// AUTH: requires the caller's JWT. The match result is per-user (depends
// on their specific fridge contents), so we identify the caller and reject
// anonymous calls.
//
// Body shape:
//   { recipe_id: string }     // bank slug OR daily_recipe_cache id
//
// Response shape:
//   { recipe_id: string,
//     fridge_hash: string,    // for client-side cache awareness
//     matched: [{ ingredient: string, amount: string, fridge_item: string }],
//     missing:  [{ ingredient: string, amount: string }],
//     unmatched_fridge_items: string[],   // items in fridge not used by this recipe
//     cached: boolean }       // true if served from match-cache
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";

const CACHE_TTL_DAYS = 7;

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

// ---- Recipe loading --------------------------------------------------------

interface RecipeIngredient {
  item: string;
  amount: string;
}

interface LoadedRecipe {
  id: string;
  name: string;
  ingredients: RecipeIngredient[];
  source: "bank" | "daily_cache";
}

/**
 * Resolves a recipe_id to ingredients. Tries recipe_bank by slug first,
 * then daily_recipe_cache (matches the id format YYYYMMDD-{userid12}-{position}).
 */
async function loadRecipe(
  supa: ReturnType<typeof serviceClient>,
  userId: string,
  recipeId: string,
): Promise<LoadedRecipe | null> {
  // Try bank by slug
  const { data: bank } = await supa
    .from("recipe_bank")
    .select("slug, name, ingredients")
    .eq("slug", recipeId)
    .maybeSingle();
  if (bank) {
    const ings = Array.isArray(bank.ingredients) ? bank.ingredients : [];
    return {
      id: String(bank.slug),
      name: String(bank.name),
      ingredients: ings.map((i: { item?: string; amount?: string }) => ({
        item: String(i.item || "").trim(),
        amount: String(i.amount || "").trim(),
      })).filter((i: RecipeIngredient) => i.item),
      source: "bank",
    };
  }

  // Try daily_recipe_cache — id encodes (date, userid12, position).
  // For security, only serve cached recipes for the calling user. The id
  // format is YYYYMMDD-{userid_first_12_chars_no_hyphens}-{position}.
  const m = recipeId.match(/^(\d{8})-([a-f0-9]{12})-(\d+)$/i);
  if (!m) return null;
  const userIdShort = userId.replace(/-/g, "").slice(0, 12);
  if (m[2].toLowerCase() !== userIdShort.toLowerCase()) return null;

  const yyyy = m[1].slice(0, 4), mm = m[1].slice(4, 6), dd = m[1].slice(6, 8);
  const forDate = `${yyyy}-${mm}-${dd}`;
  const position = parseInt(m[3], 10);

  const { data: cache } = await supa
    .from("daily_recipe_cache")
    .select("recipes")
    .eq("user_id", userId)
    .eq("for_date", forDate)
    .maybeSingle();
  const recipes = (cache?.recipes || []) as Array<{
    id: string;
    name: string;
    ingredients: Array<{ item?: string; amount?: string }>;
  }>;
  const hit = recipes[position];
  if (!hit) return null;

  return {
    id: hit.id || recipeId,
    name: hit.name || "Recipe",
    ingredients: (hit.ingredients || []).map(i => ({
      item: String(i.item || "").trim(),
      amount: String(i.amount || "").trim(),
    })).filter(i => i.item),
    source: "daily_cache",
  };
}

// ---- Fridge loading --------------------------------------------------------

interface FridgeItemRow {
  id: string;
  name: string;
  household_id: string | null;
}

async function loadFridgeItems(
  supa: ReturnType<typeof serviceClient>,
  userId: string,
): Promise<FridgeItemRow[]> {
  const { data: members } = await supa
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId);
  const householdIds = (members || []).map(m => m.household_id).filter(Boolean);

  // fridge_items has no status column today; pulling all rows for the user/household.
  let q = supa
    .from("fridge_items")
    .select("id, name, household_id")
    .limit(60);

  if (householdIds.length > 0) q = q.in("household_id", householdIds);
  else q = q.eq("user_id", userId);

  const { data, error } = await q;
  if (error || !data) return [];

  // Dedupe by lowercase name — multiple yogurt entries shouldn't show up
  // as multiple matches.
  const seen = new Set<string>();
  const out: FridgeItemRow[] = [];
  for (const row of data) {
    const key = (row.name || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * Hash of the user's fridge state used as a cache key. We want the hash to
 * change whenever the items relevant to matching change — adding/removing
 * an item, renaming, etc. Sorted lowercase names → JSON → hash.
 */
async function hashFridge(items: FridgeItemRow[]): Promise<string> {
  const names = items.map(i => (i.name || "").trim().toLowerCase()).sort();
  const text = JSON.stringify(names);
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).slice(0, 16)
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---- Match cache -----------------------------------------------------------
//
// Schema: recipe_inventory_match_cache (user_id, recipe_id, fridge_hash) PK
// + match_result JSONB + created_at. See migration
// 20260514_v119_match_cache.sql. If the table doesn't exist (migration not
// yet applied), this gracefully degrades to "always miss" — the function
// still works, just pays Claude every time.

interface MatchResult {
  matched: Array<{ ingredient: string; amount: string; fridge_item: string }>;
  missing: Array<{ ingredient: string; amount: string }>;
  unmatched_fridge_items: string[];
}

async function readMatchCache(
  supa: ReturnType<typeof serviceClient>,
  userId: string,
  recipeId: string,
  fridgeHash: string,
): Promise<MatchResult | null> {
  try {
    const { data } = await supa
      .from("recipe_inventory_match_cache")
      .select("match_result, created_at")
      .eq("user_id", userId)
      .eq("recipe_id", recipeId)
      .eq("fridge_hash", fridgeHash)
      .maybeSingle();
    if (!data) return null;
    // TTL check
    const age = Date.now() - new Date(data.created_at as string).getTime();
    if (age > CACHE_TTL_DAYS * 24 * 3600 * 1000) return null;
    return data.match_result as MatchResult;
  } catch {
    return null;
  }
}

async function writeMatchCache(
  supa: ReturnType<typeof serviceClient>,
  userId: string,
  recipeId: string,
  fridgeHash: string,
  result: MatchResult,
): Promise<void> {
  try {
    await supa.from("recipe_inventory_match_cache").upsert(
      {
        user_id: userId,
        recipe_id: recipeId,
        fridge_hash: fridgeHash,
        match_result: result,
      },
      { onConflict: "user_id,recipe_id,fridge_hash" },
    );
  } catch (e) {
    console.warn("match cache write failed (continuing):", e);
  }
}

// ---- Claude matcher --------------------------------------------------------

const SYSTEM_PROMPT =
  "You are an inventory-matching assistant for a fridge-tracking app. For each " +
  "recipe ingredient, decide whether any of the user's current fridge items " +
  "satisfies it. Use common sense — 'chicken breasts' satisfies 'chicken'; " +
  "'Greek yogurt' satisfies 'plain yogurt'; 'red onion' and 'yellow onion' " +
  "both satisfy 'onion'; 'EVOO' satisfies 'olive oil'. But 'milk' does NOT " +
  "satisfy 'heavy cream', and 'parsley' does NOT satisfy 'cilantro'. " +
  "Respond ONLY with JSON — no markdown, no commentary.";

interface RawMatch {
  ingredient?: string;
  amount?: string;
  fridge_item?: string | null;
}

function buildUserPrompt(recipe: LoadedRecipe, fridge: FridgeItemRow[]): string {
  return [
    `Recipe: ${recipe.name}`,
    "",
    "Recipe ingredients:",
    ...recipe.ingredients.map((i, idx) => `  ${idx + 1}. ${i.item} (${i.amount})`),
    "",
    "User's current fridge items:",
    ...fridge.map((i, idx) => `  - ${i.name}`),
    "",
    "For each recipe ingredient, return whether any fridge item satisfies it, and which one.",
    "If multiple fridge items could satisfy an ingredient, pick the closest match.",
    "Return ONLY this JSON shape (no markdown):",
    "",
    `{`,
    `  "matches": [`,
    `    { "ingredient": "<recipe ingredient name verbatim>",`,
    `      "amount": "<recipe amount verbatim>",`,
    `      "fridge_item": "<fridge item name verbatim, or null if no match>" }`,
    `  ]`,
    `}`,
    "",
    "Constraints:",
    "- Return an entry for EVERY recipe ingredient, in order.",
    "- fridge_item must be either the exact name from the fridge list above, or null.",
    "- Do NOT invent ingredients or fridge items.",
  ].join("\n");
}

async function callClaude(prompt: string): Promise<{ matches: RawMatch[] }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const resp = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`anthropic ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  let text = "";
  if (Array.isArray(data.content)) {
    for (const b of data.content) {
      if (b?.type === "text") text += b.text || "";
    }
  }
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

function buildResult(
  recipe: LoadedRecipe,
  fridge: FridgeItemRow[],
  claudeMatches: RawMatch[],
): MatchResult {
  // Normalize: walk recipe ingredients in order, find each in the claude
  // response. Use claude's match if present and the fridge_item is a
  // recognized fridge name (defense against hallucination); otherwise mark
  // as missing.
  const fridgeNamesLower = new Set(fridge.map(f => f.name.toLowerCase()));
  const matched: MatchResult["matched"] = [];
  const missing: MatchResult["missing"] = [];
  const usedFridge = new Set<string>();

  for (let i = 0; i < recipe.ingredients.length; i++) {
    const ing = recipe.ingredients[i];
    const claudeRow = claudeMatches[i];
    const candidate = claudeRow?.fridge_item;
    if (candidate && fridgeNamesLower.has(candidate.toLowerCase())) {
      matched.push({
        ingredient: ing.item,
        amount: ing.amount,
        fridge_item: candidate,
      });
      usedFridge.add(candidate.toLowerCase());
    } else {
      missing.push({ ingredient: ing.item, amount: ing.amount });
    }
  }

  const unmatched_fridge_items = fridge
    .filter(f => !usedFridge.has(f.name.toLowerCase()))
    .map(f => f.name);

  return { matched, missing, unmatched_fridge_items };
}

// ---- Handler ---------------------------------------------------------------

interface Body {
  recipe_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supa = serviceClient();
  const userId = await getUserIdFromJwt(req, supa);
  if (!userId) return json({ error: "unauthenticated" }, 401);

  let body: Body = {};
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  const recipeId = (body.recipe_id || "").trim();
  if (!recipeId) return json({ error: "recipe_id required" }, 400);

  try {
    const recipe = await loadRecipe(supa, userId, recipeId);
    if (!recipe) return json({ error: "recipe not found" }, 404);
    if (recipe.ingredients.length === 0) {
      return json({
        recipe_id: recipeId,
        fridge_hash: "",
        matched: [],
        missing: [],
        unmatched_fridge_items: [],
        cached: false,
      });
    }

    const fridge = await loadFridgeItems(supa, userId);
    const fridgeHash = await hashFridge(fridge);

    // Cache hit?
    const cached = await readMatchCache(supa, userId, recipeId, fridgeHash);
    if (cached) {
      return json({
        recipe_id: recipeId,
        fridge_hash: fridgeHash,
        ...cached,
        cached: true,
      });
    }

    // Empty fridge → everything is missing.
    if (fridge.length === 0) {
      const result: MatchResult = {
        matched: [],
        missing: recipe.ingredients.map(i => ({ ingredient: i.item, amount: i.amount })),
        unmatched_fridge_items: [],
      };
      await writeMatchCache(supa, userId, recipeId, fridgeHash, result);
      return json({
        recipe_id: recipeId,
        fridge_hash: fridgeHash,
        ...result,
        cached: false,
      });
    }

    // Claude match.
    const prompt = buildUserPrompt(recipe, fridge);
    const parsed = await callClaude(prompt);
    const result = buildResult(recipe, fridge, parsed.matches || []);
    await writeMatchCache(supa, userId, recipeId, fridgeHash, result);

    return json({
      recipe_id: recipeId,
      fridge_hash: fridgeHash,
      ...result,
      cached: false,
    });
  } catch (e) {
    console.error("match-recipe-inventory error:", e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
