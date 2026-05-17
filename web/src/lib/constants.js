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

// ─── Smart emoji inference (v1.19) ────────────────────────────────────────────
// Mirrors the iOS App.js FOOD_EMOJI_RULES + inferEmoji() — when an item's
// stored emoji is a category default (or missing), match the name against
// these patterns and return a contextual emoji instead. Order matters:
// specific tokens first (ground beef → 🥩 before beef → 🥩).
const FOOD_EMOJI_RULES = [
  [/\b(salmon|trout|tuna|cod|halibut|tilapia|bass|snapper|mackerel|sardine|anchov)/, "🐟"],
  [/\b(shrimp|prawn|lobster|crab|scallop|oyster|mussel|clam|calamari|squid|octopus)/, "🦐"],
  [/\b(ground beef|beef|steak|brisket|sirloin|ribeye|chuck|filet|burger patt)/, "🥩"],
  [/\b(bacon|pancetta|prosciutto|salami|pepperoni|chorizo|jerky)/, "🥓"],
  [/\b(sausage|hot dog|frank|brat|kielbasa|andouille)/, "🌭"],
  [/\b(pork|ham|ribs|tenderloin)/, "🥓"],
  [/\b(lamb|mutton|veal)/, "🥩"],
  [/\b(chicken|turkey|duck|cornish|poultry|drumstick|thigh|breast|wing)/, "🍗"],
  [/\b(egg)/, "🥚"],
  [/\b(tofu|tempeh|seitan|edamame|soybean)/, "🫛"],
  [/\b(bean|lentil|chickpea|garbanzo|pea\b|peas\b|black bean|kidney bean|pinto|cannellini)/, "🫘"],
  [/\b(peanut|almond|walnut|pecan|cashew|pistachio|hazelnut|nut butter|trail mix)/, "🥜"],
  [/\b(milk|half[- ]and[- ]half|cream\b|heavy cream|buttermilk)/, "🥛"],
  [/\b(yogurt|yoghurt|kefir|skyr)/, "🥛"],
  [/\b(butter|ghee|margarine)/, "🧈"],
  [/\b(ice cream|gelato|sorbet|frozen yogurt)/, "🍦"],
  [/\b(cheese|cheddar|mozzarella|parmesan|feta|brie|gouda|provolone|ricotta|cottage|cream cheese|swiss|gruyere|gruy)/, "🧀"],
  [/\b(cilantro|coriander|parsley|basil|mint|dill|chive|rosemary|thyme|sage|oregano|tarragon|herb)/, "🌿"],
  [/\b(spinach|kale|arugula|romaine|lettuce|salad|mesclun|spring mix|baby greens|chard|collard|bok choy|cabbage)/, "🥬"],
  [/\b(apple)/, "🍎"],
  [/\b(banana|plantain)/, "🍌"],
  [/\b(strawberr)/, "🍓"],
  [/\b(blueberr|blackberr|raspberr|cranberr|berry|berries)/, "🫐"],
  [/\b(grape|raisin)/, "🍇"],
  [/\b(orange|tangerine|clementine|mandarin)/, "🍊"],
  [/\b(lemon)/, "🍋"],
  [/\b(lime)/, "🍋"],
  [/\b(pineapple)/, "🍍"],
  [/\b(mango)/, "🥭"],
  [/\b(peach|nectarine|apricot|plum)/, "🍑"],
  [/\b(pear)/, "🍐"],
  [/\b(watermelon|melon|cantaloupe|honeydew)/, "🍉"],
  [/\b(cherry|cherries)/, "🍒"],
  [/\b(kiwi)/, "🥝"],
  [/\b(coconut)/, "🥥"],
  [/\b(avocado|guacamole)/, "🥑"],
  [/\b(tomato|cherry tomat|grape tomat|roma)/, "🍅"],
  [/\b(potato|yam|sweet potato)/, "🥔"],
  [/\b(carrot)/, "🥕"],
  [/\b(corn|maize)/, "🌽"],
  [/\b(pepper|jalapen|jalapeño|serrano|habanero|chili|chile|chilli|cayenne|paprika)/, "🌶️"],
  [/\b(bell pepper|capsicum)/, "🫑"],
  [/\b(cucumber|pickle|gherkin|zucchini|courgette|squash|pumpkin|gourd)/, "🥒"],
  [/\b(broccoli|cauliflower)/, "🥦"],
  [/\b(onion|shallot|leek|scallion|green onion)/, "🧅"],
  [/\b(garlic)/, "🧄"],
  [/\b(mushroom|portobello|shiitake|cremini)/, "🍄"],
  [/\b(eggplant|aubergine)/, "🍆"],
  [/\b(ginger|turmeric)/, "🫚"],
  [/\b(bread|loaf|baguette|toast|bun|roll|bagel|english muffin|pita|naan|tortilla|wrap)/, "🍞"],
  [/\b(croissant|pastry|danish|scone|biscuit\b)/, "🥐"],
  [/\b(pasta|spaghetti|linguine|fettuccine|penne|rigatoni|macaroni|noodle|ramen|udon|soba|orzo|fusilli|farfalle|tortellini|ravioli|lasagna|gnocchi)/, "🍝"],
  [/\b(rice|jasmine|basmati|arborio|quinoa|couscous|farro|barley|bulgur|oat|granola|cereal|muesli|porridge|oatmeal)/, "🍚"],
  [/\b(flour|sugar|baking)/, "🥣"],
  [/\b(cracker|chip|pretzel|popcorn|snack)/, "🥨"],
  [/\b(cookie|brownie|cake|pie|donut|doughnut|muffin)/, "🍪"],
  [/\b(chocolate|candy|honey|jam|jelly|syrup|maple)/, "🍯"],
  [/\b(oil|olive oil|vinegar|sauce|ketchup|mustard|mayo|mayonnaise|dressing|salsa|hummus|tahini|pesto|hot sauce|soy sauce|sriracha|tamari|fish sauce|oyster sauce|hoisin|gochujang|miso|curry paste)/, "🫙"],
  [/\b(salt|pepper\b|spice|seasoning|broth|stock|bouillon)/, "🧂"],
  [/\b(water|sparkling|seltzer|la croix|topo chico)/, "💧"],
  [/\b(coffee|espresso|latte|cappuccino|cold brew)/, "☕"],
  [/\b(tea|matcha|chai|kombucha)/, "🍵"],
  [/\b(juice|lemonade|smoothie|cider|nectar)/, "🧃"],
  [/\b(soda|cola|pepsi|coke|sprite|fanta|root beer|ginger ale|tonic|gatorade|powerade)/, "🥤"],
  [/\b(beer|ale|lager|ipa|stout|pilsner)/, "🍺"],
  [/\b(wine|champagne|prosecco|rose\b|rosé)/, "🍷"],
  [/\b(liquor|whiskey|whisky|bourbon|vodka|gin|rum|tequila|sake)/, "🥃"],
  [/\b(pizza)/, "🍕"],
  [/\b(sushi|sashimi|maki|nigiri)/, "🍣"],
  [/\b(taco|burrito|quesadilla|enchilada)/, "🌮"],
  [/\b(soup|stew|chili|chowder)/, "🍲"],
  [/\b(salad)/, "🥗"],
];

