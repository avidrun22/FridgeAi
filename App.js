import { useState, useEffect, useRef } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, SafeAreaView, StatusBar, Modal, Alert,
  Animated, Platform, ActivityIndicator,
} from "react-native";

// ─── Supabase Config ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://qemarhvgeuzhlwybmbie.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlbWFyaHZnZXV6aGx3eWJtYmllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2Njc2NTgsImV4cCI6MjA5MDI0MzY1OH0.ejYeJkucIwAWZ7Rf0hcmpIENSnnmXMh4V_nhjXlDQk4";

const dbHeaders = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  "Prefer": "return=representation",
};

async function dbGetItems() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/fridge_items?order=created_at.desc`, { headers: dbHeaders });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

async function dbAddItem(item) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/fridge_items`, {
    method: "POST", headers: dbHeaders,
    body: JSON.stringify({
      name: item.name, category: item.category, emoji: item.emoji,
      quantity: item.quantity || 1,
      added_date: item.addedDate || new Date().toISOString(),
      expiry_date: item.expiryDate, barcode: item.barcode || null,
    }),
  });
  if (!res.ok) throw new Error("Failed to add");
  return (await res.json())[0];
}

async function dbDeleteItem(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/fridge_items?id=eq.${id}`, { method: "DELETE", headers: dbHeaders });
  if (!res.ok) throw new Error("Failed to delete");
}

function rowToItem(row) {
  return {
    id: row.id, name: row.name, category: row.category, emoji: row.emoji,
    quantity: row.quantity, addedDate: row.added_date, expiryDate: row.expiry_date, barcode: row.barcode,
  };
}

// ─── Open Food Facts ──────────────────────────────────────────────────────────
const CATEGORY_MAP = {
  "beverages": "Beverages", "dairies": "Dairy", "dairy": "Dairy", "cheeses": "Dairy",
  "milks": "Dairy", "yogurts": "Dairy", "meats": "Protein", "poultry": "Protein",
  "seafood": "Protein", "eggs": "Protein", "fish": "Protein",
  "fruits": "Produce", "vegetables": "Produce", "fresh": "Produce",
  "breads": "Dry Goods", "cereals": "Dry Goods", "snacks": "Dry Goods", "pasta": "Dry Goods",
};
const EMOJI_MAP = { "Dairy": "🧀", "Protein": "🍗", "Produce": "🥬", "Dry Goods": "🥣", "Beverages": "🍶", "Other": "📦" };
const EXPIRY_MAP = { "Dairy": 14, "Protein": 3, "Produce": 5, "Dry Goods": 180, "Beverages": 7, "Other": 7 };

function categorize(tags) {
  if (!tags) return "Other";
  const joined = tags.join(" ").toLowerCase();
  for (const [key, val] of Object.entries(CATEGORY_MAP)) {
    if (joined.includes(key)) return val;
  }
  return "Other";
}

function productFromOFF(p, barcode) {
  const name = p.product_name_en || p.product_name || "";
  const brand = p.brands ? p.brands.split(",")[0].trim() : "";
  const fullName = brand && !name.toLowerCase().includes(brand.toLowerCase())
    ? `${brand} ${name}` : name || "Unknown Product";
  const category = categorize(p.categories_tags);
  return {
    name: fullName.trim(), category, emoji: EMOJI_MAP[category],
    defaultExpiry: EXPIRY_MAP[category], code: barcode || p.code || null,
    nutritionGrade: p.nutrition_grades || null,
  };
}

async function lookupBarcode(barcode) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  return productFromOFF(data.product, barcode);
}

async function searchProducts(query) {
  const encoded = encodeURIComponent(query);
  const res = await fetch(
    `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encoded}&search_simple=1&action=process&json=1&page_size=20&fields=product_name,product_name_en,brands,categories_tags,nutrition_grades,code`
  );
  const data = await res.json();
  if (!data.products) return [];
  return data.products
    .filter(p => p.product_name || p.product_name_en)
    .slice(0, 10)
    .map(p => productFromOFF(p, p.code));
}

// ─── Theme ────────────────────────────────────────────────────────────────────
const T = {
  bg: "#0A0F0A", surface: "#111811", card: "#161E16",
  accent: "#4ADE80", warn: "#FB923C", danger: "#F87171",
  muted: "#4B5E4B", text: "#E8F5E8", textSoft: "#9DB89D", border: "#1E2E1E",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function daysUntil(dateStr) { return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000); }
function expiryColor(days) { return days <= 1 ? T.danger : days <= 3 ? T.warn : T.accent; }
function formatDate(dateStr) { return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function isBarcode(str) { return /^\d{8,14}$/.test(str.trim()); }

// ─── Fridge Screen ────────────────────────────────────────────────────────────
function FridgeScreen({ items, onDelete, onAdd, loading }) {
  const [filter, setFilter] = useState("All");
  const categories = ["All", "Dairy", "Protein", "Produce", "Dry Goods", "Beverages"];
  const filtered = filter === "All" ? items : items.filter(i => i.category === filter);
  const expiringSoon = items.filter(i => daysUntil(i.expiryDate) <= 3).length;

  return (
    <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}>
        <View>
          <Text style={s.pageTitle}>My Fridge</Text>
          <Text style={s.pageSubtitle}>{loading ? "Loading..." : `${items.length} items tracked`}</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={onAdd}>
          <Text style={{ color: T.bg, fontSize: 24, lineHeight: 28 }}>+</Text>
        </TouchableOpacity>
      </View>

      <View style={s.statsRow}>
        {[
          { num: items.length, label: "Total Items", color: T.accent },
          { num: expiringSoon, label: "Expiring Soon", color: expiringSoon > 0 ? T.warn : T.accent },
          { num: [...new Set(items.map(i => i.category))].length, label: "Categories", color: T.accent },
        ].map(st => (
          <View key={st.label} style={s.statBox}>
            <Text style={[s.statNum, { color: st.color }]}>{st.num}</Text>
            <Text style={s.statLabel}>{st.label}</Text>
          </View>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingLeft: 16, marginBottom: 16 }}>
        {categories.map(c => (
          <TouchableOpacity key={c} onPress={() => setFilter(c)} style={[s.chip, filter === c && s.chipActive]}>
            <Text style={[s.chipText, filter === c && s.chipTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {expiringSoon > 0 && (
        <View style={s.warnBanner}>
          <Text style={{ fontSize: 18 }}>⚠️</Text>
          <View style={{ marginLeft: 10 }}>
            <Text style={[s.bold, { color: T.warn }]}>Heads up!</Text>
            <Text style={{ color: T.textSoft, fontSize: 12 }}>{expiringSoon} item{expiringSoon > 1 ? "s" : ""} expiring within 3 days</Text>
          </View>
        </View>
      )}

      {loading ? (
        <View style={{ alignItems: "center", padding: 48 }}>
          <ActivityIndicator color={T.accent} size="large" />
          <Text style={{ color: T.textSoft, marginTop: 12 }}>Loading your fridge...</Text>
        </View>
      ) : (
        <>
          <Text style={s.sectionLabel}>// CONTENTS</Text>
          {filtered.length === 0 && (
            <View style={{ alignItems: "center", padding: 48 }}>
              <Text style={{ fontSize: 48 }}>🧊</Text>
              <Text style={[s.bold, { fontSize: 18, marginTop: 12 }]}>Your fridge is empty!</Text>
              <Text style={{ color: T.textSoft, fontSize: 14, marginTop: 6 }}>Tap + or use the Add tab to add items.</Text>
            </View>
          )}
          {filtered.map(item => {
            const days = daysUntil(item.expiryDate);
            const color = expiryColor(days);
            return (
              <View key={item.id} style={s.fridgeItem}>
                <Text style={{ fontSize: 32, width: 44, textAlign: "center" }}>{item.emoji}</Text>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.itemName} numberOfLines={1}>{item.name}</Text>
                  <Text style={s.itemMeta}>{item.category} · Added {formatDate(item.addedDate)}</Text>
                  {item.barcode && <Text style={[s.monoText, { color: T.muted, fontSize: 10, marginTop: 2 }]}>#{item.barcode}</Text>}
                </View>
                <View style={{ alignItems: "flex-end", gap: 8 }}>
                  <View style={[s.expiryBadge, { backgroundColor: color + "22", borderColor: color + "55" }]}>
                    <Text style={[s.expiryText, { color }]}>
                      {days <= 0 ? "Expired" : days === 1 ? "1 day" : `${days}d`}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => onDelete(item.id)}>
                    <Text style={{ color: T.muted, fontSize: 16 }}>🗑</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </>
      )}
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ─── Scan / Add Screen ────────────────────────────────────────────────────────
function ScanScreen({ onScanned }) {
  const [mode, setMode] = useState("search");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");

  const DEMO_SEARCHES = ["avocado", "greek yogurt", "chicken breast", "almond milk", "sourdough bread"];
  const DEMO_BARCODES = [
    { code: "737628064502", label: "Sriracha Hot Sauce" },
    { code: "049000028911", label: "Coca-Cola" },
    { code: "021000054428", label: "Kraft Mac & Cheese" },
    { code: "016000275553", label: "Lucky Charms" },
  ];

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    setResults([]);
    setSelected(null);
    try {
      if (isBarcode(query)) {
        const product = await lookupBarcode(query.trim());
        if (product) setResults([product]);
        else setError("Barcode not found. Try searching by name instead.");
      } else {
        const products = await searchProducts(query.trim());
        if (products.length > 0) setResults(products);
        else setError(`No results found for "${query}". Try a different search term.`);
      }
    } catch (e) {
      setError("Couldn't connect. Check your internet connection.");
    }
    setSearching(false);
  }

  function handleDemoSearch(term) {
    setQuery(term);
    setMode("search");
    setSearching(true);
    setError("");
    setResults([]);
    setSelected(null);
    searchProducts(term).then(products => {
      if (products.length > 0) setResults(products);
      else setError(`No results for "${term}".`);
      setSearching(false);
    }).catch(() => { setError("Couldn't connect."); setSearching(false); });
  }

  function handleDemoBarcode(code) {
    setQuery(code);
    setMode("barcode");
    setSearching(true);
    setError("");
    setResults([]);
    setSelected(null);
    lookupBarcode(code).then(product => {
      if (product) setResults([product]);
      else setError("Product not found.");
      setSearching(false);
    }).catch(() => { setError("Couldn't connect."); setSearching(false); });
  }

  function addToFridge(product) {
    onScanned(product);
    setSelected(null);
    setResults([]);
    setQuery("");
    setError("");
  }

  function nutriColor(grade) {
    const map = { a: "#4ADE80", b: "#86EFAC", c: "#FCD34D", d: "#FB923C", e: "#F87171" };
    return map[grade?.toLowerCase()] || T.muted;
  }

  return (
    <ScrollView style={s.screen} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={s.headerRow}>
        <View>
          <Text style={s.pageTitle}>Add Item</Text>
          <Text style={s.pageSubtitle}>Search by name or enter a barcode</Text>
        </View>
        <View style={s.aiBadge}><Text style={s.aiBadgeText}>🌍 LIVE DB</Text></View>
      </View>

      <View style={s.modeToggle}>
        <TouchableOpacity style={[s.modeBtn, mode === "search" && s.modeBtnActive]} onPress={() => { setMode("search"); setResults([]); setError(""); setQuery(""); }}>
          <Text style={[s.modeBtnText, mode === "search" && s.modeBtnTextActive]}>🔍  Search by name</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.modeBtn, mode === "barcode" && s.modeBtnActive]} onPress={() => { setMode("barcode"); setResults([]); setError(""); setQuery(""); }}>
          <Text style={[s.modeBtnText, mode === "barcode" && s.modeBtnTextActive]}>📦  Enter barcode</Text>
        </TouchableOpacity>
      </View>

      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <TextInput
          style={[s.input, { fontSize: 16, padding: 15 }]}
          placeholder={mode === "search" ? "e.g. avocado, greek yogurt, oat milk..." : "e.g. 049000028911"}
          placeholderTextColor={T.muted}
          value={query}
          onChangeText={setQuery}
          keyboardType={mode === "barcode" ? "numeric" : "default"}
          returnKeyType="search"
          onSubmitEditing={handleSearch}
          autoCapitalize="none"
        />
        <TouchableOpacity style={s.btnPrimary} onPress={handleSearch} disabled={searching}>
          {searching
            ? <ActivityIndicator color={T.bg} />
            : <Text style={s.btnPrimaryText}>{mode === "search" ? "🔍  Search Food Database" : "📦  Look Up Barcode"}</Text>
          }
        </TouchableOpacity>
      </View>

      {error !== "" && (
        <View style={s.errorBox}>
          <Text style={{ color: T.danger, fontSize: 13 }}>{error}</Text>
        </View>
      )}

      {results.length > 0 && !selected && (
        <>
          <Text style={s.sectionLabel}>// {results.length} RESULT{results.length !== 1 ? "S" : ""} FOUND</Text>
          {results.map((product, i) => (
            <TouchableOpacity key={i} style={s.resultItem} onPress={() => setSelected(product)}>
              <Text style={{ fontSize: 28, width: 40, textAlign: "center" }}>{product.emoji}</Text>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.itemName} numberOfLines={2}>{product.name}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <Text style={{ color: T.textSoft, fontSize: 12 }}>{product.category}</Text>
                  {product.nutritionGrade && (
                    <View style={{ backgroundColor: nutriColor(product.nutritionGrade) + "22", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1, borderColor: nutriColor(product.nutritionGrade) + "55" }}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: nutriColor(product.nutritionGrade) }}>
                        Nutri-{product.nutritionGrade.toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              <Text style={{ color: T.accent, fontSize: 18 }}>›</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {selected && (
        <View style={{ paddingHorizontal: 16 }}>
          <TouchableOpacity onPress={() => setSelected(null)} style={{ marginBottom: 12 }}>
            <Text style={{ color: T.accent, fontSize: 14 }}>← Back to results</Text>
          </TouchableOpacity>
          <View style={[s.card, { padding: 20, marginBottom: 12 }]}>
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <Text style={{ fontSize: 56 }}>{selected.emoji}</Text>
              <Text style={[s.bold, { fontSize: 18, textAlign: "center", marginTop: 10, lineHeight: 24 }]}>{selected.name}</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap", justifyContent: "center" }}>
                <View style={s.pill}><Text style={s.pillText}>{selected.category}</Text></View>
                {selected.nutritionGrade && (
                  <View style={[s.pill, { backgroundColor: nutriColor(selected.nutritionGrade) + "22", borderColor: nutriColor(selected.nutritionGrade) + "55" }]}>
                    <Text style={[s.pillText, { color: nutriColor(selected.nutritionGrade) }]}>
                      Nutri-Score {selected.nutritionGrade.toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
            </View>
            <View style={{ backgroundColor: T.surface, borderRadius: 12, padding: 14 }}>
              <Text style={[s.inputLabel, { marginBottom: 2 }]}>Suggested expiry</Text>
              <Text style={[s.bold, { fontSize: 18, color: T.accent }]}>{selected.defaultExpiry} days from today</Text>
            </View>
          </View>
          <TouchableOpacity style={[s.btnPrimary, { marginBottom: 10 }]} onPress={() => addToFridge(selected)}>
            <Text style={s.btnPrimaryText}>✅  Add to My Fridge</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnSecondary} onPress={() => setSelected(null)}>
            <Text style={s.btnSecondaryText}>Choose a Different Result</Text>
          </TouchableOpacity>
        </View>
      )}

      {results.length === 0 && !searching && error === "" && (
        <>
          <Text style={s.sectionLabel}>// TRY SEARCHING FOR</Text>
          <View style={{ paddingHorizontal: 16, flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {DEMO_SEARCHES.map(term => (
              <TouchableOpacity key={term} onPress={() => handleDemoSearch(term)}
                style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 20 }}>
                <Text style={{ color: T.textSoft, fontSize: 13 }}>🔍 {term}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.sectionLabel}>// OR TRY THESE BARCODES</Text>
          {DEMO_BARCODES.map(item => (
            <TouchableOpacity key={item.code} style={s.fridgeItem} onPress={() => handleDemoBarcode(item.code)}>
              <View style={{ width: 44, alignItems: "center" }}>
                <Text style={{ fontSize: 22 }}>📦</Text>
              </View>
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={s.bold}>{item.label}</Text>
                <Text style={[s.monoText, { color: T.muted, fontSize: 11, marginTop: 2 }]}>{item.code}</Text>
              </View>
              <Text style={{ color: T.accent, fontSize: 12 }}>Tap →</Text>
            </TouchableOpacity>
          ))}
        </>
      )}
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ─── Recipes Screen ───────────────────────────────────────────────────────────
function RecipesScreen({ items }) {
  const [loading, setLoading] = useState(false);
  const [recipes, setRecipes] = useState([]);
  const [selected, setSelected] = useState(null);

  const defaultRecipes = [
    {
      name: "Chicken Florentine", time: "25 min", difficulty: "Easy", emoji: "🍳",
      ingredients: [{ item: "Chicken Breast", amount: "2 fillets" }, { item: "Baby Spinach", amount: "2 cups" }, { item: "Cheddar Cheese", amount: "½ cup shredded" }, { item: "Olive Oil", amount: "2 tbsp" }, { item: "Garlic", amount: "2 cloves" }],
      instructions: ["Season chicken breasts with salt and pepper on both sides.", "Heat olive oil in a skillet over medium-high heat.", "Sear chicken for 5-6 minutes per side until golden and cooked through. Remove and set aside.", "In the same pan, sauté garlic for 30 seconds, then add spinach and wilt for 2 minutes.", "Top chicken with spinach mixture and sprinkle with cheddar cheese.", "Cover pan briefly to melt cheese, then serve immediately."],
      description: "Pan-seared chicken with wilted spinach and melted cheddar.",
      tip: "Deglaze the pan with a splash of white wine after cooking the chicken for extra flavour.",
    },
    {
      name: "Spinach Omelette", time: "10 min", difficulty: "Easy", emoji: "🥚",
      ingredients: [{ item: "Large Eggs", amount: "3 eggs" }, { item: "Baby Spinach", amount: "1 cup" }, { item: "Cheddar Cheese", amount: "¼ cup shredded" }, { item: "Butter", amount: "1 tbsp" }, { item: "Salt & Pepper", amount: "to taste" }],
      instructions: ["Whisk eggs with a pinch of salt and pepper until well combined.", "Melt butter in a non-stick pan over medium-low heat.", "Pour in eggs and let them set slightly around the edges, about 1-2 minutes.", "Add spinach and cheese to one half of the omelette.", "Fold the other half over the filling and slide onto a plate.", "Serve immediately while hot."],
      description: "Fluffy omelette stuffed with fresh spinach and melted cheese.",
      tip: "Low and slow heat makes the fluffiest eggs — don't rush it.",
    },
  ];

  const displayRecipes = recipes.length > 0 ? recipes : defaultRecipes;

  async function getAIRecipes() {
    setLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 2000,
          messages: [{
            role: "user",
            content: `I have these ingredients in my fridge: ${items.map(i => i.name).join(", ")}. 
