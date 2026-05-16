// ─── lib/openFoodFacts.js ─────────────────────────────────────────────────────
//
// SHIPPED in v1.14 — App.js's `lookupBarcode` and `searchProducts` route
// through here via an adapter (`adaptOFFProduct`) that bridges this lib's
// richer shape back to the original consumer shape. Old fields preserved,
// new fields (image_url, brand, allergens, isOrganic, ecoScore) appended
// for opt-in use by future UI polish.
//
// Open Food Facts is a free, open, crowdsourced product database with ~3M+
// items. No API key required. Apache-2.0 licensed. ~80%+ coverage on US
// grocery items, with very strong coverage on packaged/branded goods.
//
// API docs: https://openfoodfacts.github.io/openfoodfacts-server/api/
// Endpoint: https://world.openfoodfacts.org/api/v2/product/{barcode}.json
//
// Response shape (key fields only):
//   {
//     status: 0 | 1,                      // 1 = product found
//     status_verbose: string,
//     code: string,                       // the barcode echoed back
//     product: {
//       product_name: string,             // primary display name
//       generic_name: string,             // fallback if product_name empty
//       brands: string,                   // comma-separated brands
//       categories_tags: string[],        // e.g. ["en:dairy", "en:milks"]
//       image_url: string,                // full-res image
//       image_small_url: string,          // 200×200 thumb
//       nutriments: {
//         "energy-kcal_100g": number,
//         "fat_100g": number,
//         "carbohydrates_100g": number,
//         "proteins_100g": number,
//         "sugars_100g": number,
//         "salt_100g": number,
//         ... and many more
//       },
//       nutriscore_grade: "a" | "b" | "c" | "d" | "e",   // EU nutrition grade
//       allergens_tags: string[],         // e.g. ["en:milk", "en:gluten"]
//       ingredients_text: string,
//       quantity: string,                 // e.g. "1 L", "200 g"
//       serving_size: string,             // e.g. "30 g (1 cup)"
//       countries_tags: string[],
//       labels_tags: string[],            // e.g. ["en:organic", "en:fair-trade"]
//       ecoscore_grade: "a" | "b" | "c" | "d" | "e",
//     }
//   }

const OFF_BASE = "https://world.openfoodfacts.org";

// Map OFF's English category tags to ok2eat's internal Category enum. Order
// matters — first match wins. Tags use slugs like "en:dairies", "en:meats".
//
// The patterns are intentionally permissive — OFF's tag taxonomy is huge
// (~30K tags) and inconsistent. We test against a sample of common products
// and add patterns as we discover gaps. Empirical adds from 2026-05-02 test
// run: spreads, breakfasts, chocolate (Nutella was categorized as Other).
const CATEGORY_MAP = [
  // Pattern array — first regex hit wins. Order from specific → general.
  { pattern: /:dairie?s|:milks|:yogurts|:cheeses|:butters|:creams\b/i, category: "Dairy" },
  { pattern: /:meats|:poultry|:fish|:seafoods|:eggs|:tofu|:legumes|:sausages|:hams|:bacons/i, category: "Protein" },
  { pattern: /:vegetables|:fruits|:fresh|:salads|:produce|:plant-based-foods\b/i, category: "Produce" },
  { pattern: /:beverages|:waters|:juices|:sodas|:teas|:coffees|:wines|:beers|:smoothies|:plant-based-beverages/i, category: "Beverages" },
  // Dry Goods catches a wide net — pantry, packaged snacks, sweet stuff, all
  // baking ingredients. Keep AFTER fresh/protein/dairy so the more specific
  // category wins for dual-tagged items (e.g. dairy desserts).
  { pattern: /:cereals|:rices|:pastas|:breads|:bakery|:snacks|:chips|:crackers|:condiments|:spices|:oils|:sugars|:sauces|:spreads|:breakfasts|:chocolates?|:cocoa|:candies|:confectioneries|:desserts|:cookies|:biscuits|:flours|:nuts|:seeds|:dried/i, category: "Dry Goods" },
];

// Map ok2eat Category → category_emoji used by the UI. Mirror of the map in
// AddModal so quick-add chips and OFF lookups produce the same emoji.
const EMOJI_MAP = {
  Dairy: "🥛",
  Protein: "🍗",
  Produce: "🥬",
  "Dry Goods": "🥣",
  Beverages: "🍶",
  Other: "📦",
};

/**
 * Pick a category for an OFF product by matching its category tags against
 * known patterns. Returns "Other" as a safe default when nothing matches.
 */
function inferCategory(categoriesTags = []) {
  for (const tag of categoriesTags) {
    for (const { pattern, category } of CATEGORY_MAP) {
      if (pattern.test(tag)) return category;
    }
  }
  return "Other";
}

