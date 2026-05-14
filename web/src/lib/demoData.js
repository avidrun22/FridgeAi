// Demo content for the no-auth /demo route — v1.20.
//
// Why this exists: the auth wall on app.ok2eat.com kills 60-70% of cold
// traffic before they ever see the product. The demo route gives anyone a
// 60-second tour — populated fridge, real Eat Me First ranking, pre-cached
// recipes — with a signup prompt only when they try a save/add action.
//
// Doubles as the v1.19 marketing launch asset. Links from Reddit replies,
// X threads, the homepage "Open the web app" button, and Product Hunt all
// land here.
//
// The 5 demo items are tuned to tell the headline story in one screen:
// herbs spoil fastest (cilantro tomorrow), then protein (salmon 2d),
// then leafy greens (spinach 3d), then dairy (milk 4d), then more protein
// (ground beef 5d). The urgency badges paint red→orange→yellow→green
// down the list so the value of the ranking is immediately legible.
//
// Dates are computed at module load relative to "today" so the demo never
// stales out — refresh in 3 months and "expires tomorrow" still means
// tomorrow. Returns plain JS objects in the same shape as rowToItem()
// produces from Supabase, so Demo.jsx can reuse EatMeFirst's render code
// with zero shape translation.

function isoDaysFromNow(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Stable IDs so React keys + recipe lookups behave like real rows would.
export const DEMO_ITEMS = [
  {
    id: "demo-cilantro",
    name: "Cilantro",
    category: "Produce",
    emoji: "🌿",
    quantity: 1,
    unit: "bunch",
    addedDate: isoDaysFromNow(-2),
    expiryDate: isoDaysFromNow(1),
    container: "fridge",
    section: "fridge",
    isOpened: false,
  },
  {
    id: "demo-salmon",
    name: "Salmon fillet",
    category: "Protein",
    emoji: "🐟",
    quantity: 1,
    unit: "lb",
    addedDate: isoDaysFromNow(-1),
    expiryDate: isoDaysFromNow(2),
    container: "fridge",
    section: "fridge",
    isOpened: false,
  },
  {
    id: "demo-spinach",
    name: "Baby spinach",
    category: "Produce",
    emoji: "🥬",
    quantity: 5,
    unit: "oz",
    addedDate: isoDaysFromNow(-2),
    expiryDate: isoDaysFromNow(3),
    container: "fridge",
    section: "fridge",
    isOpened: false,
  },
  {
    id: "demo-milk",
    name: "Whole milk",
    category: "Dairy",
    emoji: "🥛",
    quantity: 1,
    unit: "gallon",
    addedDate: isoDaysFromNow(-4),
    expiryDate: isoDaysFromNow(4),
    container: "fridge",
    section: "fridge",
    isOpened: true,
    openedAt: isoDaysFromNow(-3),
  },
  {
    id: "demo-beef",
    name: "Ground beef",
    category: "Protein",
    emoji: "🥩",
    quantity: 1,
    unit: "lb",
    addedDate: isoDaysFromNow(-1),
    expiryDate: isoDaysFromNow(5),
    container: "fridge",
    section: "fridge",
    isOpened: false,
  },
];

// Pre-written recipes — matches the DailyRecipe shape from
// supabase/functions/_shared/daily_recipes.ts so the recipe sheet renders
// these identically to live recipes. No Anthropic call needed — fast load,
// predictable demo, zero API spend.
//
// Each recipe lists `uses_items` as a subset of the DEMO_ITEMS ids so the
// "we'll use the most urgent items together" promise actually shows up in
// the UI. The first recipe uses cilantro (most urgent) + 2 more, mirroring
// what the live Eat Me First would surface.
export const DEMO_RECIPES_TOP5 = [
  {
    id: "demo-recipe-1",
    name: "Cilantro-lime salmon over spinach",
    time: "20 min",
    difficulty: "Easy",
    emoji: "🐟",
    description:
      "Pan-seared salmon with a quick cilantro-lime drizzle on a bed of wilted baby spinach. Uses three items from the top of your list.",
    ingredients: [
      { item: "Salmon fillet", amount: "1 lb" },
      { item: "Cilantro", amount: "1/2 bunch, chopped" },
      { item: "Baby spinach", amount: "3 oz" },
      { item: "Lime", amount: "1, juiced" },
      { item: "Olive oil", amount: "2 tbsp" },
      { item: "Salt + pepper", amount: "to taste" },
    ],
    instructions: [
      "Pat salmon dry, season both sides with salt and pepper.",
      "Heat 1 tbsp olive oil in a skillet over medium-high. Sear salmon skin-side down 4 min, flip, cook 3 more min.",
      "Remove salmon, lower heat. Add spinach with a splash of water, wilt 1 min.",
      "Whisk remaining olive oil with lime juice and chopped cilantro.",
      "Plate spinach, top with salmon, spoon cilantro-lime drizzle over.",
    ],
    tip: "Save the salmon skin — crisp it separately for a snack while everything cooks.",
    uses_items: ["demo-salmon", "demo-cilantro", "demo-spinach"],
  },
  {
    id: "demo-recipe-2",
    name: "Beef + spinach quesadillas",
    time: "15 min",
    difficulty: "Easy",
    emoji: "🌮",
    description:
      "Browned beef and wilted spinach folded into crisped tortillas. Knocks out two of the items in your fridge in one pan.",
    ingredients: [
      { item: "Ground beef", amount: "1/2 lb" },
      { item: "Baby spinach", amount: "2 oz, chopped" },
      { item: "Flour tortillas", amount: "4" },
      { item: "Shredded cheese", amount: "1 cup" },
      { item: "Cumin", amount: "1 tsp" },
      { item: "Salt", amount: "to taste" },
    ],
    instructions: [
      "Brown ground beef in a skillet over medium-high heat, breaking it up, 5 min.",
      "Stir in cumin and salt. Add chopped spinach, wilt 1 min, remove from heat.",
      "Wipe skillet, return to medium. Place a tortilla down, top with cheese, beef mixture, more cheese, second tortilla.",
      "Cook 2 min per side until golden. Repeat with remaining tortillas.",
      "Slice into wedges and serve.",
    ],
    tip: "Add a squeeze of lime or a dollop of sour cream right before serving.",
    uses_items: ["demo-beef", "demo-spinach"],
  },
  {
    id: "demo-recipe-3",
    name: "Creamy spinach + herb skillet",
    time: "10 min",
    difficulty: "Easy",
    emoji: "🍳",
    description:
      "Wilted greens in a quick cream sauce — a side or a base for whatever protein you cook next. Uses milk, spinach, and cilantro.",
    ingredients: [
      { item: "Baby spinach", amount: "5 oz" },
      { item: "Whole milk", amount: "1/2 cup" },
      { item: "Cilantro", amount: "2 tbsp, chopped" },
      { item: "Garlic", amount: "2 cloves, minced" },
      { item: "Butter", amount: "1 tbsp" },
      { item: "Parmesan", amount: "2 tbsp, grated" },
    ],
    instructions: [
      "Melt butter in a skillet over medium heat. Add garlic, cook 30 seconds.",
      "Add spinach, stir until wilted, about 1 min.",
      "Pour in milk, simmer 2 min until slightly thickened.",
      "Stir in parmesan and cilantro. Season with salt and pepper.",
      "Serve immediately, alongside protein or over toast.",
    ],
    tip: "A pinch of nutmeg makes this taste twice as expensive.",
    uses_items: ["demo-spinach", "demo-milk", "demo-cilantro"],
  },
];

// Per-item recipes — keyed by the lead item's id. Each value is a list of
// 2-3 recipes that anchor on that item. Mirrors what generate-recipes
// would return when called with a single lead item.
export const DEMO_RECIPES_BY_LEAD = {
  "demo-cilantro": [DEMO_RECIPES_TOP5[0], DEMO_RECIPES_TOP5[2]],
  "demo-salmon": [
    DEMO_RECIPES_TOP5[0],
    {
      id: "demo-recipe-salmon-2",
      name: "Salmon rice bowls",
      time: "25 min",
      difficulty: "Easy",
      emoji: "🍚",
      description:
        "Flaked salmon over rice with quick-pickled cucumber and a sesame drizzle.",
      ingredients: [
        { item: "Salmon fillet", amount: "1 lb" },
        { item: "Rice", amount: "1 cup, cooked" },
        { item: "Cucumber", amount: "1, sliced" },
        { item: "Rice vinegar", amount: "2 tbsp" },
        { item: "Sesame oil", amount: "1 tbsp" },
        { item: "Soy sauce", amount: "1 tbsp" },
      ],
      instructions: [
        "Toss cucumber with rice vinegar and a pinch of salt, set aside.",
        "Season salmon with salt, sear in a hot skillet 4 min per side.",
        "Flake salmon into bite-size pieces.",
        "Divide rice into bowls, top with salmon and pickled cucumber.",
        "Drizzle with sesame oil and soy sauce.",
      ],
      tip: "Toasted sesame seeds on top take this from weeknight to date night.",
      uses_items: ["demo-salmon"],
    },
  ],
  "demo-spinach": [DEMO_RECIPES_TOP5[1], DEMO_RECIPES_TOP5[2]],
  "demo-milk": [DEMO_RECIPES_TOP5[2]],
  "demo-beef": [
    DEMO_RECIPES_TOP5[1],
    {
      id: "demo-recipe-beef-2",
      name: "Skillet beef + rice",
      time: "20 min",
      difficulty: "Easy",
      emoji: "🥘",
      description:
        "One-pan ground beef with rice, finished with fresh herbs. Stretches a pound of beef into 3 servings.",
      ingredients: [
        { item: "Ground beef", amount: "1 lb" },
        { item: "Rice", amount: "1 cup, uncooked" },
        { item: "Beef broth", amount: "2 cups" },
        { item: "Onion", amount: "1, diced" },
        { item: "Cilantro", amount: "2 tbsp, chopped" },
        { item: "Salt + pepper", amount: "to taste" },
      ],
      instructions: [
        "Brown beef with onion in a deep skillet, 6 min.",
        "Add rice, stir 1 min to toast.",
        "Pour in broth, bring to a simmer, cover, reduce heat.",
        "Cook 18 min until rice is tender.",
        "Fluff, season, top with chopped cilantro.",
      ],
      tip: "A squeeze of lime at the end wakes the whole thing up.",
      uses_items: ["demo-beef", "demo-cilantro"],
    },
  ],
};
