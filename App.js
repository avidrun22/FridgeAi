import { useState, useEffect, useRef } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, SafeAreaView, StatusBar, Modal, Alert,
  Animated, Platform, ActivityIndicator, AppState, KeyboardAvoidingView,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ─── Supabase Client ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://qemarhvgeuzhlwybmbie.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlbWFyaHZnZXV6aGx3eWJtYmllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2Njc2NTgsImV4cCI6MjA5MDI0MzY1OH0.ejYeJkucIwAWZ7Rf0hcmpIENSnnmXMh4V_nhjXlDQk4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ─── DB Helpers ───────────────────────────────────────────────────────────────
async function dbGetItems() {
  const { data, error } = await supabase.from("fridge_items").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

async function dbAddItem(item) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("fridge_items").insert({
    name: item.name, category: item.category, emoji: item.emoji,
    quantity: item.quantity || 1,
    added_date: item.addedDate || new Date().toISOString(),
    expiry_date: item.expiryDate, barcode: item.barcode || null,
    user_id: user.id,
  }).select().single();
  if (error) throw error;
  return data;
}

async function dbUpdateItem(id, updates) {
  const { data, error } = await supabase.from("fridge_items").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

async function dbDeleteItem(id) {
  const { error } = await supabase.from("fridge_items").delete().eq("id", id);
  if (error) throw error;
}

function rowToItem(row) {
  return { id: row.id, name: row.name, category: row.category, emoji: row.emoji, quantity: row.quantity, addedDate: row.added_date, expiryDate: row.expiry_date, barcode: row.barcode };
}

// ─── Open Food Facts ──────────────────────────────────────────────────────────
const CATEGORY_MAP = { "beverages": "Beverages", "dairies": "Dairy", "dairy": "Dairy", "cheeses": "Dairy", "milks": "Dairy", "yogurts": "Dairy", "meats": "Protein", "poultry": "Protein", "seafood": "Protein", "eggs": "Protein", "fish": "Protein", "fruits": "Produce", "vegetables": "Produce", "fresh": "Produce", "breads": "Dry Goods", "cereals": "Dry Goods", "snacks": "Dry Goods", "pasta": "Dry Goods" };
const EMOJI_MAP = { "Dairy": "🧀", "Protein": "🍗", "Produce": "🥬", "Dry Goods": "🥣", "Beverages": "🍶", "Other": "📦" };
const EXPIRY_MAP = { "Dairy": 14, "Protein": 3, "Produce": 5, "Dry Goods": 180, "Beverages": 7, "Other": 7 };
function categorize(tags) { if (!tags) return "Other"; const joined = tags.join(" ").toLowerCase(); for (const [key, val] of Object.entries(CATEGORY_MAP)) { if (joined.includes(key)) return val; } return "Other"; }

function productFromOFF(p, barcode) {
  const name = p.product_name_en || p.product_name || "";
  const brand = p.brands ? p.brands.split(",")[0].trim() : "";
  const fullName = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name || "Unknown Product";
  const category = categorize(p.categories_tags);
  const n = p.nutriments || {};
  const serving = p.serving_size || "100g";
  const nutrition = { serving, calories: n["energy-kcal_serving"] ?? n["energy-kcal_100g"] ?? null, fat: n["fat_serving"] ?? n["fat_100g"] ?? null, saturatedFat: n["saturated-fat_serving"] ?? n["saturated-fat_100g"] ?? null, carbs: n["carbohydrates_serving"] ?? n["carbohydrates_100g"] ?? null, sugars: n["sugars_serving"] ?? n["sugars_100g"] ?? null, fiber: n["fiber_serving"] ?? n["fiber_100g"] ?? null, protein: n["proteins_serving"] ?? n["proteins_100g"] ?? null, salt: n["salt_serving"] ?? n["salt_100g"] ?? null };
  const hasNutrition = Object.values(nutrition).some((v, i) => i > 0 && v !== null);
  return { name: fullName.trim(), category, emoji: EMOJI_MAP[category], defaultExpiry: EXPIRY_MAP[category], code: barcode || p.code || null, nutritionGrade: p.nutrition_grades || null, nutrition: hasNutrition ? nutrition : null, ingredients: p.ingredients_text_en || p.ingredients_text || null };
}

async function lookupBarcode(barcode) { const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`); const data = await res.json(); if (data.status !== 1 || !data.product) return null; return productFromOFF(data.product, barcode); }
async function searchProducts(query) { const encoded = encodeURIComponent(query); const res = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encoded}&search_simple=1&action=process&json=1&page_size=20&fields=product_name,product_name_en,brands,categories_tags,nutrition_grades,nutriments,serving_size,ingredients_text_en,code`); const data = await res.json(); if (!data.products) return []; return data.products.filter(p => p.product_name || p.product_name_en).slice(0, 10).map(p => productFromOFF(p, p.code)); }