/**
 * Normalize OFF's response into ok2eat's internal item shape. Returns null
 * if the API returned status=0 (product not found). Caller is responsible
 * for handling the null case (typically: fall back to user input or a
 * different data source).
 *
 * @param {object} offResponse - Raw JSON from the OFF API
 * @returns {{
 *   name: string,
 *   brand: string|null,
 *   category: "Dairy"|"Protein"|"Produce"|"Dry Goods"|"Beverages"|"Other",
 *   emoji: string,
 *   imageUrl: string|null,
 *   nutriments: {
 *     calories_per_100g: number|null,
 *     fat_g: number|null,
 *     carbs_g: number|null,
 *     protein_g: number|null,
 *     sugar_g: number|null,
 *     salt_g: number|null,
 *   },
 *   nutriScore: string|null,
 *   ecoScore: string|null,
 *   allergens: string[],
 *   ingredients: string|null,
 *   quantity: string|null,
 *   servingSize: string|null,
 *   isOrganic: boolean,
 *   barcode: string,
 *   source: "openfoodfacts",
 * } | null}
 */
function normalizeOffProduct(offResponse) {
  if (!offResponse || offResponse.status !== 1 || !offResponse.product) return null;

  const p = offResponse.product;
  const name = (p.product_name || p.generic_name || "").trim();
  if (!name) return null; // OFF sometimes returns rows with empty names — skip

  const category = inferCategory(p.categories_tags || []);
  const labels = p.labels_tags || [];

  // Strip "en:" prefixes from allergens to get clean human strings
  const allergens = (p.allergens_tags || [])
    .map(t => (t || "").replace(/^[a-z]{2}:/, ""))
    .filter(Boolean);

  const n = p.nutriments || {};

  // Brand fallback: OFF's `brands` field is sometimes empty even when the
  // product is clearly branded (e.g. Tostitos chips returned brand=null in
  // the 2026-05-02 test). Fall back to the first ALL-CAPS or capitalized
  // word in the product name as a heuristic. Not perfect but better than
  // null for downstream UI.
  let brand = (p.brands || "").split(",")[0].trim();
  if (!brand && p.brand_owner) brand = String(p.brand_owner).trim();
  if (!brand) {
    // Heuristic: first word of product_name if it's capitalized and >2 chars
    const firstWord = (p.product_name || "").split(/\s+/)[0] || "";
    if (firstWord.length > 2 && /^[A-Z]/.test(firstWord)) brand = firstWord;
  }

  return {
    name,
    brand: brand || null,
    category,
    emoji: EMOJI_MAP[category],
    imageUrl: p.image_small_url || p.image_url || null,
    nutriments: {
      calories_per_100g: n["energy-kcal_100g"] ?? null,
      fat_g: n["fat_100g"] ?? null,
      carbs_g: n["carbohydrates_100g"] ?? null,
      protein_g: n["proteins_100g"] ?? null,
      sugar_g: n["sugars_100g"] ?? null,
      salt_g: n["salt_100g"] ?? null,
    },
    nutriScore: p.nutriscore_grade || null,
    ecoScore: p.ecoscore_grade || null,
    allergens,
    ingredients: (p.ingredients_text || "").trim() || null,
    quantity: (p.quantity || "").trim() || null,
    servingSize: (p.serving_size || "").trim() || null,
    isOrganic: labels.some(l => /organic/i.test(l)),
    barcode: offResponse.code,
    source: "openfoodfacts",
  };
}

/**
 * Look up a product on Open Food Facts by barcode (UPC, EAN-13, etc.).
 * Returns a normalized product object, or null if not found / on error.
 *
 * Network errors are swallowed and surfaced as null — callers should treat
 * "not found" and "lookup failed" identically (fall back to next strategy).
 *
 * The OFF API is free and unauthenticated, but we set a User-Agent per
 * their etiquette guidelines (https://openfoodfacts.github.io/openfoodfacts-server/api/#user-agent).
 *
 * @param {string} barcode - Numeric barcode string (no spaces / dashes)
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<ReturnType<typeof normalizeOffProduct> | null>}
 */
