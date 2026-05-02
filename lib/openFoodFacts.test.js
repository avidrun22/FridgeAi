// ─── lib/openFoodFacts.test.js ────────────────────────────────────────────────
//
// Manual test runner for the OFF prototype. Not a unit test framework —
// just a "run this from your Mac, see the real responses" sanity check.
//
// Usage:
//   node lib/openFoodFacts.test.js
//
// Tests against a handful of well-known barcodes spanning categories so we
// can verify the normalize function maps fields cleanly.

const { lookupByBarcode, searchByText, inferCategory } = require("./openFoodFacts");

// 2026-05-02 update — earlier "expected" labels were based on what I assumed
// the barcode mapped to. OFF's data sometimes maps barcodes to different
// products than I expected (e.g. Coca-Cola UPC actually returned Sprite —
// that's the data, not a code bug). Updated labels to match what OFF
// actually returns, so "✓" markers reflect the function behavior, not a
// mismatch in my external knowledge.
const TEST_BARCODES = [
  // [barcode, expected_category, what_it_is]
  ["3017620422003", "Dry Goods", "Nutella spread (was Other before category fix)"],
  ["0049000028928", "Beverages",  "Sprite Soda (per OFF data)"],
  ["0028400064057", "Dry Goods", "Tostitos chips (per OFF data)"],
  ["3274080005003", "Beverages",  "Evian water 1L"],
  ["8076809513968", "Dry Goods", "Barilla pasta"],
  ["9999999999999", null,        "OFF's test entry (no real product)"],
];

const TEST_SEARCHES = [
  "cheerios original",
  "trader joes almond butter",
  "oat milk",
  "greek yogurt",
  "oreo cookies",
];

function fmt(obj, depth = 0) {
  if (obj === null) return "null";
  if (typeof obj === "string") return JSON.stringify(obj);
  if (typeof obj !== "object") return String(obj);
  const pad = "  ".repeat(depth + 1);
  const lines = Object.entries(obj).map(([k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return `${pad}${k}: { ${Object.entries(v).map(([k2, v2]) => `${k2}: ${v2}`).join(", ")} }`;
    }
    return `${pad}${k}: ${Array.isArray(v) ? `[${v.slice(0, 3).join(", ")}${v.length > 3 ? ", …" : ""}]` : v}`;
  });
  return "{\n" + lines.join(",\n") + "\n" + "  ".repeat(depth) + "}";
}

async function runBarcodeTests() {
  console.log("\n═══ BARCODE LOOKUPS ═══\n");
  for (const [barcode, expected, label] of TEST_BARCODES) {
    process.stdout.write(`[${barcode}] ${label} … `);
    const result = await lookupByBarcode(barcode);
    if (!result) {
      console.log(expected === null ? "✓ null (as expected)" : "✗ null (BUT EXPECTED A HIT)");
      continue;
    }
    const ok = expected ? result.category === expected : false;
    console.log(`${ok ? "✓" : "?"} category=${result.category}, name="${result.name}"`);
    console.log("  brand:", result.brand);
    console.log("  emoji:", result.emoji);
    console.log("  imageUrl:", result.imageUrl ? result.imageUrl.slice(0, 80) + "…" : null);
    console.log("  nutriments:", fmt(result.nutriments, 1));
    console.log("  nutriScore:", result.nutriScore, "  ecoScore:", result.ecoScore);
    console.log("  allergens:", result.allergens.slice(0, 5));
    console.log("");
  }
}

async function runSearchTests() {
  console.log("\n═══ TEXT SEARCHES ═══\n");
  for (const q of TEST_SEARCHES) {
    process.stdout.write(`"${q}" … `);
    const results = await searchByText(q, { pageSize: 5 });
    console.log(`${results.length} hits`);
    results.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.name} ${r.brand ? `(${r.brand})` : ""} — ${r.category}`);
    });
    console.log("");
  }
}

(async () => {
  await runBarcodeTests();
  await runSearchTests();
  console.log("Done. Inspect the output for any \"?\" or \"✗\" markers above.\n");
})();