const DEFAULT_EMOJIS = ["🥛", "🍗", "🥬", "🥣", "🍶", "📦", "🧀"];

export function inferEmoji(name, fallback) {
  if (!name || typeof name !== "string") return fallback || "📦";
  const n = name.toLowerCase().trim();
  // Preserve any non-default stored emoji (user-edited or AI-suggested).
  if (fallback && !DEFAULT_EMOJIS.includes(fallback)) return fallback;
  for (const [pattern, emoji] of FOOD_EMOJI_RULES) {
    if (pattern.test(n)) return emoji;
  }
  return fallback || "📦";
}
export const EXPIRY_DAYS_BY_CATEGORY = {
  Dairy: 14, Protein: 3, Produce: 5, "Dry Goods": 180, Beverages: 7, Other: 7,
};

// "Fresh" = same expiry whether opened or sealed (Dairy, Produce). Everything
// else is "packaged" — sealed shelf life is long, but once opened the clock
// starts ticking on a shorter timer. Mirrors the iOS PACKAGED_CATEGORIES.
export const FRESH_CATEGORIES = new Set(["Dairy", "Produce"]);
export const PACKAGED_CATEGORIES = new Set(["Protein", "Beverages", "Dry Goods", "Other"]);
export const isPackagedCategory = (cat) => PACKAGED_CATEGORIES.has(cat);
export const OPENED_DAYS_MAP = { Protein: 3, Beverages: 7, "Dry Goods": 30, Other: 7 };

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
  // v1.22 #238 — sliceable / portionable so pizzas/cakes/breads aren't stuck with "count"
  "slice", "piece", "serving",
  "oz", "lb", "g", "kg",
  "fl oz", "cup", "pt", "qt", "gallon", "ml", "L",
  "pack", "box", "jar", "can", "bottle", "carton", "bag",
  "bunch", "dozen",
];