async function lookupByBarcode(barcode, { timeoutMs = 4000 } = {}) {
  const cleaned = (barcode || "").replace(/[^0-9]/g, "");
  if (!cleaned) return null;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${OFF_BASE}/api/v2/product/${cleaned}.json`;
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        // OFF asks API consumers to identify themselves so they can spot
        // misbehaving clients. Include app + contact + version.
        "User-Agent": "ok2eat/1.14 (greg@ok2eat.com)",
        Accept: "application/json",
      },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return normalizeOffProduct(data);
  } catch (e) {
    // Network errors, timeouts, JSON parse errors — all return null.
    // Caller handles via fallback strategy.
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Text search across OFF's catalog. Useful for the "natural language search"
 * UX Greg called out — user types "cheerios original" and we surface matches
 * with images. Returns up to `pageSize` normalized products.
 *
 * Caveat: the search endpoint is more expensive than barcode lookup and
 * can be slow during peak times. Don't fire on every keystroke; debounce
 * to ~500ms or require a button tap.
 *
 * IMPLEMENTATION HISTORY:
 *  - First version used the legacy /cgi/search.pl with search_simple=1.
 *    It worked for some queries ("cheerios original") but missed others
 *    ("oat milk", "trader joes almond butter").
 *  - 2026-05-02 we tried the v2 /api/v2/search endpoint, which turned
 *    out NOT to honor `search_terms` — it returned the first N rows
 *    in the DB regardless of query (Moroccan products, since OFF's
 *    crawlers have heavy North Africa coverage). Worse than legacy.
 *  - Reverted to the legacy /cgi/search.pl endpoint, kept search_simple=1,
 *    and added a *relevance guard* on results: if the returned products'
 *    names don't contain at least one of the search tokens, treat the
 *    search as a miss and return []. This prevents the false-positive
 *    "5 random results" pattern from leaking back to callers.
 *
 * Honest take on text search: OFF's text search is brittle. Free-text
 * matching against ~3M products in a community-edited DB will always be
 * lossy. Use it for autocomplete-style "got an answer or didn't" UX, not
 * as a primary product-discovery surface. For v1.15 integration plan:
 * barcode lookup is the load-bearing feature; text search is a nice-to-have
 * fallback on the AddModal.
 *
 * @param {string} query
 * @param {{pageSize?: number, timeoutMs?: number}} [options]
 * @returns {Promise<Array<ReturnType<typeof normalizeOffProduct>>>}
 */
async function searchByText(query, { pageSize = 10, timeoutMs = 6000 } = {}) {
  const trimmed = (query || "").trim();
  if (!trimmed) return [];

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const params = new URLSearchParams({
      search_terms: trimmed,
      search_simple: "1",
      action: "process",
      json: "1",
      page_size: String(pageSize),
      // Sort by unique_scans_n so the most-frequently-scanned products
      // come first — gives us a popularity-weighted result instead of
      // arbitrary order.
      sort_by: "unique_scans_n",
    });
    const url = `${OFF_BASE}/cgi/search.pl?${params}`;
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ok2eat/1.14 (greg@ok2eat.com)",
        Accept: "application/json",
      },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const products = data.products || [];

    // v1.21 — Relevance scoring (replaces the lenient .some()-based guard
    // that let "whole milk" return whole-milk mozzarella + whole-milk
    // yogurt above actual milk). Real signal hierarchy:
    //   1. Exact phrase in name        +100  ("whole milk" appears as a
    //                                         contiguous substring in name)
    //   2. All tokens in name          +50   (every search token present
    //                                         in name, may be non-contiguous)
    //   3. Token in name               +10   (per token, additive)
    //   4. Token only in brand          +2   (per token, additive, weak signal)
    //   5. Score < 10                   → drop the result entirely (was a
    //                                      single-token brand match — noise)
    // Top-scoring results win the sort. Within equal scores, OFF's
    // unique_scans_n ordering is preserved (popularity tiebreaker).
    const tokens = trimmed
      .toLowerCase()
      .split(/\s+/)
      .map(t => t.replace(/[^a-z0-9]/g, ""))
      .filter(t => t.length > 1);

    const phrase = trimmed.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

    const normalized = products
      .map(p => normalizeOffProduct({ status: 1, code: p.code, product: p }))
      .filter(Boolean);

    if (tokens.length === 0) return normalized;

    const scored = normalized.map((p, idx) => {
      const name = (p.name || "").toLowerCase();
      const brand = (p.brand || "").toLowerCase();
      let score = 0;
      // Exact-phrase bonus: query as a contiguous substring of the name.
      // Worth more than all-tokens because "whole milk" in "whole milk
      // mozzarella" matches all-tokens but NOT phrase (substring is
      // disrupted by "mozzarella" position).
      if (phrase && name.includes(phrase)) score += 100;
      // Per-token signal — count once per token, name >> brand.
      let nameTokensHit = 0;
      for (const tok of tokens) {
        if (name.includes(tok)) { score += 10; nameTokensHit += 1; }
        else if (brand.includes(tok)) { score += 2; }
      }
      // All-tokens-in-name bonus: rewards a name like "Whole Milk" over
      // a name that only has one of the two tokens.
      if (nameTokensHit === tokens.length) score += 50;
      return { p, score, originalIdx: idx };
    });

    return scored
      .filter(s => s.score >= 10)
      .sort((a, b) => (b.score - a.score) || (a.originalIdx - b.originalIdx))
      .map(s => s.p);
  } catch (e) {
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ESM exports — App.js currently uses CommonJS-style imports for some libs
// (require) but ES imports for most. Both work via Metro. Pick one when
// integrating.
module.exports = {
  lookupByBarcode,
  searchByText,
  normalizeOffProduct,
  inferCategory,
};
