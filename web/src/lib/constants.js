// Shared constants — keep parity with the matching arrays in the iOS App.js.
// When you change one, change the other.

export const CONTAINERS = [
  { id: "fridge",  label: "Fridge",  hint: "Dairy, produce, leftovers" },
  { id: "pantry",  label: "Pantry",  hint: "Dry goods, canned" },
  { id: "freezer", label: "Freezer", hint: "Frozen meats, ice cream" },
];
export const CONTAINER_LABEL = { fridge: "Fridge", pantry: "Pantry", freezer: "Freezer" };

export const CATEGORIES = ["Dairy", "Protein", "Produce", "Dry Goods", "Beverages", "Other"];
export const CATEGORY_EMOJI = {
  Dairy: "🥛", Protein: "🍗", Produce: "🥬",
  "Dry Goods": "🥣", Beverages: "🍶", Other: "📦",
};
export const EXPIRY_DAYS_BY_CATEGORY = {
  Dairy: 14, Protein: 3, Produce: 5, "Dry Goods": 180, Beverages: 7, Other: 7,
};

// Same retailer order + URLs as the iOS app. Affiliate tags identical so
// clicks from web also earn (Instacart + Walmart pending Impact approval).
export const RETAILERS = [
  { id: "instacart", label: "Instacart", color: "#43B02A", url: (q) => `https://www.instacart.com/store/search?k=${encodeURIComponent(q)}&utm_source=ok2eat&utm_medium=affiliate` },
  { id: "amazon",    label: "Amazon",    color: "#FF9900", url: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}&tag=ok2eat-20` },
  { id: "walmart",   label: "Walmart",   color: "#0071CE", url: (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}&utm_source=ok2eat&utm_medium=affiliate` },
];

export const UNIT_OPTIONS = [
  "",
  "count",
  "oz", "lb", "g", "kg",
  "fl oz", "cup", "pt", "qt", "gallon", "ml", "L",
  "pack", "box", "jar", "can", "bottle", "carton", "bag",
  "bunch", "dozen",
];