// ─── Theme ────────────────────────────────────────────────────────────────────
const T = { bg: "#0A0F0A", surface: "#111811", card: "#161E16", accent: "#4ADE80", warn: "#FB923C", danger: "#F87171", muted: "#4B5E4B", text: "#E8F5E8", textSoft: "#9DB89D", border: "#1E2E1E" };
function daysUntil(dateStr) { return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000); }
function expiryColor(days) { return days <= 1 ? T.danger : days <= 3 ? T.warn : T.accent; }
function formatDate(dateStr) { return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function round1(n) { return Math.round(n * 10) / 10; }

// ─── Unit Groups ──────────────────────────────────────────────────────────────
const UNIT_GROUPS = [
  { label: "Volume", units: ["tsp", "tbsp", "fl oz", "cup", "pint", "quart", "gallon", "ml", "L"] },
  { label: "Weight", units: ["g", "kg", "oz", "lb"] },
  { label: "Count", units: ["piece", "slice", "serving", "portion", "handful"] },
  { label: "Fraction", units: ["quarter", "third", "half", "¾"] },
];
const FRACTION_MAP = { "quarter": 0.25, "third": 0.333, "half": 0.5, "¾": 0.75 };

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    if (!email || !password) { setError("Please enter your email and password."); return; }
    setLoading(true); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message);
    setLoading(false);
  }

  async function handleSignup() {
    if (!email || !password) { setError("Please enter your email and password."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true); setError("");
    const { error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) setError(error.message);
    else Alert.alert("Check your email!", "We sent you a confirmation link. Click it then come back and log in.");
    setLoading(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }} keyboardShouldPersistTaps="handled">

          {/* Logo */}
          <View style={{ alignItems: "center", marginBottom: 48 }}>
            <View style={{ width: 80, height: 80, backgroundColor: T.accent, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <Text style={{ fontSize: 40 }}>🧊</Text>
            </View>
            <Text style={{ fontSize: 32, fontWeight: "800", color: T.accent, letterSpacing: -1 }}>FridgeAI</Text>
            <Text style={{ color: T.textSoft, fontSize: 14, marginTop: 6 }}>Your smart fridge companion</Text>
          </View>

          {/* Mode Toggle */}
          <View style={[s.modeToggle, { marginBottom: 24 }]}>
            <TouchableOpacity style={[s.modeBtn, mode === "login" && s.modeBtnActive]} onPress={() => { setMode("login"); setError(""); }}>
              <Text style={[s.modeBtnText, mode === "login" && s.modeBtnTextActive]}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.modeBtn, mode === "signup" && s.modeBtnActive]} onPress={() => { setMode("signup"); setError(""); }}>
              <Text style={[s.modeBtnText, mode === "signup" && s.modeBtnTextActive]}>Create Account</Text>
            </TouchableOpacity>
          </View>

          {/* Form */}
          <View style={[s.card, { padding: 20, marginBottom: 16 }]}>
            <Text style={s.inputLabel}>Email</Text>
            <TextInput
              style={s.input}
              placeholder="you@example.com"
              placeholderTextColor={T.muted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={s.inputLabel}>Password</Text>
            <TextInput
              style={s.input}
              placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
              placeholderTextColor={T.muted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            {error !== "" && (
              <View style={[s.errorBox, { marginBottom: 8 }]}>
                <Text style={{ color: T.danger, fontSize: 13 }}>{error}</Text>
              </View>
            )}
            <TouchableOpacity style={s.btnPrimary} onPress={mode === "login" ? handleLogin : handleSignup} disabled={loading}>
              {loading ? <ActivityIndicator color={T.bg} /> : <Text style={s.btnPrimaryText}>{mode === "login" ? "Sign In" : "Create Account"}</Text>}
            </TouchableOpacity>
          </View>

          {mode === "signup" && (
            <Text style={{ color: T.textSoft, fontSize: 12, textAlign: "center", lineHeight: 18 }}>
              After signing up, check your email for a confirmation link before signing in.
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Nutrition Panel ──────────────────────────────────────────────────────────
function NutritionPanel({ nutrition, grade }) {
  if (!nutrition) return null;
  function nutriColor(g) { const map = { a: "#4ADE80", b: "#86EFAC", c: "#FCD34D", d: "#FB923C", e: "#F87171" }; return map[g?.toLowerCase()] || T.muted; }
  const rows = [
    { label: "Calories", value: nutrition.calories, unit: "kcal" },
    { label: "Fat", value: nutrition.fat, unit: "g" },
    { label: "Saturated Fat", value: nutrition.saturatedFat, unit: "g", indent: true },
    { label: "Carbohydrates", value: nutrition.carbs, unit: "g" },
    { label: "Sugars", value: nutrition.sugars, unit: "g", indent: true },
    { label: "Fiber", value: nutrition.fiber, unit: "g", indent: true },
    { label: "Protein", value: nutrition.protein, unit: "g" },
    { label: "Salt", value: nutrition.salt, unit: "g" },
  ].filter(r => r.value !== null && r.value !== undefined);
  if (rows.length === 0) return null;
  return (
    <View style={[s.card, { marginBottom: 12, overflow: "hidden" }]}>
      <View style={{ backgroundColor: "rgba(74,222,128,0.08)", padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: T.border }}>
        <View><Text style={[s.bold, { fontSize: 14, letterSpacing: 0.5 }]}>NUTRITION FACTS</Text><Text style={{ color: T.textSoft, fontSize: 11, marginTop: 2 }}>Per serving · {nutrition.serving}</Text></View>
        {grade && <View style={{ backgroundColor: nutriColor(grade), borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, alignItems: "center" }}><Text style={{ color: "#0A0F0A", fontSize: 10, fontWeight: "700" }}>NUTRI</Text><Text style={{ color: "#0A0F0A", fontSize: 20, fontWeight: "800", lineHeight: 24 }}>{grade.toUpperCase()}</Text></View>}
      </View>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 9, paddingHorizontal: 14, borderBottomWidth: i < rows.length - 1 ? 1 : 0, borderBottomColor: T.border }}>
          <Text style={{ fontSize: 13, color: row.indent ? T.textSoft : T.text, marginLeft: row.indent ? 16 : 0, fontWeight: row.indent ? "400" : "600" }}>{row.label}</Text>
          <Text style={{ fontSize: 13, color: T.accent, fontWeight: "600", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}>{round1(row.value)}{row.unit}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Use Item Modal ───────────────────────────────────────────────────────────
function UseItemModal({ item, visible, onClose, onUse }) {
  const [amount, setAmount] = useState("1");
  const [selectedUnit, setSelectedUnit] = useState("tbsp");
  const [expandedGroup, setExpandedGroup] = useState("Volume");

  useEffect(() => { if (visible) { setAmount("1"); setSelectedUnit("tbsp"); setExpandedGroup("Volume"); } }, [visible]);

  if (!item) return null;

  const currentQtyText = item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : "1";
  const currentQtyNum = parseFloat(currentQtyText) || 1;
  const currentUnit = currentQtyText.replace(/[\d.]/g, "").trim() || null;

  function getNewQuantity() {
    const used = parseFloat(amount) || 0;
    if (used <= 0) return currentQtyText;
    if (currentUnit && selectedUnit === currentUnit) { const remaining = Math.max(0, currentQtyNum - used); return remaining <= 0.01 ? null : `${round1(remaining)} ${selectedUnit}`; }
    if (FRACTION_MAP[selectedUnit]) { const fraction = FRACTION_MAP[selectedUnit]; const remaining = Math.max(0, currentQtyNum - fraction * currentQtyNum); return remaining <= 0.01 ? null : `${round1(remaining)} ${currentUnit || "units"}`; }
    return `${currentQtyText} (used ${amount} ${selectedUnit})`;
  }

  function handleUse() {
    const used = parseFloat(amount) || 0;
    if (used <= 0) { Alert.alert("Enter an amount", "Please enter how much you used."); return; }
    const newQty = getNewQuantity();
    if (newQty === null) { Alert.alert("Item Fully Used", `Remove ${item.name} from your fridge?`, [{ text: "Keep it", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => onUse(item.id, null) }]); }
    else { onUse(item.id, newQty); }
  }

  const preview = getNewQuantity();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[s.modalSheet, { maxHeight: "85%" }]}>
          <View style={s.sheetHandle} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <Text style={{ fontSize: 36 }}>{item.emoji}</Text>
            <View><Text style={[s.bold, { fontSize: 18 }]}>Use Item</Text><Text style={{ color: T.textSoft, fontSize: 13 }}>{item.name}</Text></View>
          </View>
          <View style={{ backgroundColor: T.card, borderRadius: 12, padding: 12, marginBottom: 16, flexDirection: "row", justifyContent: "space-between", borderWidth: 1, borderColor: T.border }}>
            <Text style={{ color: T.textSoft, fontSize: 13 }}>Current amount</Text>
            <Text style={[s.bold, { color: T.accent }]}>{currentQtyText}</Text>
          </View>
          <Text style={s.inputLabel}>How much did you use?</Text>
          <TextInput style={[s.input, { fontSize: 20, textAlign: "center", fontWeight: "700" }]} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={T.muted} />
          <Text style={[s.inputLabel, { marginBottom: 8 }]}>Unit</Text>
          <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
            {UNIT_GROUPS.map(group => (
              <View key={group.label} style={{ marginBottom: 8 }}>
                <TouchableOpacity onPress={() => setExpandedGroup(expandedGroup === group.label ? null : group.label)} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 }}>
                  <Text style={{ color: T.textSoft, fontSize: 12, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase" }}>{group.label}</Text>
                  <Text style={{ color: T.muted, fontSize: 12 }}>{expandedGroup === group.label ? "▲" : "▼"}</Text>
                </TouchableOpacity>
                {expandedGroup === group.label && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {group.units.map(unit => (
                      <TouchableOpacity key={unit} onPress={() => setSelectedUnit(unit)} style={[{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 }, selectedUnit === unit ? { backgroundColor: "rgba(74,222,128,0.15)", borderColor: T.accent } : { backgroundColor: T.card, borderColor: T.border }]}>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: selectedUnit === unit ? T.accent : T.textSoft }}>{unit}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
          {amount && parseFloat(amount) > 0 && (
            <View style={{ backgroundColor: "rgba(74,222,128,0.08)", borderRadius: 12, padding: 12, marginTop: 12, borderWidth: 1, borderColor: "rgba(74,222,128,0.2)" }}>
              <Text style={{ color: T.textSoft, fontSize: 12, marginBottom: 4 }}>Remaining after use</Text>
              <Text style={[s.bold, { color: T.accent, fontSize: 16 }]}>{preview === null ? "🗑 Item will be removed" : preview}</Text>
            </View>
          )}
          <TouchableOpacity style={[s.btnPrimary, { marginTop: 16 }]} onPress={handleUse}><Text style={s.btnPrimaryText}>✅  Confirm Usage</Text></TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Item Detail Modal ────────────────────────────────────────────────────────
function ItemDetailModal({ item, visible, onClose, onUpdate, onDelete, onShowUse }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [category, setCategory] = useState("");
  const [loadingNutrition, setLoadingNutrition] = useState(false);
  const [nutrition, setNutrition] = useState(null);
  const [nutritionGrade, setNutritionGrade] = useState(null);
  const [ingredients, setIngredients] = useState(null);

  const categories = ["Dairy", "Protein", "Produce", "Dry Goods", "Beverages", "Other"];
  const emojiMap = { Dairy: "🥛", Protein: "🍗", Produce: "🥬", "Dry Goods": "🥣", Beverages: "🍶", Other: "📦" };

  useEffect(() => {
    if (item && visible) {
      setName(item.name); setExpiryDate(item.expiryDate ? item.expiryDate.split("T")[0] : "");
      setQuantity(String(item.quantity || 1)); setCategory(item.category || "Other");
      setNutrition(null); setNutritionGrade(null); setIngredients(null); setEditing(false);
      if (item.barcode) {
        setLoadingNutrition(true);
        lookupBarcode(item.barcode).then(product => {
          if (product) { setNutrition(product.nutrition); setNutritionGrade(product.nutritionGrade); setIngredients(product.ingredients); }
          setLoadingNutrition(false);
        }).catch(() => setLoadingNutrition(false));
      }
    }
  }, [item, visible]);

  if (!item) return null;
  const days = daysUntil(item.expiryDate);
  const color = expiryColor(days);

  async function handleSave() {
    const updates = { name: name.trim(), category, emoji: emojiMap[category] || item.emoji, quantity: quantity || "1", expiry_date: expiryDate ? new Date(expiryDate).toISOString() : item.expiryDate };
    await onUpdate(item.id, updates); setEditing(false);
  }

  function handleDelete() {
    Alert.alert("Remove Item", `Remove ${item.name} from your fridge?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => { onDelete(item.id); onClose(); } }
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.border }}>
          <TouchableOpacity onPress={onClose}><Text style={{ color: T.accent, fontSize: 15 }}>← Back</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => editing ? handleSave() : setEditing(true)}>
            <Text style={{ color: T.accent, fontSize: 15, fontWeight: "700" }}>{editing ? "Save" : "Edit"}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: "center", padding: 24, paddingBottom: 16 }}>
            <Text style={{ fontSize: 72 }}>{emojiMap[category] || item.emoji}</Text>
            {editing ? <TextInput style={[s.input, { textAlign: "center", fontSize: 18, fontWeight: "700", marginTop: 12, marginBottom: 0, width: "100%" }]} value={name} onChangeText={setName} /> : <Text style={[s.pageTitle, { textAlign: "center", marginTop: 12, fontSize: 22 }]}>{item.name}</Text>}
            <View style={[s.expiryBadge, { backgroundColor: color + "22", borderColor: color + "55", marginTop: 10 }]}>
              <Text style={[s.expiryText, { color, fontSize: 13 }]}>{days <= 0 ? "Expired" : days === 1 ? "Expires tomorrow" : `Expires in ${days} days`}</Text>
            </View>
          </View>
          <View style={{ paddingHorizontal: 16 }}>
            {!editing && (
              <TouchableOpacity style={{ backgroundColor: "rgba(74,222,128,0.12)", borderWidth: 1.5, borderColor: T.accent, borderRadius: 14, padding: 16, marginBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }} onPress={() => { onClose(); setTimeout(() => onShowUse(item), 350); }}>
                <Text style={{ fontSize: 20 }}>🍽</Text>
                <View><Text style={[s.bold, { color: T.accent, fontSize: 15 }]}>Use Item</Text><Text style={{ color: T.textSoft, fontSize: 12, marginTop: 1 }}>Track how much you used</Text></View>
              </TouchableOpacity>
            )}
            <View style={[s.card, { padding: 16, marginBottom: 12 }]}>
              <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 12, paddingHorizontal: 0 }]}>DETAILS</Text>
              <View style={{ marginBottom: 12 }}>
                <Text style={s.inputLabel}>Category</Text>
                {editing ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{categories.map(c => (<TouchableOpacity key={c} onPress={() => setCategory(c)} style={[s.chip, category === c && s.chipActive, { marginRight: 0 }]}><Text style={[s.chipText, category === c && s.chipTextActive]}>{c}</Text></TouchableOpacity>))}</View> : <Text style={{ color: T.text, fontSize: 15 }}>{item.category}</Text>}
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}><Text style={s.inputLabel}>Amount</Text>{editing ? <TextInput style={s.input} value={quantity} onChangeText={setQuantity} placeholder="e.g. 1 gallon" placeholderTextColor={T.muted} /> : <Text style={{ color: T.text, fontSize: 15 }}>{item.quantity}</Text>}</View>
                <View style={{ flex: 2 }}><Text style={s.inputLabel}>Expiry Date</Text>{editing ? <TextInput style={s.input} value={expiryDate} onChangeText={setExpiryDate} placeholder="YYYY-MM-DD" placeholderTextColor={T.muted} /> : <Text style={{ color: T.text, fontSize: 15 }}>{formatDate(item.expiryDate)}</Text>}</View>
              </View>
              {item.barcode && <View style={{ marginTop: 8 }}><Text style={s.inputLabel}>Barcode</Text><Text style={[s.monoText, { color: T.textSoft, fontSize: 12 }]}>{item.barcode}</Text></View>}
              <View style={{ marginTop: 8 }}><Text style={s.inputLabel}>Added</Text><Text style={{ color: T.textSoft, fontSize: 13 }}>{formatDate(item.addedDate)}</Text></View>
            </View>
            {loadingNutrition && <View style={[s.card, { padding: 20, marginBottom: 12, alignItems: "center" }]}><ActivityIndicator color={T.accent} /><Text style={{ color: T.textSoft, fontSize: 13, marginTop: 8 }}>Loading nutrition data...</Text></View>}
            {!loadingNutrition && nutrition && <NutritionPanel nutrition={nutrition} grade={nutritionGrade} />}
            {!loadingNutrition && !nutrition && item.barcode && <View style={[s.card, { padding: 16, marginBottom: 12 }]}><Text style={{ color: T.textSoft, fontSize: 13, textAlign: "center" }}>No nutrition data available for this product.</Text></View>}
            {!item.barcode && <View style={[s.card, { padding: 16, marginBottom: 12 }]}><Text style={{ color: T.textSoft, fontSize: 13, textAlign: "center" }}>Scan a barcode when adding items to see nutrition facts.</Text></View>}
            {ingredients && <View style={[s.card, { padding: 14, marginBottom: 12 }]}><Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 8, paddingHorizontal: 0 }]}>INGREDIENTS</Text><Text style={{ color: T.textSoft, fontSize: 12, lineHeight: 18 }}>{ingredients}</Text></View>}
            <TouchableOpacity onPress={handleDelete} style={[s.btnSecondary, { borderColor: T.danger + "55", marginBottom: 32 }]}>
              <Text style={{ color: T.danger, fontSize: 15, fontWeight: "600" }}>🗑  Remove from Fridge</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Camera Scanner ───────────────────────────────────────────────────────────
function CameraScanner({ onCodeDetected, onClose }) {
  const [permission, requestPermission] = useCameraPermissions();
  const detected = useRef(false);
  if (!permission) return <View style={{ flex: 1, backgroundColor: "#000" }} />;
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: 12 }}>Camera Permission Required</Text>
        <TouchableOpacity onPress={requestPermission} style={{ backgroundColor: T.accent, borderRadius: 12, padding: 14, paddingHorizontal: 28, marginBottom: 16 }}><Text style={{ color: T.bg, fontWeight: "700", fontSize: 15 }}>Grant Permission</Text></TouchableOpacity>
        <TouchableOpacity onPress={onClose}><Text style={{ color: "#aaa", fontSize: 14 }}>Cancel</Text></TouchableOpacity>
      </View>
    );
  }
  function handleBarcodeScanned({ data }) { if (detected.current) return; detected.current = true; onCodeDetected(data); }
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39"] }} onBarcodeScanned={handleBarcodeScanned} />
      <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 260, height: 200, position: "relative" }}>
          {[{ top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 }, { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 }, { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 }, { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 }].map((style, i) => (
            <View key={i} style={[{ position: "absolute", width: 30, height: 30, borderColor: T.accent }, style]} />
          ))}
        </View>
        <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, marginTop: 20 }}>Point at a barcode to scan</Text>
      </View>
      <TouchableOpacity onPress={onClose} style={{ position: "absolute", top: 60, right: 20, width: 40, height: 40, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 20, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#fff", fontSize: 20, lineHeight: 24 }}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Fridge Screen ────────────────────────────────────────────────────────────
function FridgeScreen({ items, onDelete, onAdd, onUpdate, onUse, loading }) {
  const [filter, setFilter] = useState("All");
  const [selectedItem, setSelectedItem] = useState(null);
  const [useItem, setUseItem] = useState(null);
  const categories = ["All", "Dairy", "Protein", "Produce", "Dry Goods", "Beverages"];
  const filtered = filter === "All" ? items : items.filter(i => i.category === filter);
  const expiringSoon = items.filter(i => daysUntil(i.expiryDate) <= 3).length;

  return (
    <>
      <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
        <View style={s.headerRow}>
          <View><Text style={s.pageTitle}>My Fridge</Text><Text style={s.pageSubtitle}>{loading ? "Loading..." : `${items.length} items tracked`}</Text></View>
          <TouchableOpacity style={s.addBtn} onPress={onAdd}><Text style={{ color: T.bg, fontSize: 24, lineHeight: 28 }}>+</Text></TouchableOpacity>
        </View>
        <View style={s.statsRow}>
          {[{ num: items.length, label: "Total Items", color: T.accent }, { num: expiringSoon, label: "Expiring Soon", color: expiringSoon > 0 ? T.warn : T.accent }, { num: [...new Set(items.map(i => i.category))].length, label: "Categories", color: T.accent }].map(st => (
            <View key={st.label} style={s.statBox}><Text style={[s.statNum, { color: st.color }]}>{st.num}</Text><Text style={s.statLabel}>{st.label}</Text></View>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingLeft: 16, marginBottom: 16 }}>
          {categories.map(c => (<TouchableOpacity key={c} onPress={() => setFilter(c)} style={[s.chip, filter === c && s.chipActive]}><Text style={[s.chipText, filter === c && s.chipTextActive]}>{c}</Text></TouchableOpacity>))}
        </ScrollView>
        {expiringSoon > 0 && <View style={s.warnBanner}><Text style={{ fontSize: 18 }}>⚠️</Text><View style={{ marginLeft: 10 }}><Text style={[s.bold, { color: T.warn }]}>Heads up!</Text><Text style={{ color: T.textSoft, fontSize: 12 }}>{expiringSoon} item{expiringSoon > 1 ? "s" : ""} expiring within 3 days</Text></View></View>}
        {loading ? (
          <View style={{ alignItems: "center", padding: 48 }}><ActivityIndicator color={T.accent} size="large" /><Text style={{ color: T.textSoft, marginTop: 12 }}>Loading your fridge...</Text></View>
        ) : (
          <>
            <Text style={s.sectionLabel}>// CONTENTS · TAP TO VIEW DETAILS</Text>
            {filtered.length === 0 && <View style={{ alignItems: "center", padding: 48 }}><Text style={{ fontSize: 48 }}>🧊</Text><Text style={[s.bold, { fontSize: 18, marginTop: 12 }]}>Your fridge is empty!</Text><Text style={{ color: T.textSoft, fontSize: 14, marginTop: 6 }}>Tap + or use the Add tab.</Text></View>}
            {filtered.map(item => {
              const days = daysUntil(item.expiryDate); const color = expiryColor(days);
              return (
                <TouchableOpacity key={item.id} style={s.fridgeItem} onPress={() => setSelectedItem(item)} activeOpacity={0.7}>
                  <Text style={{ fontSize: 32, width: 44, textAlign: "center" }}>{item.emoji}</Text>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={s.itemName} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.itemMeta}>{item.category} · {item.quantity}</Text>
                    {item.barcode && <Text style={[s.monoText, { color: T.muted, fontSize: 10, marginTop: 2 }]}>#{item.barcode}</Text>}
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 8 }}>
                    <View style={[s.expiryBadge, { backgroundColor: color + "22", borderColor: color + "55" }]}><Text style={[s.expiryText, { color }]}>{days <= 0 ? "Expired" : days === 1 ? "1 day" : `${days}d`}</Text></View>
                    <Text style={{ color: T.muted, fontSize: 12 }}>›</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
      <ItemDetailModal item={selectedItem} visible={!!selectedItem} onClose={() => setSelectedItem(null)} onUpdate={async (id, updates) => { await onUpdate(id, updates); setSelectedItem(null); }} onDelete={(id) => { onDelete(id); setSelectedItem(null); }} onShowUse={(item) => setUseItem(item)} />
      <UseItemModal item={useItem} visible={!!useItem} onClose={() => setUseItem(null)} onUse={(id, newQty) => { onUse(id, newQty); setUseItem(null); }} />
    </>
  );
}

// ─── Scan Screen ──────────────────────────────────────────────────────────────
function ScanScreen({ onScanned }) {
  const [mode, setMode] = useState("search");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [showCamera, setShowCamera] = useState(false);
  const [cameraLooking, setCameraLooking] = useState(false);
  const DEMO_SEARCHES = ["avocado", "greek yogurt", "chicken breast", "almond milk", "sourdough bread"];

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true); setError(""); setResults([]); setSelected(null);
    try {
      const isBarcode = /^\d{8,14}$/.test(query.trim());
      if (isBarcode) { const product = await lookupBarcode(query.trim()); if (product) setResults([product]); else setError("Barcode not found. Try searching by name."); }
      else { const products = await searchProducts(query.trim()); if (products.length > 0) setResults(products); else setError(`No results for "${query}".`); }
    } catch (e) { setError("Couldn't connect. Check your internet."); }
    setSearching(false);
  }

  function handleDemoSearch(term) {
    setQuery(term); setSearching(true); setError(""); setResults([]); setSelected(null);
    searchProducts(term).then(products => { if (products.length > 0) setResults(products); else setError(`No results.`); setSearching(false); }).catch(() => { setError("Couldn't connect."); setSearching(false); });
  }

  async function handleCodeDetected(code) {
    setShowCamera(false); setCameraLooking(true); setError("");
    try { const product = await lookupBarcode(code); if (product) { setResults([product]); setSelected(product); } else setError(`Barcode ${code} not found. Try searching by name.`); }
    catch (e) { setError("Couldn't look up barcode. Check your connection."); }
    setCameraLooking(false);
  }

  function addToFridge(product) { onScanned(product); setSelected(null); setResults([]); setQuery(""); setError(""); }
  function nutriColor(grade) { const map = { a: "#4ADE80", b: "#86EFAC", c: "#FCD34D", d: "#FB923C", e: "#F87171" }; return map[grade?.toLowerCase()] || T.muted; }

  if (showCamera) return <CameraScanner onCodeDetected={handleCodeDetected} onClose={() => setShowCamera(false)} />;

  return (
    <ScrollView style={s.screen} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={s.headerRow}>
        <View><Text style={s.pageTitle}>Add Item</Text><Text style={s.pageSubtitle}>Scan, search, or enter a barcode</Text></View>
        <View style={s.aiBadge}><Text style={s.aiBadgeText}>🌍 LIVE DB</Text></View>
      </View>
      <TouchableOpacity style={s.cameraBigBtn} onPress={() => setShowCamera(true)} disabled={cameraLooking}>
        {cameraLooking ? <><ActivityIndicator color={T.bg} /><View style={{ marginLeft: 14 }}><Text style={[s.bold, { fontSize: 16, color: T.bg }]}>Looking up product...</Text></View></> : <><Text style={{ fontSize: 32 }}>📷</Text><View style={{ marginLeft: 14 }}><Text style={[s.bold, { fontSize: 16, color: T.bg }]}>Scan Barcode</Text><Text style={{ fontSize: 12, color: T.bg, opacity: 0.7, marginTop: 2 }}>Point camera at any grocery barcode</Text></View></>}
      </TouchableOpacity>
      <View style={s.modeToggle}>
        <TouchableOpacity style={[s.modeBtn, mode === "search" && s.modeBtnActive]} onPress={() => { setMode("search"); setResults([]); setError(""); setQuery(""); }}><Text style={[s.modeBtnText, mode === "search" && s.modeBtnTextActive]}>🔍  Search by name</Text></TouchableOpacity>
        <TouchableOpacity style={[s.modeBtn, mode === "barcode" && s.modeBtnActive]} onPress={() => { setMode("barcode"); setResults([]); setError(""); setQuery(""); }}><Text style={[s.modeBtnText, mode === "barcode" && s.modeBtnTextActive]}>📦  Enter barcode</Text></TouchableOpacity>
      </View>
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <TextInput style={[s.input, { fontSize: 16, padding: 15 }]} placeholder={mode === "search" ? "e.g. avocado, greek yogurt..." : "e.g. 049000028911"} placeholderTextColor={T.muted} value={query} onChangeText={setQuery} keyboardType={mode === "barcode" ? "numeric" : "default"} returnKeyType="search" onSubmitEditing={handleSearch} autoCapitalize="none" />
        <TouchableOpacity style={s.btnPrimary} onPress={handleSearch} disabled={searching}>
          {searching ? <ActivityIndicator color={T.bg} /> : <Text style={s.btnPrimaryText}>{mode === "search" ? "🔍  Search Food Database" : "📦  Look Up Barcode"}</Text>}
        </TouchableOpacity>
      </View>
      {error !== "" && <View style={s.errorBox}><Text style={{ color: T.danger, fontSize: 13 }}>{error}</Text></View>}
      {results.length > 0 && !selected && (
        <>{<Text style={s.sectionLabel}>// {results.length} RESULT{results.length !== 1 ? "S" : ""} FOUND</Text>}
          {results.map((product, i) => (
            <TouchableOpacity key={i} style={s.resultItem} onPress={() => setSelected(product)}>
              <Text style={{ fontSize: 28, width: 40, textAlign: "center" }}>{product.emoji}</Text>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.itemName} numberOfLines={2}>{product.name}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <Text style={{ color: T.textSoft, fontSize: 12 }}>{product.category}</Text>
                  {product.nutritionGrade && <View style={{ backgroundColor: nutriColor(product.nutritionGrade) + "22", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1, borderColor: nutriColor(product.nutritionGrade) + "55" }}><Text style={{ fontSize: 10, fontWeight: "700", color: nutriColor(product.nutritionGrade) }}>Nutri-{product.nutritionGrade.toUpperCase()}</Text></View>}
                </View>
              </View>
              <Text style={{ color: T.accent, fontSize: 18 }}>›</Text>
            </TouchableOpacity>
          ))}
        </>
      )}
      {selected && (
        <View style={{ paddingHorizontal: 16 }}>
          <TouchableOpacity onPress={() => setSelected(null)} style={{ marginBottom: 12 }}><Text style={{ color: T.accent, fontSize: 14 }}>← Back to results</Text></TouchableOpacity>
          <View style={[s.card, { padding: 20, marginBottom: 12 }]}>
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <Text style={{ fontSize: 56 }}>{selected.emoji}</Text>
              <Text style={[s.bold, { fontSize: 18, textAlign: "center", marginTop: 10, lineHeight: 24 }]}>{selected.name}</Text>
              <View style={[s.pill, { marginTop: 10 }]}><Text style={s.pillText}>{selected.category}</Text></View>
            </View>
            <View style={{ backgroundColor: T.surface, borderRadius: 12, padding: 14 }}>
              <Text style={[s.inputLabel, { marginBottom: 2 }]}>Suggested expiry</Text>
              <Text style={[s.bold, { fontSize: 18, color: T.accent }]}>{selected.defaultExpiry} days from today</Text>
            </View>
          </View>
          <NutritionPanel nutrition={selected.nutrition} grade={selected.nutritionGrade} />
          {selected.ingredients && <View style={[s.card, { marginBottom: 12, padding: 14 }]}><Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 8, paddingHorizontal: 0 }]}>INGREDIENTS</Text><Text style={{ color: T.textSoft, fontSize: 12, lineHeight: 18 }}>{selected.ingredients}</Text></View>}
          <TouchableOpacity style={[s.btnPrimary, { marginBottom: 10 }]} onPress={() => addToFridge(selected)}><Text style={s.btnPrimaryText}>✅  Add to My Fridge</Text></TouchableOpacity>
          <TouchableOpacity style={s.btnSecondary} onPress={() => setSelected(null)}><Text style={s.btnSecondaryText}>Choose a Different Result</Text></TouchableOpacity>
        </View>
      )}
      {results.length === 0 && !searching && !cameraLooking && error === "" && (
        <><Text style={s.sectionLabel}>// TRY SEARCHING FOR</Text>
          <View style={{ paddingHorizontal: 16, flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {DEMO_SEARCHES.map(term => (<TouchableOpacity key={term} onPress={() => handleDemoSearch(term)} style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 20 }}><Text style={{ color: T.textSoft, fontSize: 13 }}>🔍 {term}</Text></TouchableOpacity>))}
          </View>
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
    { name: "Chicken Florentine", time: "25 min", difficulty: "Easy", emoji: "🍳", ingredients: [{ item: "Chicken Breast", amount: "2 fillets" }, { item: "Baby Spinach", amount: "2 cups" }, { item: "Cheddar Cheese", amount: "½ cup" }], instructions: ["Season chicken with salt and pepper.", "Sear in olive oil 5-6 min per side.", "Wilt spinach in same pan.", "Top with spinach and cheese, cover to melt."], description: "Pan-seared chicken with wilted spinach and melted cheddar.", tip: "Deglaze with white wine for extra flavour." },
    { name: "Spinach Omelette", time: "10 min", difficulty: "Easy", emoji: "🥚", ingredients: [{ item: "Eggs", amount: "3 eggs" }, { item: "Baby Spinach", amount: "1 cup" }, { item: "Cheddar Cheese", amount: "¼ cup" }], instructions: ["Whisk eggs with salt and pepper.", "Melt butter in pan over medium-low.", "Pour in eggs, add spinach and cheese to one half.", "Fold and serve."], description: "Fluffy omelette with spinach and cheese.", tip: "Low and slow heat makes fluffiest eggs." },
  ];
  const displayRecipes = recipes.length > 0 ? recipes : defaultRecipes;

  async function getAIRecipes() {
    setLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2000, messages: [{ role: "user", content: `I have: ${items.map(i => i.name).join(", ")}. Suggest 3 recipes. Respond ONLY with JSON array (no markdown): [{"name":"","time":"","difficulty":"","emoji":"","description":"","ingredients":[{"item":"","amount":""}],"instructions":[""],"tip":""}]` }] }) });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "[]";
      setRecipes(JSON.parse(text.replace(/```json|```/g, "").trim()));
    } catch (e) { Alert.alert("Couldn't load AI recipes", "Check your connection."); }
    setLoading(false);
  }

  if (selected) {
    const itemNames = items.map(i => i.name.toLowerCase());
    return (
      <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={s.backBtn} onPress={() => setSelected(null)}><Text style={{ color: T.accent, fontSize: 15 }}>← Back</Text></TouchableOpacity>
        <View style={{ alignItems: "center", padding: 24 }}>
          <Text style={{ fontSize: 64 }}>{selected.emoji}</Text>
          <Text style={[s.pageTitle, { textAlign: "center", marginTop: 12 }]}>{selected.name}</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}><View style={s.pill}><Text style={s.pillText}>⏱ {selected.time}</Text></View><View style={s.pill}><Text style={s.pillText}>{selected.difficulty}</Text></View></View>
        </View>
        <View style={[s.card, { margin: 16, padding: 16, marginBottom: 12 }]}><Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 8, paddingHorizontal: 0 }]}>DESCRIPTION</Text><Text style={{ color: T.textSoft, fontSize: 14, lineHeight: 22 }}>{selected.description}</Text></View>
        <View style={[s.card, { margin: 16, padding: 16, marginBottom: 12 }]}>
          <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 8, paddingHorizontal: 0 }]}>INGREDIENTS</Text>
          {selected.ingredients.map((ing, i) => {
            const ingName = typeof ing === "object" ? ing.item : ing;
            const ingAmount = typeof ing === "object" ? ing.amount : null;
            const have = itemNames.some(n => n.includes(ingName.toLowerCase().split(" ")[0]));
            return (
              <View key={i} style={[s.ingredientRow, i < selected.ingredients.length - 1 && { borderBottomWidth: 1, borderBottomColor: T.border }]}>
                <View style={[s.checkBox, { backgroundColor: have ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)", borderColor: have ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)" }]}><Text style={{ fontSize: 10, color: have ? T.accent : T.danger }}>{have ? "✓" : "✗"}</Text></View>
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
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(74,222,128,0.1)", borderWidth: 1, borderColor: "rgba(74,222,128,0.3)", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}><Text style={{ fontSize: 11, color: T.accent, fontWeight: "700" }}>{i + 1}</Text></View>
                <Text style={{ fontSize: 14, color: T.textSoft, lineHeight: 21, flex: 1 }}>{step}</Text>
              </View>
            ))}
          </View>
        )}
        {selected.tip && <View style={[s.card, { margin: 16, padding: 16, marginBottom: 12, backgroundColor: "rgba(74,222,128,0.06)", borderColor: "rgba(74,222,128,0.15)" }]}><Text style={[s.monoText, { color: T.accent, marginBottom: 6 }]}>💡 PRO TIP</Text><Text style={{ color: T.textSoft, fontSize: 13, lineHeight: 20 }}>{selected.tip}</Text></View>}
        <View style={{ height: 32 }} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}><View><Text style={s.pageTitle}>Recipes</Text><Text style={s.pageSubtitle}>Based on what's in your fridge</Text></View><View style={s.aiBadge}><Text style={s.aiBadgeText}>✦ AI</Text></View></View>
      <View style={{ paddingHorizontal: 16, marginBottom: 16 }}><TouchableOpacity style={s.btnPrimary} onPress={getAIRecipes} disabled={loading}><Text style={s.btnPrimaryText}>{loading ? "✦  AI is thinking..." : "✦  Generate AI Recipes"}</Text></TouchableOpacity></View>
      <View style={[s.card, { margin: 16, padding: 14, marginBottom: 16 }]}><Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 8, paddingHorizontal: 0 }]}>YOUR FRIDGE INGREDIENTS</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{items.map(i => <View key={i.id} style={s.pill}><Text style={s.pillText}>{i.emoji} {i.name.split(" ")[0]}</Text></View>)}</View></View>
      <Text style={s.sectionLabel}>// {recipes.length > 0 ? "AI GENERATED" : "SUGGESTED"} RECIPES</Text>
      {displayRecipes.map((recipe, i) => (
        <TouchableOpacity key={i} style={[s.card, { margin: 16, marginBottom: 12, padding: 16 }]} onPress={() => setSelected(recipe)}>
          <View style={{ flexDirection: "row", gap: 14 }}><View style={s.recipeEmojiBox}><Text style={{ fontSize: 28 }}>{recipe.emoji}</Text></View><View style={{ flex: 1 }}><Text style={[s.bold, { fontSize: 16 }]}>{recipe.name}</Text><Text style={{ color: T.textSoft, fontSize: 12, marginTop: 4 }}>⏱ {recipe.time}  ·  {recipe.difficulty}</Text><Text style={{ color: T.muted, fontSize: 12, marginTop: 6, lineHeight: 18 }} numberOfLines={2}>{recipe.description}</Text></View></View>
        </TouchableOpacity>
      ))}
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ─── Reminders Screen ─────────────────────────────────────────────────────────
function RemindersScreen({ items }) {
  const [dismissed, setDismissed] = useState([]);
  const autoReminders = items.filter(i => daysUntil(i.expiryDate) <= 3 && !dismissed.includes("auto-" + i.id)).map(i => ({ id: "auto-" + i.id, type: "toss", text: `Check ${i.name}`, detail: `Expires in ${Math.max(0, daysUntil(i.expiryDate))} day(s)`, time: formatDate(i.expiryDate), emoji: i.emoji, urgent: daysUntil(i.expiryDate) <= 1 }));
  const staticReminders = [{ id: "r1", type: "order", text: "Reorder Chicken Breast", detail: "Running low", time: "Friday 10:00 AM", emoji: "🛒", urgent: false }].filter(r => !dismissed.includes(r.id));
  const allReminders = [...autoReminders, ...staticReminders];
  const urgent = allReminders.filter(r => r.urgent);
  const normal = allReminders.filter(r => !r.urgent);

  function ReminderItem({ r }) {
    return (
      <View style={s.fridgeItem}>
        <View style={[s.reminderIcon, { backgroundColor: r.urgent ? "rgba(248,113,113,0.1)" : "rgba(251,146,60,0.1)" }]}><Text style={{ fontSize: 20 }}>{r.emoji}</Text></View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.bold}>{r.text}</Text>
          <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>{r.detail}</Text>
          <Text style={[s.monoText, { color: T.muted, fontSize: 10, marginTop: 4 }]}>🔔 {r.time}</Text>
        </View>
        <TouchableOpacity style={s.dismissBtn} onPress={() => setDismissed(d => [...d, r.id])}><Text style={{ color: T.accent, fontSize: 14 }}>✓</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}><View><Text style={s.pageTitle}>Reminders</Text><Text style={s.pageSubtitle}>{allReminders.length} active</Text></View></View>
      <View style={s.statsRow}>{[{ num: urgent.length, label: "Urgent", color: T.danger }, { num: allReminders.filter(r => r.type === "order").length, label: "Reorder", color: T.accent }, { num: allReminders.filter(r => r.type === "toss").length, label: "Toss", color: T.warn }].map(st => (<View key={st.label} style={s.statBox}><Text style={[s.statNum, { color: st.color }]}>{st.num}</Text><Text style={s.statLabel}>{st.label}</Text></View>))}</View>
      {urgent.length > 0 && <><Text style={s.sectionLabel}>// URGENT</Text>{urgent.map(r => <ReminderItem key={r.id} r={r} />)}</>}
      {normal.length > 0 && <><Text style={s.sectionLabel}>// UPCOMING</Text>{normal.map(r => <ReminderItem key={r.id} r={r} />)}</>}
      {allReminders.length === 0 && <View style={{ alignItems: "center", padding: 48 }}><Text style={{ fontSize: 48 }}>✅</Text><Text style={[s.bold, { fontSize: 18, marginTop: 12 }]}>All clear!</Text></View>}
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ─── Add Item Modal ───────────────────────────────────────────────────────────
function AddModal({ visible, onClose, onAdd }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Other");
  const [initialQty, setInitialQty] = useState("");
  const [initialUnit, setInitialUnit] = useState("");
  const categories = ["Dairy", "Protein", "Produce", "Dry Goods", "Beverages", "Other"];
  const emojiMap = { Dairy: "🥛", Protein: "🍗", Produce: "🥬", "Dry Goods": "🥣", Beverages: "🍶", Other: "📦" };

  function handleAdd() {
    if (!name.trim()) return;
    const qty = initialQty && initialUnit ? `${initialQty} ${initialUnit}` : initialQty || "1";
    onAdd({ name: name.trim(), category, emoji: emojiMap[category], quantity: qty, expiryDate: new Date(Date.now() + 7 * 86400000).toISOString() });
    setName(""); setInitialQty(""); setInitialUnit(""); onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.modalSheet}>
          <View style={s.sheetHandle} />
          <Text style={[s.bold, { fontSize: 20, marginBottom: 20 }]}>Add Item Manually</Text>
          <Text style={s.inputLabel}>Item name *</Text>
          <TextInput style={s.input} placeholder="e.g. Almond Butter" placeholderTextColor={T.muted} value={name} onChangeText={setName} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}><Text style={s.inputLabel}>Amount</Text><TextInput style={s.input} placeholder="e.g. 1" placeholderTextColor={T.muted} value={initialQty} onChangeText={setInitialQty} keyboardType="decimal-pad" /></View>
            <View style={{ flex: 1 }}><Text style={s.inputLabel}>Unit</Text><TextInput style={s.input} placeholder="e.g. gallon" placeholderTextColor={T.muted} value={initialUnit} onChangeText={setInitialUnit} autoCapitalize="none" /></View>
          </View>
          <Text style={[s.inputLabel, { marginTop: 4 }]}>Category</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {categories.map(c => (<TouchableOpacity key={c} onPress={() => setCategory(c)} style={[s.chip, category === c && s.chipActive]}><Text style={[s.chipText, category === c && s.chipTextActive]}>{emojiMap[c]} {c}</Text></TouchableOpacity>))}
          </View>
          <TouchableOpacity style={s.btnPrimary} onPress={handleAdd}><Text style={s.btnPrimaryText}>Add to Fridge</Text></TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState("fridge");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState("");
  const toastOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) loadItems();
    else setItems([]);
  }, [session]);

  async function loadItems() {
    try { setLoading(true); const rows = await dbGetItems(); setItems(rows.map(rowToItem)); }
    catch (e) { Alert.alert("Couldn't load fridge", "Check your internet connection."); }
    finally { setLoading(false); }
  }

  function showToast(msg) {
    setToast(msg);
    Animated.sequence([Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }), Animated.delay(2000), Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true })]).start();
  }

  async function handleScanned(product) {
    try {
      const saved = await dbAddItem({ name: product.name, category: product.category, emoji: product.emoji, quantity: 1, barcode: product.code, addedDate: new Date().toISOString(), expiryDate: new Date(Date.now() + product.defaultExpiry * 86400000).toISOString() });
      setItems(prev => [rowToItem(saved), ...prev]); showToast(`✅ ${product.name} added!`); setTimeout(() => setTab("fridge"), 1200);
    } catch (e) { Alert.alert("Couldn't save item", "Check your connection."); }
  }

  async function handleAddManual(data) {
    try { const saved = await dbAddItem(data); setItems(prev => [rowToItem(saved), ...prev]); showToast(`✅ ${data.name} added!`); }
    catch (e) { Alert.alert("Couldn't save item", "Check your connection."); }
  }

  async function handleUpdate(id, updates) {
    try {
      await dbUpdateItem(id, updates);
      setItems(prev => prev.map(i => i.id === id ? { ...i, name: updates.name || i.name, category: updates.category || i.category, emoji: updates.emoji || i.emoji, quantity: updates.quantity || i.quantity, expiryDate: updates.expiry_date || i.expiryDate } : i));
      showToast("✅ Item updated!");
    } catch (e) { Alert.alert("Couldn't update item", "Check your connection."); }
  }

  async function handleUse(id, newQty) {
    try {
      if (newQty === null) { await dbDeleteItem(id); setItems(prev => prev.filter(i => i.id !== id)); showToast("✅ Item fully used and removed!"); }
      else { await dbUpdateItem(id, { quantity: newQty }); setItems(prev => prev.map(i => i.id === id ? { ...i, quantity: newQty } : i)); showToast(`✅ Updated — ${newQty} remaining`); }
    } catch (e) { Alert.alert("Couldn't update item", "Check your connection."); }
  }

  async function handleDelete(id) {
    try { await dbDeleteItem(id); setItems(prev => prev.filter(i => i.id !== id)); showToast("🗑️ Item removed"); }
    catch (e) { Alert.alert("Couldn't delete item", "Check your connection."); }
  }

  async function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => supabase.auth.signOut() }
    ]);
  }

  if (authLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 48 }}>🧊</Text>
        <ActivityIndicator color={T.accent} style={{ marginTop: 20 }} />
      </SafeAreaView>
    );
  }

  if (!session) return <AuthScreen onAuth={setSession} />;

  const navItems = [{ id: "fridge", label: "Fridge", icon: "🧊" }, { id: "scan", label: "Add", icon: "📷" }, { id: "recipes", label: "Recipes", icon: "🍳" }, { id: "reminders", label: "Alerts", icon: "🔔" }];

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <View style={s.appBar}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={s.appLogo}><Text style={{ fontSize: 14 }}>🧊</Text></View>
          <Text style={s.appName}>FridgeAI</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ color: T.muted, fontSize: 11 }} numberOfLines={1}>{session.user.email?.split("@")[0]}</Text>
          <TouchableOpacity onPress={handleSignOut} style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: T.card, borderRadius: 8, borderWidth: 1, borderColor: T.border }}>
            <Text style={{ color: T.textSoft, fontSize: 11 }}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ flex: 1 }}>
        {tab === "fridge" && <FridgeScreen items={items} onDelete={handleDelete} onAdd={() => setShowAdd(true)} onUpdate={handleUpdate} onUse={handleUse} loading={loading} />}
        {tab === "scan" && <ScanScreen onScanned={handleScanned} />}
        {tab === "recipes" && <RecipesScreen items={items} />}
        {tab === "reminders" && <RemindersScreen items={items} />}
      </View>
      {toast !== "" && <Animated.View style={[s.toast, { opacity: toastOpacity }]}><Text style={s.toastText}>{toast}</Text></Animated.View>}
      <AddModal visible={showAdd} onClose={() => setShowAdd(false)} onAdd={handleAddManual} />
      <View style={s.navBar}>
        {navItems.map(n => (<TouchableOpacity key={n.id} style={s.navBtn} onPress={() => setTab(n.id)}><Text style={{ fontSize: 22 }}>{n.icon}</Text><Text style={[s.navLabel, tab === n.id && { color: T.accent }]}>{n.label}</Text></TouchableOpacity>))}
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg }, screen: { flex: 1, backgroundColor: T.bg },
  appBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border },
  appLogo: { width: 28, height: 28, backgroundColor: T.accent, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  appName: { fontWeight: "800", fontSize: 16, color: T.accent, letterSpacing: -0.3 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: 20, paddingBottom: 12 },
  pageTitle: { fontSize: 26, fontWeight: "800", color: T.text, letterSpacing: -0.5 },
  pageSubtitle: { color: T.textSoft, fontSize: 13, marginTop: 3 },
  addBtn: { backgroundColor: T.accent, borderRadius: 12, width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, marginBottom: 16 },
  statBox: { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 14, alignItems: "center" },
  statNum: { fontSize: 26, fontWeight: "800", lineHeight: 30 },
  statLabel: { fontSize: 10, color: T.textSoft, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  sectionLabel: { fontSize: 10, color: T.muted, letterSpacing: 1.5, textTransform: "uppercase", paddingHorizontal: 16, marginBottom: 10, marginTop: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: T.border, backgroundColor: T.card, marginRight: 8 },
  chipActive: { backgroundColor: "rgba(74,222,128,0.15)", borderColor: T.accent },
  chipText: { color: T.textSoft, fontSize: 12, fontWeight: "500" },
  chipTextActive: { color: T.accent },
  warnBanner: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 12, backgroundColor: "rgba(251,146,60,0.08)", borderWidth: 1, borderColor: "rgba(251,146,60,0.25)", borderRadius: 14, padding: 12 },
  fridgeItem: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 10, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 14 },
  resultItem: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 8, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 14 },
  itemName: { fontSize: 15, fontWeight: "600", color: T.text },
  itemMeta: { fontSize: 12, color: T.textSoft, marginTop: 2 },
  expiryBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  expiryText: { fontSize: 11, fontWeight: "600" },
  card: { backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 16 },
  bold: { fontWeight: "700", color: T.text },
  monoText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11, letterSpacing: 0.5 },
  inputLabel: { fontSize: 12, color: T.textSoft, marginBottom: 6, fontWeight: "500" },
  input: { backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 12, padding: 13, color: T.text, fontSize: 15, marginBottom: 10 },
  btnPrimary: { backgroundColor: T.accent, borderRadius: 14, padding: 15, alignItems: "center", marginBottom: 0 },
  btnPrimaryText: { color: T.bg, fontSize: 15, fontWeight: "700" },
  btnSecondary: { backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 14, alignItems: "center" },
  btnSecondaryText: { color: T.text, fontSize: 15, fontWeight: "600" },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: "rgba(74,222,128,0.1)", borderWidth: 1, borderColor: "rgba(74,222,128,0.2)" },
  pillText: { fontSize: 12, color: T.accent, fontWeight: "500" },
  recipeEmojiBox: { width: 56, height: 56, backgroundColor: "rgba(74,222,128,0.1)", borderWidth: 1, borderColor: "rgba(74,222,128,0.2)", borderRadius: 14, alignItems: "center", justifyContent: "center" },
  backBtn: { padding: 16, paddingBottom: 0 },
  ingredientRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  checkBox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  aiBadge: { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "rgba(74,222,128,0.1)", borderWidth: 1, borderColor: "rgba(74,222,128,0.2)", borderRadius: 8 },
  aiBadgeText: { fontSize: 10, color: T.accent, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  reminderIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  urgentBadge: { paddingHorizontal: 8, paddingVertical: 2, backgroundColor: "rgba(248,113,113,0.1)", borderWidth: 1, borderColor: "rgba(248,113,113,0.2)", borderRadius: 4 },
  urgentText: { fontSize: 10, color: T.danger, fontWeight: "600", letterSpacing: 0.5 },
  dismissBtn: { width: 32, height: 32, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  navBar: { flexDirection: "row", backgroundColor: T.surface, borderTopWidth: 1, borderTopColor: T.border, paddingBottom: Platform.OS === "ios" ? 20 : 8, paddingTop: 8 },
  navBtn: { flex: 1, alignItems: "center", gap: 3 },
  navLabel: { fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: "500" },
  toast: { position: "absolute", bottom: 100, left: 16, right: 16, backgroundColor: T.accent, borderRadius: 14, padding: 14 },
  toastText: { color: T.bg, fontWeight: "700", fontSize: 14, textAlign: "center" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: T.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 48, borderWidth: 1, borderColor: T.border },
  sheetHandle: { width: 36, height: 4, backgroundColor: T.border, borderRadius: 99, alignSelf: "center", marginBottom: 20 },
  modeToggle: { flexDirection: "row", marginHorizontal: 16, marginBottom: 16, backgroundColor: T.card, borderRadius: 12, borderWidth: 1, borderColor: T.border, padding: 4, gap: 4 },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  modeBtnActive: { backgroundColor: T.accent },
  modeBtnText: { fontSize: 13, fontWeight: "600", color: T.textSoft },
  modeBtnTextActive: { color: T.bg },
  errorBox: { marginHorizontal: 16, marginBottom: 12, backgroundColor: "rgba(248,113,113,0.08)", borderWidth: 1, borderColor: "rgba(248,113,113,0.25)", borderRadius: 12, padding: 12 },
  cameraBigBtn: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 16, backgroundColor: T.accent, borderRadius: 16, padding: 18 },
});
