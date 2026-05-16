// POST /functions/v1/generate-recipes
// Body: { items: ["Milk", "Eggs", ...], servings?: number }
// Auth: required. Rate limit: GENERATE_RECIPES_DAILY_LIMIT/day/user.
// Response: { recipes: [...], usage: {count, limit}, applied: {servings, dietary, allergens} }
//
// v1.16 Tier 2 — pulls the caller's user_settings (dietary_restrictions,
// allergens, household_size) and injects them into the prompt so the
// generated recipes respect lifestyle + safety constraints and scale to the
// right serving count. `servings` body param lets a single recipe override
// the user's default household_size (e.g. "this one's just for me tonight").
import { corsHeaders } from "../_shared/cors.ts";
import { getUserId, serviceClient } from "../_shared/supabase.ts";
import { checkAndIncrement } from "../_shared/rate_limit.ts";
import { callClaude, extractJson } from "../_shared/anthropic.ts";

const DAILY_LIMIT = parseInt(
  Deno.env.get("GENERATE_RECIPES_DAILY_LIMIT") || "10",
  10,
);

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

  // Dietary lifestyle (preferences)
  const dietaryClauses = prefs.dietary
    .map(d => DIETARY_PHRASES[d])
    .filter(Boolean);
  if (dietaryClauses.length === 1) {
    parts.push(`I am ${dietaryClauses[0]}.`);
  } else if (dietaryClauses.length > 1) {
    parts.push(`I am ${dietaryClauses.join(" AND ")}.`);
  }

  // Allergens (safety-critical — must-not-contain)
  const allergenClauses = prefs.allergens
    .map(a => ALLERGEN_PHRASES[a])
    .filter(Boolean);
  if (allergenClauses.length > 0) {
    parts.push(
      `I have a serious allergy to ${allergenClauses.join(", ")} — ` +
      `recipes MUST NOT contain these or any cross-contamination ingredients.`,
    );
  }

  // Serving count — prefer the per-request override, fall back to the
  // user's default household_size.
  const servings = overrideServings && Number.isFinite(overrideServings)
    ? Math.max(1, Math.min(20, Math.round(overrideServings)))
    : prefs.householdSize;
  parts.push(`Scale ingredient amounts to ${servings} ${servings === 1 ? "serving" : "servings"}.`);

  return parts.join(" ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const userId = await getUserId(req);
  if (!userId) return json({ error: "unauthenticated" }, 401);

  let body: { items?: string[]; servings?: number };
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

  // v1.16 Tier 2 — load dietary + portion prefs and inject into prompt.
  // Failures here degrade gracefully to "no preferences" rather than 500.
  let prefs: ProfilePrefs;
  try {
    prefs = await loadProfile(userId);
  } catch (e) {
    console.error("loadProfile error (continuing with defaults)", e);
    prefs = { dietary: [], allergens: [], householdSize: 1 };
  }
  const preamble = buildPromptPreamble(prefs, overrideServings);

  try {
    const prompt =
      `${preamble} I have these ingredients on hand: ${cleaned.join(", ")}. ` +
      `Suggest 3 recipes that use as many of them as possible. ` +
      // v1.21 — emoji guidance. Earlier model picks were occasionally
      // unrelated (e.g. onion 🧅 for "Pan-Seared Chicken"), confusing
      // users who scanned the card grid. Pin the emoji to the dish's
      // dominant protein/category instead.
      `For "emoji", pick ONE Unicode food emoji that matches the dish's main protein or category — ` +
      `🍗 chicken, 🥩 beef, 🐟 fish, 🦐 shrimp, 🥚 egg, 🥗 salad, 🍝 pasta, 🍕 pizza, 🌮 taco, ` +
      `🍲 stew/soup, 🥘 paella/braise, 🍛 curry, 🍳 fried egg/breakfast, 🥪 sandwich. ` +
      `Never use 🧅 onion or 🥬 lettuce unless that ingredient is the actual star of the dish. ` +
      `Respond ONLY with JSON array (no markdown): ` +
      `[{"name":"","time":"","difficulty":"","emoji":"","description":"","ingredients":[{"item":"","amount":""}],"instructions":[""],"tip":""}]`;
    const { text } = await callClaude({
      max_tokens: 2000,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    });
    const recipes = extractJson<unknown[]>(text);
    if (!Array.isArray(recipes)) return json({ error: "bad model output" }, 502);
    return json({
      recipes,
      usage: { count: rl.count, limit: rl.limit },
      applied: {
        servings: overrideServings ?? prefs.householdSize,
        dietary: prefs.dietary,
        allergens: prefs.allergens,
      },
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
