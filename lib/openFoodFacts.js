// ─── lib/openFoodFacts.js ─────────────────────────────────────────────────────
//
// PROTOTYPE — not yet wired into App.js. Sits here so we can iterate on the
// shape without disturbing the existing scan flow. When ready, import from
// the receipt/barcode handlers and call as a fallback (or primary) lookup.
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
const CATEGORY_MAP = [
  // Pattern array — first regex hit wins. Order from specific → general.
  { pattern: /:dairie?s|:milks|:yogurts|:cheeses|:butters/i, category: "Dairy" },
  { pattern: /:meats|:poultry|:fish|:seafoods|:eggs|:tofu|:legumes/i, category: "Protein" },
  { pattern: /:vegetables|:fruits|:fresh|:salads|:produce/i, category: "Produce" },
  { pattern: /:beverages|:waters|:juices|:sodas|:teas|:coffees|:wines|:beers/i, category: "Beverages" },
  // Dry Goods catches a lot — keep it after the more specific fresh/protein entries.
  { pattern: /:cereals|:rices|:pastas|:breads|:bakery|:snacks|:condiments|:spices|:oils|:sugars|:sauces/i, category: "Dry Goods" },
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

  return {
    name,
    brand: (p.brands || "").split(",")[0].trim() || null,
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
        "User-Agent": "ok2eat/1.13 (greg@ok2eat.com)",
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
    // The legacy /cgi/search.pl endpoint with json=1 is still the fastest
    // text search. v2 has a /search endpoint too but field selection is
    // less ergonomic. Keeping the simpler one for now.
    const params = new URLSearchParams({
      search_terms: trimmed,
      search_simple: "1",
      action: "process",
      json: "1",
      page_size: String(pageSize),
    });
    const url = `${OFF_BASE}/cgi/search.pl?${params}`;
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ok2eat/1.13 (greg@ok2eat.com)",
        Accept: "application/json",
      },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const products = data.products || [];
    // Wrap each product in the same status=1 envelope normalize expects.
    return products
      .map(p => normalizeOffProduct({ status: 1, code: p.code, product: p }))
      .filter(Boolean);
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