Suggest 3 creative recipes I can make using primarily these ingredients. 
Respond ONLY with a JSON array (no markdown, no backticks, no explanation):
[{
  "name": "Recipe Name",
  "time": "25 min",
  "difficulty": "Easy",
  "emoji": "🍳",
  "description": "One sentence description",
  "ingredients": [{"item": "Ingredient name", "amount": "quantity and unit"}],
  "instructions": ["Step 1 description", "Step 2 description", "Step 3 description", "Step 4 description"],
  "tip": "One professional cooking tip"
}]`
          }]
        })
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "[]";
      const clean = text.replace(/```json|```/g, "").trim();
      setRecipes(JSON.parse(clean));
    } catch (e) {
      Alert.alert("Couldn't load AI recipes", "Check your connection and try again.");
    }
    setLoading(false);
  }

  if (selected) {
    const itemNames = items.map(i => i.name.toLowerCase());
    return (
      <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={s.backBtn} onPress={() => setSelected(null)}>
          <Text style={{ color: T.accent, fontSize: 15 }}>← Back</Text>
        </TouchableOpacity>
        <View style={{ alignItems: "center", padding: 24 }}>
          <Text style={{ fontSize: 64 }}>{selected.emoji}</Text>
          <Text style={[s.pageTitle, { textAlign: "center", marginTop: 12 }]}>{selected.name}</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <View style={s.pill}><Text style={s.pillText}>⏱ {selected.time}</Text></View>
            <View style={s.pill}><Text style={s.pillText}>{selected.difficulty}</Text></View>
          </View>
        </View>

        <View style={[s.card, { margin: 16, padding: 16, marginBottom: 12 }]}>
          <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 8, paddingHorizontal: 0 }]}>DESCRIPTION</Text>
          <Text style={{ color: T.textSoft, fontSize: 14, lineHeight: 22 }}>{selected.description}</Text>
        </View>

        <View style={[s.card, { margin: 16, padding: 16, marginBottom: 12 }]}>
          <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 8, paddingHorizontal: 0 }]}>INGREDIENTS</Text>
          {selected.ingredients.map((ing, i) => {
            const ingName = typeof ing === "object" ? ing.item : ing;
            const ingAmount = typeof ing === "object" ? ing.amount : null;
            const have = itemNames.some(n => n.includes(ingName.toLowerCase().split(" ")[0]));
            return (
              <View key={i} style={[s.ingredientRow, i < selected.ingredients.length - 1 && { borderBottomWidth: 1, borderBottomColor: T.border }]}>
                <View style={[s.checkBox, { backgroundColor: have ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)", borderColor: have ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)" }]}>
                  <Text style={{ fontSize: 10, color: have ? T.accent : T.danger }}>{have ? "✓" : "✗"}</Text>
                </View>
                <Text style={{ fontSize: 14, color: have ? T.text : T.muted, marginLeft: 10, flex: 1 }}>{ingName}</Text>
                {ingAmount && <Text style={{ fontSize: 12, color: T.accent, fontWeight: "600" }}>{ingAmount}</Text>}
              </View>
            );
          })}
        </View>

        {selected.instructions && selected.instructions.length > 0 && (
          <View style={[s.card, { margin: 16, padding: 16, marginBottom: 12 }]}>
            <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 8, paddingHorizontal: 0 }]}>INSTRUCTIONS</Text>
            {selected.instructions.map((step, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 12, paddingVertical: 10, borderBottomWidth: i < selected.instructions.length - 1 ? 1 : 0, borderBottomColor: T.border }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(74,222,128,0.1)", borderWidth: 1, borderColor: "rgba(74,222,128,0.3)", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                  <Text style={{ fontSize: 11, color: T.accent, fontWeight: "700" }}>{i + 1}</Text>
                </View>
                <Text style={{ fontSize: 14, color: T.textSoft, lineHeight: 21, flex: 1 }}>{step}</Text>
              </View>
            ))}
          </View>
        )}

        {selected.tip && (
          <View style={[s.card, { margin: 16, padding: 16, marginBottom: 12, backgroundColor: "rgba(74,222,128,0.06)", borderColor: "rgba(74,222,128,0.15)" }]}>
            <Text style={[s.monoText, { color: T.accent, marginBottom: 6 }]}>💡 PRO TIP</Text>
            <Text style={{ color: T.textSoft, fontSize: 13, lineHeight: 20 }}>{selected.tip}</Text>
          </View>
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}>
        <View>
          <Text style={s.pageTitle}>Recipes</Text>
          <Text style={s.pageSubtitle}>Based on what's in your fridge</Text>
        </View>
        <View style={s.aiBadge}><Text style={s.aiBadgeText}>✦ AI</Text></View>
      </View>
      <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <TouchableOpacity style={s.btnPrimary} onPress={getAIRecipes} disabled={loading}>
          <Text style={s.btnPrimaryText}>{loading ? "✦  AI is thinking..." : "✦  Generate AI Recipes"}</Text>
        </TouchableOpacity>
      </View>
      <View style={[s.card, { margin: 16, padding: 14, marginBottom: 16 }]}>
        <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 8, paddingHorizontal: 0 }]}>YOUR FRIDGE INGREDIENTS</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {items.map(i => (
            <View key={i.id} style={s.pill}><Text style={s.pillText}>{i.emoji} {i.name.split(" ")[0]}</Text></View>
          ))}
        </View>
      </View>
      <Text style={s.sectionLabel}>// {recipes.length > 0 ? "AI GENERATED" : "SUGGESTED"} RECIPES</Text>
      {displayRecipes.map((recipe, i) => (
        <TouchableOpacity key={i} style={[s.card, { margin: 16, marginBottom: 12, padding: 16 }]} onPress={() => setSelected(recipe)}>
          <View style={{ flexDirection: "row", gap: 14 }}>
            <View style={s.recipeEmojiBox}><Text style={{ fontSize: 28 }}>{recipe.emoji}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={[s.bold, { fontSize: 16 }]}>{recipe.name}</Text>
              <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 4 }}>⏱ {recipe.time}  ·  {recipe.difficulty}</Text>
              <Text style={{ color: T.muted, fontSize: 12, marginTop: 6, lineHeight: 18 }} numberOfLines={2}>{recipe.description}</Text>
            </View>
          </View>
        </TouchableOpacity>
      ))}
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ─── Reminders Screen ─────────────────────────────────────────────────────────
function RemindersScreen({ items }) {
  const [dismissed, setDismissed] = useState([]);

  const autoReminders = items
    .filter(i => daysUntil(i.expiryDate) <= 3 && !dismissed.includes("auto-" + i.id))
    .map(i => ({
      id: "auto-" + i.id, type: "toss", text: `Check ${i.name}`,
      detail: `Expires in ${Math.max(0, daysUntil(i.expiryDate))} day(s)`,
      time: formatDate(i.expiryDate), emoji: i.emoji,
      urgent: daysUntil(i.expiryDate) <= 1,
    }));

  const staticReminders = [
    { id: "r1", type: "order", text: "Reorder Chicken Breast", detail: "Running low", time: "Friday 10:00 AM", emoji: "🛒", urgent: false },
    { id: "r2", type: "toss", text: "Check Whole Milk", detail: "Expires in 3 days", time: "In 3 days", emoji: "🥛", urgent: false },
  ].filter(r => !dismissed.includes(r.id));

  const allReminders = [...autoReminders, ...staticReminders];
  const urgent = allReminders.filter(r => r.urgent);
  const normal = allReminders.filter(r => !r.urgent);

  function ReminderItem({ r }) {
    const bgColor = r.type === "order" ? "rgba(74,222,128,0.1)" : r.urgent ? "rgba(248,113,113,0.1)" : "rgba(251,146,60,0.1)";
    return (
      <View style={s.fridgeItem}>
        <View style={[s.reminderIcon, { backgroundColor: bgColor }]}>
          <Text style={{ fontSize: 20 }}>{r.emoji}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.bold}>{r.text}</Text>
          <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>{r.detail}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4, gap: 8 }}>
            <Text style={[s.monoText, { color: T.muted, fontSize: 10 }]}>🔔 {r.time}</Text>
            {r.urgent && <View style={s.urgentBadge}><Text style={s.urgentText}>URGENT</Text></View>}
          </View>
        </View>
        <TouchableOpacity style={s.dismissBtn} onPress={() => setDismissed(d => [...d, r.id])}>
          <Text style={{ color: T.accent, fontSize: 14 }}>✓</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}>
        <View>
          <Text style={s.pageTitle}>Reminders</Text>
          <Text style={s.pageSubtitle}>{allReminders.length} active reminder{allReminders.length !== 1 ? "s" : ""}</Text>
        </View>
      </View>
      <View style={s.statsRow}>
        {[
          { num: urgent.length, label: "Urgent", color: T.danger },
          { num: allReminders.filter(r => r.type === "order").length, label: "Reorder", color: T.accent },
          { num: allReminders.filter(r => r.type === "toss").length, label: "Toss", color: T.warn },
        ].map(st => (
          <View key={st.label} style={s.statBox}>
            <Text style={[s.statNum, { color: st.color }]}>{st.num}</Text>
            <Text style={s.statLabel}>{st.label}</Text>
          </View>
        ))}
      </View>
      {urgent.length > 0 && <><Text style={s.sectionLabel}>// URGENT</Text>{urgent.map(r => <ReminderItem key={r.id} r={r} />)}</>}
      {normal.length > 0 && <><Text style={s.sectionLabel}>// UPCOMING</Text>{normal.map(r => <ReminderItem key={r.id} r={r} />)}</>}
      {allReminders.length === 0 && (
        <View style={{ alignItems: "center", padding: 48 }}>
          <Text style={{ fontSize: 48 }}>✅</Text>
          <Text style={[s.bold, { fontSize: 18, marginTop: 12 }]}>All clear!</Text>
          <Text style={{ color: T.textSoft, fontSize: 14, marginTop: 6 }}>No pending reminders.</Text>
        </View>
      )}
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ─── Add Item Modal ───────────────────────────────────────────────────────────
function AddModal({ visible, onClose, onAdd }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Other");
  const categories = ["Dairy", "Protein", "Produce", "Dry Goods", "Beverages", "Other"];
  const emojiMap = { Dairy: "🥛", Protein: "🍗", Produce: "🥬", "Dry Goods": "🥣", Beverages: "🍶", Other: "📦" };

  function handleAdd() {
    if (!name.trim()) return;
    onAdd({ name: name.trim(), category, emoji: emojiMap[category], quantity: 1, expiryDate: new Date(Date.now() + 7 * 86400000).toISOString() });
    setName(""); onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.modalSheet}>
          <View style={s.sheetHandle} />
          <Text style={[s.bold, { fontSize: 20, marginBottom: 20 }]}>Add Item Manually</Text>
          <Text style={s.inputLabel}>Item name *</Text>
          <TextInput style={s.input} placeholder="e.g. Almond Butter" placeholderTextColor={T.muted} value={name} onChangeText={setName} />
          <Text style={[s.inputLabel, { marginTop: 8 }]}>Category</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {categories.map(c => (
              <TouchableOpacity key={c} onPress={() => setCategory(c)} style={[s.chip, category === c && s.chipActive]}>
                <Text style={[s.chipText, category === c && s.chipTextActive]}>{emojiMap[c]} {c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={s.btnPrimary} onPress={handleAdd}>
            <Text style={s.btnPrimaryText}>Add to Fridge</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("fridge");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState("");
  const toastOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => { loadItems(); }, []);

  async function loadItems() {
    try {
      setLoading(true);
      const rows = await dbGetItems();
      setItems(rows.map(rowToItem));
    } catch (e) {
      Alert.alert("Couldn't load fridge", "Check your internet connection.");
    } finally {
      setLoading(false);
    }
  }

  function showToast(msg) {
    setToast(msg);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }

  async function handleScanned(product) {
    try {
      const newItem = {
        name: product.name, category: product.category, emoji: product.emoji,
        quantity: 1, barcode: product.code,
        addedDate: new Date().toISOString(),
        expiryDate: new Date(Date.now() + product.defaultExpiry * 86400000).toISOString(),
      };
      const saved = await dbAddItem(newItem);
      setItems(prev => [rowToItem(saved), ...prev]);
      showToast(`✅ ${product.name} added!`);
      setTimeout(() => setTab("fridge"), 1200);
    } catch (e) {
      Alert.alert("Couldn't save item", "Check your connection.");
    }
  }

  async function handleAddManual(data) {
    try {
      const saved = await dbAddItem(data);
      setItems(prev => [rowToItem(saved), ...prev]);
      showToast(`✅ ${data.name} added!`);
    } catch (e) {
      Alert.alert("Couldn't save item", "Check your connection.");
    }
  }

  async function handleDelete(id) {
    try {
      await dbDeleteItem(id);
      setItems(prev => prev.filter(i => i.id !== id));
      showToast("🗑️ Item removed");
    } catch (e) {
      Alert.alert("Couldn't delete item", "Check your connection.");
    }
  }

  const navItems = [
    { id: "fridge", label: "Fridge", icon: "🧊" },
    { id: "scan", label: "Add", icon: "🔍" },
    { id: "recipes", label: "Recipes", icon: "🍳" },
    { id: "reminders", label: "Alerts", icon: "🔔" },
  ];

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <View style={s.appBar}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={s.appLogo}><Text style={{ fontSize: 14 }}>🧊</Text></View>
          <Text style={s.appName}>FridgeAI</Text>
        </View>
        <View style={s.aiBadge}><Text style={s.aiBadgeText}>⚡ LIVE</Text></View>
      </View>

      <View style={{ flex: 1 }}>
        {tab === "fridge"    && <FridgeScreen    items={items} onDelete={handleDelete} onAdd={() => setShowAdd(true)} loading={loading} />}
        {tab === "scan"      && <ScanScreen      onScanned={handleScanned} />}
        {tab === "recipes"   && <RecipesScreen   items={items} />}
        {tab === "reminders" && <RemindersScreen items={items} />}
      </View>

      {toast !== "" && (
        <Animated.View style={[s.toast, { opacity: toastOpacity }]}>
          <Text style={s.toastText}>{toast}</Text>
        </Animated.View>
      )}

      <AddModal visible={showAdd} onClose={() => setShowAdd(false)} onAdd={handleAddManual} />

      <View style={s.navBar}>
        {navItems.map(n => (
          <TouchableOpacity key={n.id} style={s.navBtn} onPress={() => setTab(n.id)}>
            <Text style={{ fontSize: 22 }}>{n.icon}</Text>
            <Text style={[s.navLabel, tab === n.id && { color: T.accent }]}>{n.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:             { flex: 1, backgroundColor: T.bg },
  screen:           { flex: 1, backgroundColor: T.bg },
  appBar:           { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border },
  appLogo:          { width: 28, height: 28, backgroundColor: T.accent, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  appName:          { fontWeight: "800", fontSize: 16, color: T.accent, letterSpacing: -0.3 },
  headerRow:        { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: 20, paddingBottom: 12 },
  pageTitle:        { fontSize: 26, fontWeight: "800", color: T.text, letterSpacing: -0.5 },
  pageSubtitle:     { color: T.textSoft, fontSize: 13, marginTop: 3 },
  addBtn:           { backgroundColor: T.accent, borderRadius: 12, width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  statsRow:         { flexDirection: "row", gap: 10, paddingHorizontal: 16, marginBottom: 16 },
  statBox:          { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 14, alignItems: "center" },
  statNum:          { fontSize: 26, fontWeight: "800", lineHeight: 30 },
  statLabel:        { fontSize: 10, color: T.textSoft, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  sectionLabel:     { fontSize: 10, color: T.muted, letterSpacing: 1.5, textTransform: "uppercase", paddingHorizontal: 16, marginBottom: 10, marginTop: 16 },
  chip:             { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: T.border, backgroundColor: T.card, marginRight: 8 },
  chipActive:       { backgroundColor: "rgba(74,222,128,0.15)", borderColor: T.accent },
  chipText:         { color: T.textSoft, fontSize: 12, fontWeight: "500" },
  chipTextActive:   { color: T.accent },
  warnBanner:       { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 12, backgroundColor: "rgba(251,146,60,0.08)", borderWidth: 1, borderColor: "rgba(251,146,60,0.25)", borderRadius: 14, padding: 12 },
  fridgeItem:       { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 10, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 14 },
  resultItem:       { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 8, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 14 },
  itemName:         { fontSize: 15, fontWeight: "600", color: T.text },
  itemMeta:         { fontSize: 12, color: T.textSoft, marginTop: 2 },
  expiryBadge:      { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  expiryText:       { fontSize: 11, fontWeight: "600" },
  card:             { backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 16 },
  bold:             { fontWeight: "700", color: T.text },
  monoText:         { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11, letterSpacing: 0.5 },
  inputLabel:       { fontSize: 12, color: T.textSoft, marginBottom: 6, fontWeight: "500" },
  input:            { backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 12, padding: 13, color: T.text, fontSize: 15, marginBottom: 10 },
  btnPrimary:       { backgroundColor: T.accent, borderRadius: 14, padding: 15, alignItems: "center", marginBottom: 0 },
  btnPrimaryText:   { color: T.bg, fontSize: 15, fontWeight: "700" },
  btnSecondary:     { backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 14, alignItems: "center" },
  btnSecondaryText: { color: T.text, fontSize: 15, fontWeight: "600" },
  pill:             { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: "rgba(74,222,128,0.1)", borderWidth: 1, borderColor: "rgba(74,222,128,0.2)" },
  pillText:         { fontSize: 12, color: T.accent, fontWeight: "500" },
  recipeEmojiBox:   { width: 56, height: 56, backgroundColor: "rgba(74,222,128,0.1)", borderWidth: 1, borderColor: "rgba(74,222,128,0.2)", borderRadius: 14, alignItems: "center", justifyContent: "center" },
  backBtn:          { padding: 16, paddingBottom: 0 },
  ingredientRow:    { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  checkBox:         { width: 20, height: 20, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  aiBadge:          { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "rgba(74,222,128,0.1)", borderWidth: 1, borderColor: "rgba(74,222,128,0.2)", borderRadius: 8 },
  aiBadgeText:      { fontSize: 10, color: T.accent, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  reminderIcon:     { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  urgentBadge:      { paddingHorizontal: 8, paddingVertical: 2, backgroundColor: "rgba(248,113,113,0.1)", borderWidth: 1, borderColor: "rgba(248,113,113,0.2)", borderRadius: 4 },
  urgentText:       { fontSize: 10, color: T.danger, fontWeight: "600", letterSpacing: 0.5 },
  dismissBtn:       { width: 32, height: 32, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  navBar:           { flexDirection: "row", backgroundColor: T.surface, borderTopWidth: 1, borderTopColor: T.border, paddingBottom: Platform.OS === "ios" ? 20 : 8, paddingTop: 8 },
  navBtn:           { flex: 1, alignItems: "center", gap: 3 },
  navLabel:         { fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: "500" },
  toast:            { position: "absolute", bottom: 100, left: 16, right: 16, backgroundColor: T.accent, borderRadius: 14, padding: 14 },
  toastText:        { color: T.bg, fontWeight: "700", fontSize: 14, textAlign: "center" },
  modalOverlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "flex-end" },
  modalSheet:       { backgroundColor: T.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 48, borderWidth: 1, borderColor: T.border },
  sheetHandle:      { width: 36, height: 4, backgroundColor: T.border, borderRadius: 99, alignSelf: "center", marginBottom: 20 },
  modeToggle:       { flexDirection: "row", marginHorizontal: 16, marginBottom: 16, backgroundColor: T.card, borderRadius: 12, borderWidth: 1, borderColor: T.border, padding: 4, gap: 4 },
  modeBtn:          { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  modeBtnActive:    { backgroundColor: T.accent },
  modeBtnText:      { fontSize: 13, fontWeight: "600", color: T.textSoft },
  modeBtnTextActive:{ color: T.bg },
  errorBox:         { marginHorizontal: 16, marginBottom: 12, backgroundColor: "rgba(248,113,113,0.08)", borderWidth: 1, borderColor: "rgba(248,113,113,0.25)", borderRadius: 12, padding: 12 },
});