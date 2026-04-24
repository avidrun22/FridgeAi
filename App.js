import { useState, useEffect, useRef } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, SafeAreaView, StatusBar, Modal, Alert,
  Animated, Platform, ActivityIndicator, AppState, KeyboardAvoidingView,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Linking, Share } from "react-native";
import { MaterialIcons, Ionicons } from "@expo/vector-icons";
import * as AppleAuthentication from "expo-apple-authentication";
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as ImagePicker from "expo-image-picker";
import PostHog from "posthog-react-native";
import { Picker } from "@react-native-picker/picker";

// ─── Analytics ───────────────────────────────────────────────────────────────
const posthog = new PostHog("phc_szxhjw2eQmYYhNGicX3kmNXxdz47Sj7evqx5Quqw8dTY", { host: "https://app.posthog.com" });

function track(event, properties) {
  try { posthog.capture(event, properties); } catch (e) { /* analytics should never crash the app */ }
}

function identifyUser(userId) {
  try { posthog.identify(userId); } catch (e) { /* noop */ }
}

function resetAnalytics() {
  try { posthog.reset(); } catch (e) { /* noop */ }
}

// ─── Notification Setup ───────────────────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function requestNotificationPermission() {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

async function scheduleExpiryNotification(item, daysUntilExpiry) {
  const triggerDate = new Date();
  triggerDate.setSeconds(triggerDate.getSeconds() + 5); // small delay for immediate

  if (daysUntilExpiry <= 0) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "⚠️ Item Expired",
        body: `${item.name} has expired — time to toss it!`,
        data: { itemId: item.id },
      },
      trigger: { type: "timeInterval", seconds: 2, repeats: false },
    });
  } else if (daysUntilExpiry <= 1) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "🚨 Expires Today!",
        body: `${item.name} expires today — use it now!`,
        data: { itemId: item.id },
      },
      trigger: { type: "timeInterval", seconds: 2, repeats: false },
    });
  } else if (daysUntilExpiry <= 3) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "⏰ Expiring Soon",
        body: `${item.name} expires in ${daysUntilExpiry} days.`,
        data: { itemId: item.id },
      },
      trigger: { type: "timeInterval", seconds: 2, repeats: false },
    });
  }
}

async function scheduleDailyReminder() {
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "🧊 ok2eat Daily Check",
      body: "Open the app to check what's expiring soon!",
    },
    trigger: { type: "daily", hour: 9, minute: 0 },
  });
}

async function checkAndNotifyExpiring(items) {
  try {
    // Load already-notified item IDs from storage
    const stored = await AsyncStorage.getItem("notified_items");
    const notifiedMap = stored ? JSON.parse(stored) : {};
    const today = new Date().toDateString();
    const updated = { ...notifiedMap };
    let changed = false;

    for (const item of items) {
      const days = Math.ceil((new Date(item.expiryDate).getTime() - Date.now()) / 86400000);
      const key = `${item.id}_${today}`;
      // Only notify if expiring within 3 days AND not already notified today
      if (days <= 3 && days >= 0 && !notifiedMap[key]) {
        await scheduleExpiryNotification(item, days);
        updated[key] = true;
        changed = true;
      }
    }

    // Clean up old keys (older than 7 days)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    for (const key of Object.keys(updated)) {
      const parts = key.split("_");
      const dateStr = parts.slice(1).join("_");
      if (new Date(dateStr) < cutoff) delete updated[key];
    }

    if (changed) await AsyncStorage.setItem("notified_items", JSON.stringify(updated));
  } catch (e) {
    console.log("Notification tracking error:", e);
  }
}

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
    user_id: user.id, section: item.section || "fridge",
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
  return { id: row.id, name: row.name, category: row.category, emoji: row.emoji, quantity: row.quantity, addedDate: row.added_date, expiryDate: row.expiry_date, barcode: row.barcode, section: row.section || "fridge" };
}

// ─── Open Food Facts ──────────────────────────────────────────────────────────
const CATEGORY_MAP = { "beverages": "Beverages", "dairies": "Dairy", "dairy": "Dairy", "cheeses": "Dairy", "milks": "Dairy", "yogurts": "Dairy", "meats": "Protein", "poultry": "Protein", "seafood": "Protein", "eggs": "Protein", "fish": "Protein", "fruits": "Produce", "vegetables": "Produce", "fresh": "Produce", "breads": "Dry Goods", "cereals": "Dry Goods", "snacks": "Dry Goods", "pasta": "Dry Goods" };
const EMOJI_MAP = { "Dairy": "🧀", "Protein": "🍗", "Produce": "🥬", "Dry Goods": "🥣", "Beverages": "🍶", "Other": "📦" };
const EXPIRY_MAP = { "Dairy": 14, "Protein": 3, "Produce": 5, "Dry Goods": 180, "Beverages": 7, "Other": 7 };
function categorize(tags) { if (!tags) return "Other"; const joined = tags.join(" ").toLowerCase(); for (const [key, val] of Object.entries(CATEGORY_MAP)) { if (joined.includes(key)) return val; } return "Other"; }

const GUESS_MAP = {
  Dairy: ["milk", "cheese", "yogurt", "butter", "cream", "cottage", "mozzarella", "cheddar", "parmesan", "brie"],
  Protein: ["chicken", "beef", "pork", "fish", "salmon", "shrimp", "turkey", "egg", "tofu", "steak", "bacon", "sausage", "ham", "lamb", "tuna", "crab"],
  Produce: ["apple", "banana", "lettuce", "tomato", "onion", "carrot", "potato", "avocado", "pepper", "spinach", "broccoli", "celery", "cucumber", "garlic", "lemon", "lime", "orange", "grape", "berry", "strawberry", "blueberry", "mango", "mushroom", "kale", "corn", "zucchini", "peach", "pear", "melon", "watermelon", "cilantro", "basil", "ginger"],
  "Dry Goods": ["bread", "pasta", "rice", "cereal", "oat", "flour", "sugar", "cracker", "chip", "granola", "nut", "bean", "tortilla", "bagel"],
  Beverages: ["juice", "soda", "water", "coffee", "tea", "beer", "wine", "kombucha", "smoothie", "lemonade"],
};
function guessCategory(name) {
  const n = name.toLowerCase();
  for (const [cat, keywords] of Object.entries(GUESS_MAP)) {
    if (keywords.some(k => n.includes(k))) return cat;
  }
  return "Other";
}

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
const T = { bg: "#F7FAF7", surface: "#FFFFFF", card: "#FFFFFF", accent: "#16A34A", warn: "#EA580C", danger: "#DC2626", muted: "#9CA3AF", text: "#111827", textSoft: "#6B7280", border: "#E5E7EB" };
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
      <View style={{ backgroundColor: "rgba(22,163,74,0.08)", padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: T.border }}>
        <View>
          <Text style={[s.bold, { fontSize: 14, letterSpacing: 0.5 }]}>NUTRITION FACTS</Text>
          <Text style={{ color: T.textSoft, fontSize: 11, marginTop: 2 }}>Per serving · {nutrition.serving}</Text>
        </View>
        {grade && (
          <View style={{ backgroundColor: nutriColor(grade), borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, alignItems: "center" }}>
            <Text style={{ color: "#0A0F0A", fontSize: 10, fontWeight: "700" }}>NUTRI</Text>
            <Text style={{ color: "#0A0F0A", fontSize: 20, fontWeight: "800", lineHeight: 24 }}>{grade.toUpperCase()}</Text>
          </View>
        )}
      </View>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 9, paddingHorizontal: 14, borderBottomWidth: i < rows.length - 1 ? 1 : 0, borderBottomColor: T.border }}>
          <Text style={{ fontSize: 13, color: row.indent ? T.textSoft : T.text, marginLeft: row.indent ? 16 : 0, fontWeight: row.indent ? "400" : "600" }}>{row.label}</Text>
          <Text style={{ fontSize: 13, color: T.accent, fontWeight: "600", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}>{round1(row.value)}{row.unit}</Text>
        </View>
      ))}
      <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: T.border }}>
        <Text style={{ fontSize: 10, color: T.muted }}>Source: <Text style={{ color: T.accent, textDecorationLine: "underline" }} onPress={() => require("react-native").Linking.openURL("https://world.openfoodfacts.org")}>Open Food Facts</Text> · Licensed under ODbL</Text>
      </View>
    </View>
  );
}

// ─── Use Item Modal ───────────────────────────────────────────────────────────
function UseItemModal({ item, visible, onClose, onUse }) {
  const [amount, setAmount] = useState("1");
  const [selectedUnit, setSelectedUnit] = useState("tbsp");
  const [expandedGroup, setExpandedGroup] = useState("Volume");

  useEffect(() => {
    if (visible) { setAmount("1"); setSelectedUnit("tbsp"); setExpandedGroup("Volume"); }
  }, [visible]);

  if (!item) return null;

  const currentQtyText = item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : "1";
  const currentQtyNum = parseFloat(currentQtyText) || 1;
  const currentUnit = currentQtyText.replace(/[\d.]/g, "").trim() || null;

  function getNewQuantity() {
    const used = parseFloat(amount) || 0;
    if (used <= 0) return currentQtyText;
    if (currentUnit && selectedUnit === currentUnit) {
      const remaining = Math.max(0, currentQtyNum - used);
      return remaining <= 0.01 ? null : `${round1(remaining)} ${selectedUnit}`;
    }
    if (FRACTION_MAP[selectedUnit]) {
      const fraction = FRACTION_MAP[selectedUnit];
      const remaining = Math.max(0, currentQtyNum - fraction * currentQtyNum);
      return remaining <= 0.01 ? null : `${round1(remaining)} ${currentUnit || "units"}`;
    }
    return `${currentQtyText} (used ${amount} ${selectedUnit})`;
  }

  function handleUse() {
    const used = parseFloat(amount) || 0;
    if (used <= 0) { Alert.alert("Enter an amount", "Please enter how much you used."); return; }
    const newQty = getNewQuantity();
    if (newQty === null) {
      Alert.alert("Item Fully Used", `Remove ${item.name} from your fridge?`, [
        { text: "Keep it", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => onUse(item.id, null) }
      ]);
    } else {
      onUse(item.id, newQty);
    }
  }

  const preview = getNewQuantity();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[s.modalSheet, { maxHeight: "85%" }]}>
          <View style={s.sheetHandle} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <Text style={{ fontSize: 36 }}>{item.emoji}</Text>
            <View>
              <Text style={[s.bold, { fontSize: 18 }]}>Use Item</Text>
              <Text style={{ color: T.textSoft, fontSize: 13 }}>{item.name}</Text>
            </View>
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
                      <TouchableOpacity key={unit} onPress={() => setSelectedUnit(unit)} style={[{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 }, selectedUnit === unit ? { backgroundColor: "rgba(22,163,74,0.15)", borderColor: T.accent } : { backgroundColor: T.card, borderColor: T.border }]}>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: selectedUnit === unit ? T.accent : T.textSoft }}>{unit}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
          {amount && parseFloat(amount) > 0 && (
            <View style={{ backgroundColor: "rgba(22,163,74,0.08)", borderRadius: 12, padding: 12, marginTop: 12, borderWidth: 1, borderColor: "rgba(22,163,74,0.2)" }}>
              <Text style={{ color: T.textSoft, fontSize: 12, marginBottom: 4 }}>Remaining after use</Text>
              <Text style={[s.bold, { color: T.accent, fontSize: 16 }]}>{preview === null ? "🗑 Item will be removed" : preview}</Text>
            </View>
          )}
          <TouchableOpacity style={[s.btnPrimary, { marginTop: 16 }]} onPress={handleUse}>
            <Text style={s.btnPrimaryText}>✅  Confirm Usage</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Reorder Sheet ──────────────────────────────────────────────────────────
const RETAILERS = [
  { id: "amazon", label: "Amazon", color: "#FF9900", url: (name) => `https://www.amazon.com/s?k=${encodeURIComponent(name)}&tag=ok2eat-20` },
  { id: "target", label: "Target", color: "#CC0000", url: (name) => `https://www.target.com/s?searchTerm=${encodeURIComponent(name)}&afid=ok2eat` },
  { id: "walmart", label: "Walmart", color: "#0071CE", url: (name) => `https://www.walmart.com/search?q=${encodeURIComponent(name)}&affiliates_id=ok2eat` },
];

function ReorderSheet({ item, visible, onClose }) {
  if (!item) return null;
  function handleOpen(retailer) {
    Linking.openURL(retailer.url(item.name));
    track("reorder_tapped", { retailer: retailer.id, item_category: item.category });
    onClose();
  }
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.modalSheet}>
          <View style={s.sheetHandle} />
          <Text style={[s.bold, { fontSize: 18, marginBottom: 4 }]}>Reorder {item.name}</Text>
          <Text style={{ color: T.textSoft, fontSize: 13, marginBottom: 20 }}>Choose a retailer to reorder</Text>
          {RETAILERS.map(r => (
            <TouchableOpacity key={r.id} onPress={() => handleOpen(r)} style={{ flexDirection: "row", alignItems: "center", padding: 14, marginBottom: 8, backgroundColor: r.color + "0D", borderWidth: 1, borderColor: r.color + "33", borderRadius: 14, gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: r.color + "1A", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: r.color }}>{r.label.charAt(0)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.bold, { fontSize: 15, color: r.color }]}>{r.label}</Text>
                <Text style={{ color: T.textSoft, fontSize: 11, marginTop: 1 }}>Search for "{item.name}"</Text>
              </View>
              <Text style={{ color: r.color, fontSize: 16 }}>›</Text>
            </TouchableOpacity>
          ))}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function needsReorder(item) {
  const qtyNum = parseFloat(String(item.quantity)) || 0;
  const days = daysUntil(item.expiryDate);
  return qtyNum <= 1 || days <= 7;
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
  const [showReorder, setShowReorder] = useState(false);

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
              <TouchableOpacity style={{ backgroundColor: "rgba(22,163,74,0.12)", borderWidth: 1.5, borderColor: T.accent, borderRadius: 14, padding: 16, marginBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }} onPress={() => { onClose(); setTimeout(() => onShowUse(item), 350); }}>
                <Text style={{ fontSize: 20 }}>🍽</Text>
                <View><Text style={[s.bold, { color: T.accent, fontSize: 15 }]}>Use Item</Text><Text style={{ color: T.textSoft, fontSize: 12, marginTop: 1 }}>Track how much you used</Text></View>
              </TouchableOpacity>
            )}
            {!editing && needsReorder(item) && (
              <TouchableOpacity style={{ backgroundColor: "rgba(255,153,0,0.08)", borderWidth: 1.5, borderColor: "rgba(255,153,0,0.3)", borderRadius: 14, padding: 16, marginBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }} onPress={() => setShowReorder(true)}>
                <Text style={{ fontSize: 20 }}>🛒</Text>
                <View><Text style={[s.bold, { color: "#FF9900", fontSize: 15 }]}>Reorder</Text><Text style={{ color: T.textSoft, fontSize: 12, marginTop: 1 }}>{daysUntil(item.expiryDate) <= 7 ? "Expiring soon — restock" : "Running low — restock"}</Text></View>
              </TouchableOpacity>
            )}
            <View style={[s.card, { padding: 16, marginBottom: 12 }]}>
              <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 12, paddingHorizontal: 0 }]}>DETAILS</Text>
              <View style={{ marginBottom: 12 }}>
                <Text style={s.inputLabel}>Category</Text>
                {editing ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{categories.map(c => (<TouchableOpacity key={c} onPress={() => setCategory(c)} style={[s.chip, category === c && s.chipActive, { marginRight: 0 }]}><Text style={[s.chipText, category === c && s.chipTextActive]}>{c}</Text></TouchableOpacity>))}</View> : <Text style={{ color: T.text, fontSize: 15 }}>{item.category}</Text>}
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.inputLabel}>Amount</Text>
                  {editing ? <TextInput style={s.input} value={quantity} onChangeText={setQuantity} placeholder="e.g. 1 gallon" placeholderTextColor={T.muted} /> : <Text style={{ color: T.text, fontSize: 15 }}>{item.quantity}</Text>}
                </View>
                <View style={{ flex: 2 }}>
                  <Text style={s.inputLabel}>Expiry Date</Text>
                  {editing ? <TextInput style={s.input} value={expiryDate} onChangeText={setExpiryDate} placeholder="YYYY-MM-DD" placeholderTextColor={T.muted} /> : <Text style={{ color: T.text, fontSize: 15 }}>{formatDate(item.expiryDate)}</Text>}
                </View>
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
        <ReorderSheet item={item} visible={showReorder} onClose={() => setShowReorder(false)} />
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
        <TouchableOpacity onPress={requestPermission} style={{ backgroundColor: T.accent, borderRadius: 12, padding: 14, paddingHorizontal: 28, marginBottom: 16 }}><Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 15 }}>Continue</Text></TouchableOpacity>
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

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleAppleSignIn() {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const { error, data } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
      });
      if (error) throw error;
      if (data?.user) { identifyUser(data.user.id); track("user_signed_in", { method: "apple" }); }
    } catch (e) {
      if (e.code !== "ERR_REQUEST_CANCELED") {
        Alert.alert("Sign in failed", e.message || "Something went wrong.");
      }
    }
  }

  async function handleAuth() {
    if (!email.trim() || !password.trim()) { setError("Please enter your email and password."); return; }
    setLoading(true); setError("");
    try {
      if (mode === "login") {
        const { error, data } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        if (data?.user) { identifyUser(data.user.id); track("user_signed_in", { method: "email" }); }
      } else {
        const { error, data } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (data?.user) { identifyUser(data.user.id); track("user_signed_up", { method: "email" }); }
        Alert.alert("Account created!", "You can now sign in with your email and password.");
        setMode("login");
      }
    } catch (e) { setError(e.message || "Something went wrong. Please try again."); }
    setLoading(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={T.bg} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: "center", marginBottom: 40 }}>
            <View style={[s.appLogo, { width: 72, height: 72, borderRadius: 20, marginBottom: 16 }]}>
              <Text style={{ fontSize: 36 }}>🧊</Text>
            </View>
            <Text style={{ fontSize: 32, fontWeight: "800", color: T.accent, letterSpacing: -1 }}>ok2eat</Text>
            <Text style={{ color: T.textSoft, fontSize: 15, marginTop: 6, textAlign: "center" }}>know before you throw</Text>
          </View>
          <View style={[s.card, { padding: 24, marginBottom: 16 }]}>
            <View style={[s.modeToggle, { marginBottom: 20, marginHorizontal: 0 }]}>
              <TouchableOpacity style={[s.modeBtn, mode === "login" && s.modeBtnActive]} onPress={() => { setMode("login"); setError(""); }}>
                <Text style={[s.modeBtnText, mode === "login" && s.modeBtnTextActive]}>Sign In</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modeBtn, mode === "signup" && s.modeBtnActive]} onPress={() => { setMode("signup"); setError(""); }}>
                <Text style={[s.modeBtnText, mode === "signup" && s.modeBtnTextActive]}>Create Account</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.inputLabel}>Email</Text>
            <TextInput style={s.input} placeholder="you@example.com" placeholderTextColor={T.muted} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
            <Text style={s.inputLabel}>Password</Text>
            <TextInput style={s.input} placeholder="••••••••" placeholderTextColor={T.muted} value={password} onChangeText={setPassword} secureTextEntry />
            {error !== "" && <View style={[s.errorBox, { marginBottom: 12 }]}><Text style={{ color: T.danger, fontSize: 13 }}>{error}</Text></View>}
            <TouchableOpacity style={s.btnPrimary} onPress={handleAuth} disabled={loading}>
              {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.btnPrimaryText}>{mode === "login" ? "Sign In" : "Create Account"}</Text>}
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 16 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
            <Text style={{ color: T.muted, fontSize: 12 }}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
          </View>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={14}
            style={{ width: "100%", height: 50 }}
            onPress={handleAppleSignIn}
          />
          <Text style={{ color: T.muted, fontSize: 12, textAlign: "center", lineHeight: 18, marginTop: 16 }}>
            {"Your fridge is private - only you can see your items. By continuing you agree to our privacy policy at ok2eat.com"}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Fridge Screen ────────────────────────────────────────────────────────────
function FridgeScreen({ items, onDelete, onAdd, onUpdate, onUse, loading }) {
  const [filter, setFilter] = useState("All");
  const [selectedItem, setSelectedItem] = useState(null);
  const [useItem, setUseItem] = useState(null);
  const [activeSection, setActiveSection] = useState("fridge");
  const [sections, setSections] = useState([
    { id: "fridge", label: "My Fridge", icon: "kitchen" },
    { id: "cupboard", label: "Cupboard", icon: "shelves" },
  ]);
  const [editingSection, setEditingSection] = useState(null);
  const [editLabel, setEditLabel] = useState("");
  const categories = ["All", "Dairy", "Protein", "Produce", "Dry Goods", "Beverages"];
  const sectionItems = items.filter(i => (i.section || "fridge") === activeSection);
  const filtered = filter === "All" ? sectionItems : filter === "expiring" ? sectionItems.filter(i => daysUntil(i.expiryDate) <= 3) : sectionItems.filter(i => i.category === filter);
  const expiringSoon = sectionItems.filter(i => daysUntil(i.expiryDate) <= 3).length;

  function addSection() {
    const newId = "section_" + Date.now();
    setSections(prev => [...prev, { id: newId, label: "", icon: "inventory-2" }]);
    setActiveSection(newId);
    setEditingSection(newId);
    setEditLabel("");
    track("section_added");
  }

  function renameSection(id, newLabel) {
    setSections(prev => prev.map(s => s.id === id ? { ...s, label: newLabel } : s));
    setEditingSection(null);
  }

  function deleteSection(id) {
    if (sections.length <= 1) return;
    setSections(prev => prev.filter(s => s.id !== id));
    setActiveSection("fridge");
  }

  return (
    <>
      <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
        <View style={s.headerRow}>
          <View>
            <Text style={s.pageTitle}>{sections.find(s => s.id === activeSection)?.label || "My Fridge"}</Text>
            <Text style={s.pageSubtitle}>{loading ? "Loading..." : `${sectionItems.length} items tracked`}</Text>
          </View>
        </View>
        {/* Storage Section Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 16, marginBottom: 12 }}>
          {sections.map(sec => (
            <TouchableOpacity
              key={sec.id}
              onPress={() => { setActiveSection(sec.id); setFilter("All"); }}
              onLongPress={() => { setEditingSection(sec.id); setEditLabel(sec.label); }}
              style={{
                flexDirection: "row", alignItems: "center", gap: 6,
                paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, marginRight: 8,
                backgroundColor: activeSection === sec.id ? T.accent : T.card,
                borderWidth: 1, borderColor: activeSection === sec.id ? T.accent : T.border,
              }}
            >
              <MaterialIcons name={sec.icon} size={16} color={activeSection === sec.id ? "#fff" : T.textSoft} />
              <Text style={{ fontSize: 13, fontWeight: "600", color: activeSection === sec.id ? "#fff" : T.textSoft }}>{sec.label || "Name it..."}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={addSection}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, marginRight: 8, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderStyle: "dashed" }}
          >
            <MaterialIcons name="add" size={16} color={T.muted} />
            <Text style={{ fontSize: 13, fontWeight: "600", color: T.muted }}>Add Storage</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Edit section name modal */}
        {editingSection && (
          <View style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: T.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: T.border }}>
            <Text style={[s.inputLabel, { marginBottom: 8 }]}>Rename "{sections.find(s => s.id === editingSection)?.label}"</Text>
            <TextInput style={[s.input, { marginBottom: 10 }]} value={editLabel} onChangeText={setEditLabel} autoFocus placeholder="e.g. Pantry, Freezer, Garage..." placeholderTextColor={T.muted} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity style={[s.btnPrimary, { flex: 1 }]} onPress={() => renameSection(editingSection, editLabel)}>
                <Text style={s.btnPrimaryText}>Save</Text>
              </TouchableOpacity>
              {editingSection !== "fridge" && (
                <TouchableOpacity style={[s.btnSecondary, { flex: 1, borderColor: T.danger + "55" }]} onPress={() => { deleteSection(editingSection); setEditingSection(null); }}>
                  <Text style={{ color: T.danger, fontWeight: "600" }}>Delete</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={() => setEditingSection(null)}>
                <Text style={s.btnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={s.statsRow}>
          <TouchableOpacity style={s.statBox} onPress={() => setFilter("All")}>
            <Text style={[s.statNum, { color: T.accent }]}>{items.length}</Text>
            <Text style={s.statLabel}>Total Items</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.statBox, filter === "expiring" && { borderColor: T.warn, borderWidth: 2 }]} onPress={() => setFilter(filter === "expiring" ? "All" : "expiring")}>
            <Text style={[s.statNum, { color: expiringSoon > 0 ? T.warn : T.accent }]}>{expiringSoon}</Text>
            <Text style={s.statLabel}>Expiring Soon</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.statBox} onPress={() => setFilter("All")}>
            <Text style={[s.statNum, { color: T.accent }]}>{[...new Set(items.map(i => i.category))].length}</Text>
            <Text style={s.statLabel}>Categories</Text>
          </TouchableOpacity>
        </View>
        <View style={{ marginHorizontal: 16, marginBottom: 16, borderWidth: 1, borderColor: T.border, borderRadius: 12, backgroundColor: T.card, overflow: "hidden" }}>
          <Picker selectedValue={filter} onValueChange={v => setFilter(v)} style={{ color: T.text }} itemStyle={{ fontSize: 15 }}>
            {categories.map(c => <Picker.Item key={c} label={c === "All" ? "All Categories" : c} value={c} />)}
          </Picker>
        </View>
        {expiringSoon > 0 && <View style={s.warnBanner}><Text style={{ fontSize: 18 }}>⚠️</Text><View style={{ marginLeft: 10 }}><Text style={[s.bold, { color: T.warn }]}>Heads up!</Text><Text style={{ color: T.textSoft, fontSize: 12 }}>{expiringSoon} item{expiringSoon > 1 ? "s" : ""} expiring within 3 days</Text></View></View>}
        {loading ? (
          <View style={{ alignItems: "center", padding: 48 }}><ActivityIndicator color={T.accent} size="large" /><Text style={{ color: T.textSoft, marginTop: 12 }}>Loading your fridge...</Text></View>
        ) : (
          <>
            <Text style={s.sectionLabel}>{filter === "expiring" ? "// EXPIRING SOON" : "// CONTENTS · TAP TO VIEW DETAILS"}</Text>
            {filtered.length === 0 && <View style={{ alignItems: "center", padding: 48 }}><Text style={{ fontSize: 48 }}>🧊</Text><Text style={[s.bold, { fontSize: 18, marginTop: 12 }]}>Your fridge is empty!</Text><Text style={{ color: T.textSoft, fontSize: 14, marginTop: 6 }}>Tap + to add your first item.</Text></View>}
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
      <TouchableOpacity style={{ position: "absolute", bottom: 24, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: T.accent, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 8 }} onPress={() => onAdd(activeSection)}>
        <Text style={{ color: "#FFFFFF", fontSize: 28, lineHeight: 32 }}>+</Text>
      </TouchableOpacity>
    </>
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
    try {
      const product = await lookupBarcode(code);
      if (product) { setResults([product]); setSelected(product); }
      else setError(`Barcode ${code} not found. Try searching by name.`);
    } catch (e) { setError("Couldn't look up barcode. Check your connection."); }
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
        {cameraLooking ? <><ActivityIndicator color={T.bg} /><View style={{ marginLeft: 14 }}><Text style={[s.bold, { fontSize: 16, color: "#FFFFFF" }]}>Looking up product...</Text></View></> : <><Text style={{ fontSize: 32 }}>📷</Text><View style={{ marginLeft: 14 }}><Text style={[s.bold, { fontSize: 16, color: "#FFFFFF" }]}>Scan Barcode</Text><Text style={{ fontSize: 12, color: "#FFFFFF", opacity: 0.7, marginTop: 2 }}>Point camera at any grocery barcode</Text></View></>}
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
        <>
          <Text style={s.sectionLabel}>// {results.length} RESULT{results.length !== 1 ? "S" : ""} FOUND</Text>
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
        <>
          <Text style={s.sectionLabel}>// TRY SEARCHING FOR</Text>
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        Alert.alert("Sign in needed", "Please sign in to generate AI recipes.");
        setLoading(false);
        return;
      }
      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-recipes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ items: items.map(i => i.name) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) {
          Alert.alert("Daily limit reached", data?.error || "Try again tomorrow.");
        } else {
          Alert.alert("Couldn't load AI recipes", data?.error || `HTTP ${res.status}`);
        }
        setLoading(false);
        return;
      }
      const parsed = Array.isArray(data.recipes) ? data.recipes : [];
      setRecipes(parsed);
      track("recipe_generated", { count: parsed.length });
    } catch (e) {
      Alert.alert("Couldn't load AI recipes", "Check your connection.");
    }
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
                <View style={[s.checkBox, { backgroundColor: have ? "rgba(22,163,74,0.1)" : "rgba(220,38,38,0.1)", borderColor: have ? "rgba(22,163,74,0.3)" : "rgba(220,38,38,0.3)" }]}><Text style={{ fontSize: 10, color: have ? T.accent : T.danger }}>{have ? "✓" : "✗"}</Text></View>
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
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(22,163,74,0.1)", borderWidth: 1, borderColor: "rgba(22,163,74,0.3)", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}><Text style={{ fontSize: 11, color: T.accent, fontWeight: "700" }}>{i + 1}</Text></View>
                <Text style={{ fontSize: 14, color: T.textSoft, lineHeight: 21, flex: 1 }}>{step}</Text>
              </View>
            ))}
          </View>
        )}
        {selected.tip && <View style={[s.card, { margin: 16, padding: 16, marginBottom: 12, backgroundColor: "rgba(22,163,74,0.06)", borderColor: "rgba(22,163,74,0.15)" }]}><Text style={[s.monoText, { color: T.accent, marginBottom: 6 }]}>💡 PRO TIP</Text><Text style={{ color: T.textSoft, fontSize: 13, lineHeight: 20 }}>{selected.tip}</Text></View>}
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
function RemindersScreen({ items, notificationsEnabled, onToggleNotifications, onTestNotification }) {
  const [dismissed, setDismissed] = useState([]);
  const [reorderItem, setReorderItem] = useState(null);
  const autoReminders = items.filter(i => daysUntil(i.expiryDate) <= 3 && !dismissed.includes("auto-" + i.id)).map(i => ({ id: "auto-" + i.id, type: "toss", text: `Check ${i.name}`, detail: `Expires in ${Math.max(0, daysUntil(i.expiryDate))} day(s)`, time: formatDate(i.expiryDate), emoji: i.emoji, urgent: daysUntil(i.expiryDate) <= 1 }));
  const staticReminders = [{ id: "r1", type: "order", text: "Reorder Chicken Breast", detail: "Running low", time: "Friday 10:00 AM", emoji: "🛒", urgent: false }].filter(r => !dismissed.includes(r.id));
  const allReminders = [...autoReminders, ...staticReminders];
  const urgent = allReminders.filter(r => r.urgent);
  const normal = allReminders.filter(r => !r.urgent);

  function ReminderItem({ r }) {
    return (
      <View style={s.fridgeItem}>
        <View style={[s.reminderIcon, { backgroundColor: r.urgent ? "rgba(220,38,38,0.1)" : "rgba(234,88,12,0.1)" }]}><Text style={{ fontSize: 20 }}>{r.emoji}</Text></View>
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

      {/* Notification Settings Card */}
      <View style={[s.card, { margin: 16, padding: 16, marginBottom: 12 }]}>
        <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 12, paddingHorizontal: 0 }]}>PUSH NOTIFICATIONS</Text>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={[s.bold, { fontSize: 14 }]}>Daily Check Reminder</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Reminds you to check your fridge every morning at 9am</Text>
          </View>
          <TouchableOpacity
            onPress={onToggleNotifications}
            style={{ width: 50, height: 28, borderRadius: 14, backgroundColor: notificationsEnabled ? T.accent : T.border, justifyContent: "center", padding: 3, marginLeft: 12 }}
          >
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: notificationsEnabled ? "flex-end" : "flex-start" }} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[s.btnSecondary, { marginBottom: 0 }]}
          onPress={onTestNotification}
        >
          <Text style={s.btnSecondaryText}>🔔  Send Test Notification</Text>
        </TouchableOpacity>
      </View>

      <View style={s.statsRow}>{[{ num: urgent.length, label: "Urgent", color: T.danger }, { num: allReminders.filter(r => r.type === "order").length, label: "Reorder", color: T.accent }, { num: allReminders.filter(r => r.type === "toss").length, label: "Toss", color: T.warn }].map(st => (<View key={st.label} style={s.statBox}><Text style={[s.statNum, { color: st.color }]}>{st.num}</Text><Text style={s.statLabel}>{st.label}</Text></View>))}</View>
      {urgent.length > 0 && <><Text style={s.sectionLabel}>// URGENT</Text>{urgent.map(r => <ReminderItem key={r.id} r={r} />)}</>}
      {normal.length > 0 && <><Text style={s.sectionLabel}>// UPCOMING</Text>{normal.map(r => <ReminderItem key={r.id} r={r} />)}</>}
      {allReminders.length === 0 && <View style={{ alignItems: "center", padding: 48 }}><Text style={{ fontSize: 48 }}>✅</Text><Text style={[s.bold, { fontSize: 18, marginTop: 12 }]}>All clear!</Text></View>}

      {/* Running Low Section */}
      {(() => {
        const lowItems = items.filter(i => { const q = parseFloat(String(i.quantity)) || 0; return q <= 1; });
        if (lowItems.length === 0) return null;
        return (
          <>
            <Text style={s.sectionLabel}>// RUNNING LOW — REORDER</Text>
            {lowItems.map(i => (
              <TouchableOpacity key={"low-" + i.id} style={s.fridgeItem} onPress={() => setReorderItem(i)}>
                <View style={[s.reminderIcon, { backgroundColor: "rgba(255,153,0,0.1)" }]}><Text style={{ fontSize: 20 }}>{i.emoji}</Text></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.bold}>{i.name}</Text>
                  <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Qty: {i.quantity} · {i.category}</Text>
                </View>
                <View style={{ backgroundColor: "rgba(255,153,0,0.1)", borderWidth: 1, borderColor: "rgba(255,153,0,0.3)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Text style={{ color: "#FF9900", fontSize: 12, fontWeight: "700" }}>🛒 Reorder</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        );
      })()}

      <View style={{ height: 32 }} />
      <ReorderSheet item={reorderItem} visible={!!reorderItem} onClose={() => setReorderItem(null)} />
    </ScrollView>
  );
}

// ─── Receipt Scanner Helper ──────────────────────────────────────────────────
// Proxies through the Supabase Edge Function `scan-receipt` so the Anthropic
// API key stays off-device. Requires the user to be signed in.
async function parseReceiptImage(base64) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Please sign in to scan receipts.");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/scan-receipt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ image: base64 }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 429) throw new Error(data?.error || "Daily scan limit reached.");
    if (res.status === 401) throw new Error("Please sign in to scan receipts.");
    throw new Error(data?.error || `Scan failed (HTTP ${res.status}).`);
  }
  return Array.isArray(data.items) ? data.items : [];
}

// ─── Bulk Add Modal ──────────────────────────────────────────────────────────
function BulkAddModal({ visible, onClose, onAddItems, section }) {
  const emptyRow = () => ({ id: Date.now() + Math.random(), name: "", quantity: "1", expiry: "" });
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (visible) setRows([emptyRow(), emptyRow(), emptyRow()]);
  }, [visible]);

  function updateRow(id, field, value) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  function removeRow(id) {
    setRows(prev => prev.length <= 1 ? prev : prev.filter(r => r.id !== id));
  }

  function addRow() {
    setRows(prev => [...prev, emptyRow()]);
  }

  function applyReceiptItems(parsed) {
    const newRows = parsed.map(item => {
      const cat = guessCategory(item.name) !== "Other" ? guessCategory(item.name) : (item.category || "Other");
      const days = item.expiry_days || EXPIRY_MAP[cat] || 7;
      const expiryDate = new Date(Date.now() + days * 86400000);
      const yyyy = expiryDate.getFullYear();
      const mm = String(expiryDate.getMonth() + 1).padStart(2, "0");
      const dd = String(expiryDate.getDate()).padStart(2, "0");
      return {
        id: Date.now() + Math.random(),
        name: item.name || "",
        quantity: item.quantity || "1",
        expiry: `${yyyy}-${mm}-${dd}`,
      };
    });
    if (newRows.length > 0) setRows(newRows);
  }

  async function handleScanReceipt(source) {
    try {
      let result;
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Permission Required", "Please allow camera access to scan receipts.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 0.7,
          base64: true,
        });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Permission Required", "Please allow photo library access to upload receipts.");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.7,
          base64: true,
        });
      }
      if (result.canceled || !result.assets?.[0]?.base64) return;

      setScanning(true);
      const parsed = await parseReceiptImage(result.assets[0].base64);
      if (Array.isArray(parsed) && parsed.length > 0) {
        applyReceiptItems(parsed);
        track("receipt_scanned", { source, item_count: parsed.length });
      } else {
        Alert.alert("No items found", "Couldn't extract food items from this image. Try a clearer photo.");
      }
    } catch (e) {
      Alert.alert("Scan failed", "Couldn't process the receipt. Check your connection and try again.");
    } finally {
      setScanning(false);
    }
  }

  const validRows = rows.filter(r => r.name.trim());

  async function handleAddAll() {
    if (validRows.length === 0) return;
    setAdding(true);
    const items = validRows.map(r => {
      const cat = guessCategory(r.name);
      const defaultDays = EXPIRY_MAP[cat] || 7;
      const expiry = r.expiry.trim()
        ? new Date(r.expiry.trim()).toISOString()
        : new Date(Date.now() + defaultDays * 86400000).toISOString();
      return {
        name: r.name.trim(),
        category: cat,
        emoji: EMOJI_MAP[cat],
        quantity: r.quantity.trim() || "1",
        expiryDate: expiry,
        section: section || "fridge",
      };
    });
    await onAddItems(items);
    setAdding(false);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.border, backgroundColor: "#FFFFFF" }}>
          <TouchableOpacity onPress={onClose}><Text style={{ color: T.accent, fontSize: 15 }}>Cancel</Text></TouchableOpacity>
          <Text style={[s.bold, { fontSize: 16 }]}>Add Multiple Items</Text>
          <View style={{ width: 50 }} />
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            {/* Receipt Scanner Buttons */}
            {scanning ? (
              <View style={[s.card, { padding: 24, marginBottom: 16, alignItems: "center" }]}>
                <ActivityIndicator color={T.accent} size="large" />
                <Text style={[s.bold, { fontSize: 15, marginTop: 12 }]}>Reading receipt...</Text>
                <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 4 }}>AI is extracting your grocery items</Text>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
                <TouchableOpacity
                  style={[s.card, { flex: 1, padding: 14, alignItems: "center", gap: 6 }]}
                  onPress={() => handleScanReceipt("camera")}
                >
                  <Text style={{ fontSize: 28 }}>📷</Text>
                  <Text style={[s.bold, { fontSize: 13, textAlign: "center" }]}>Scan Receipt</Text>
                  <Text style={{ color: T.textSoft, fontSize: 11, textAlign: "center" }}>Take a photo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.card, { flex: 1, padding: 14, alignItems: "center", gap: 6 }]}
                  onPress={() => handleScanReceipt("library")}
                >
                  <Text style={{ fontSize: 28 }}>🖼</Text>
                  <Text style={[s.bold, { fontSize: 13, textAlign: "center" }]}>Upload Receipt</Text>
                  <Text style={{ color: T.textSoft, fontSize: 11, textAlign: "center" }}>From camera roll</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={{ backgroundColor: "rgba(22,163,74,0.08)", borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: "rgba(22,163,74,0.2)" }}>
              <Text style={{ color: T.accent, fontSize: 13, fontWeight: "600" }}>Scan a receipt to auto-fill, or type your grocery items below — category and expiry are auto-filled based on the item name.</Text>
            </View>

            {rows.map((row, index) => {
              const cat = row.name.trim() ? guessCategory(row.name) : null;
              return (
                <View key={row.id} style={[s.card, { padding: 14, marginBottom: 10 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: 20 }}>{cat ? EMOJI_MAP[cat] : "📝"}</Text>
                      <Text style={{ color: T.textSoft, fontSize: 12, fontWeight: "600" }}>ITEM {index + 1}</Text>
                      {cat && <View style={s.pill}><Text style={s.pillText}>{cat}</Text></View>}
                    </View>
                    {rows.length > 1 && (
                      <TouchableOpacity onPress={() => removeRow(row.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Ionicons name="close-circle" size={22} color={T.muted} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <TextInput
                    style={[s.input, { fontSize: 16, fontWeight: "600", marginBottom: 8 }]}
                    placeholder="Item name (e.g. Chicken breast)"
                    placeholderTextColor={T.muted}
                    value={row.name}
                    onChangeText={v => updateRow(row.id, "name", v)}
                  />
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.inputLabel}>Quantity</Text>
                      <TextInput
                        style={s.input}
                        placeholder="e.g. 2 lbs"
                        placeholderTextColor={T.muted}
                        value={row.quantity}
                        onChangeText={v => updateRow(row.id, "quantity", v)}
                      />
                    </View>
                    <View style={{ flex: 1.5 }}>
                      <Text style={s.inputLabel}>Expiry (optional)</Text>
                      <TextInput
                        style={s.input}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={T.muted}
                        value={row.expiry}
                        onChangeText={v => updateRow(row.id, "expiry", v)}
                        keyboardType="numbers-and-punctuation"
                      />
                    </View>
                  </View>
                  {cat && !row.expiry.trim() && (
                    <Text style={{ color: T.muted, fontSize: 11, marginTop: -4 }}>Auto-expiry: {EXPIRY_MAP[cat]} days from today</Text>
                  )}
                </View>
              );
            })}

            <TouchableOpacity onPress={addRow} style={[s.btnSecondary, { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10, borderStyle: "dashed" }]}>
              <Ionicons name="add-circle-outline" size={20} color={T.accent} />
              <Text style={{ color: T.accent, fontSize: 15, fontWeight: "600" }}>Add Another Item</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: T.border, padding: 16, paddingBottom: Platform.OS === "ios" ? 34 : 16 }}>
            <TouchableOpacity
              style={[s.btnPrimary, validRows.length === 0 && { opacity: 0.5 }]}
              onPress={handleAddAll}
              disabled={validRows.length === 0 || adding}
            >
              {adding
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={s.btnPrimaryText}>
                    {validRows.length === 0
                      ? "Enter items above"
                      : `✅  Add ${validRows.length} Item${validRows.length !== 1 ? "s" : ""} to Fridge`}
                  </Text>
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Add Item Modal ───────────────────────────────────────────────────────────
function AddModal({ visible, onClose, onAdd, onBulkAdd, onGoToScan }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Other");
  const [initialQty, setInitialQty] = useState("");
  const [initialUnit, setInitialUnit] = useState("");
  const categories = ["Dairy", "Protein", "Produce", "Dry Goods", "Beverages", "Other"];
  const emojiMap = { Dairy: "🥛", Protein: "🍗", Produce: "🥬", "Dry Goods": "🥣", Beverages: "🍶", Other: "📦" };

  function handleAdd() {
    if (!name.trim()) return;
    const qty = initialQty && initialUnit ? `${initialQty} ${initialUnit}` : initialQty || "1";
    onAdd({ name: name.trim(), category, emoji: emojiMap[category], quantity: qty, expiryDate: new Date(Date.now() + 7 * 86400000).toISOString(), section });
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
          <TouchableOpacity style={[s.btnSecondary, { marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }]} onPress={() => { onClose(); setTimeout(() => onGoToScan && onGoToScan(), 350); }}>
            <Ionicons name="barcode-outline" size={18} color={T.accent} />
            <Text style={{ color: T.accent, fontSize: 15, fontWeight: "600" }}>Scan Barcode</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.btnSecondary, { marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }]} onPress={() => { onClose(); setTimeout(() => onBulkAdd && onBulkAdd(), 350); }}>
            <Ionicons name="list-outline" size={18} color={T.accent} />
            <Text style={{ color: T.accent, fontSize: 15, fontWeight: "600" }}>Add Multiple Items</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Share Screen ─────────────────────────────────────────────────────────────
function ShareScreen() {
  const APP_URL = "https://apps.apple.com/us/app/ok2eat/id6761730687";

  async function handleShare() {
    try {
      const result = await Share.share({
        message: "I've been using ok2eat to track my fridge and reduce food waste. Check it out! " + APP_URL,
        url: APP_URL,
        title: "Check out ok2eat!",
      });
      if (result.action === Share.sharedAction) track("share_tapped");
    } catch (e) { console.log(e); }
  }

  const stats = [
    { emoji: "🥛", stat: "$1,500+", label: "wasted per household yearly" },
    { emoji: "🌍", stat: "30%", label: "of all food produced is wasted" },
    { emoji: "♻️", stat: "#3", label: "cause of greenhouse emissions" },
  ];

  return (
    <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}>
        <View><Text style={s.pageTitle}>Share ok2eat</Text><Text style={s.pageSubtitle}>Help friends waste less food</Text></View>
        <Text style={{ fontSize: 32 }}>↑</Text>
      </View>

      {/* Main share card */}
      <View style={[s.card, { margin: 16, marginBottom: 12, overflow: "hidden" }]}>
        <View style={{ backgroundColor: T.accent, padding: 24, alignItems: "center" }}>
          <Text style={{ fontSize: 48 }}>🧊</Text>
          <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 8, letterSpacing: -0.5 }}>ok2eat</Text>
          <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, marginTop: 4 }}>know before you throw</Text>
        </View>
        <View style={{ padding: 20 }}>
          <Text style={{ color: T.textSoft, fontSize: 14, lineHeight: 22, marginBottom: 20, textAlign: "center" }}>
            Track your fridge, scan groceries, get AI recipes, and stop throwing food away.
          </Text>
          <TouchableOpacity style={s.btnPrimary} onPress={handleShare}>
            <Text style={s.btnPrimaryText}>📲  Share with Friends</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Impact stats */}
      <Text style={s.sectionLabel}>// WHY IT MATTERS</Text>
      {stats.map((s2, i) => (
        <View key={i} style={[s.fridgeItem, { marginBottom: 8 }]}>
          <Text style={{ fontSize: 28, width: 44, textAlign: "center" }}>{s2.emoji}</Text>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[s.bold, { fontSize: 20, color: T.accent }]}>{s2.stat}</Text>
            <Text style={{ color: T.textSoft, fontSize: 13, marginTop: 2 }}>{s2.label}</Text>
          </View>
        </View>
      ))}

      {/* Share options */}
      <Text style={s.sectionLabel}>// OTHER WAYS TO SHARE</Text>
      <View style={[s.card, { margin: 16, marginBottom: 12, padding: 4 }]}>
        <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 14 }}
          onPress={() => Linking.openURL("mailto:?subject=Check out ok2eat!&body=I've been using ok2eat to track my fridge and stop wasting food. Download it here: https://apps.apple.com/us/app/ok2eat/id6761730687")}>
          <Text style={{ fontSize: 24 }}>✉️</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.bold, { fontSize: 15 }]}>Share via Email</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Send to a friend or family member</Text>
          </View>
          <Text style={{ color: T.muted, fontSize: 16 }}>›</Text>
        </TouchableOpacity>
        <View style={{ height: 1, backgroundColor: T.border, marginHorizontal: 14 }} />
        <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 14 }}
          onPress={() => Linking.openURL("https://apps.apple.com/us/app/ok2eat/id6761730687")}>
          <Text style={{ fontSize: 24 }}>⭐</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.bold, { fontSize: 15 }]}>Leave a Review</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Rate ok2eat on the App Store</Text>
          </View>
          <Text style={{ color: T.muted, fontSize: 16 }}>›</Text>
        </TouchableOpacity>
        <View style={{ height: 1, backgroundColor: T.border, marginHorizontal: 14 }} />
        <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 14 }}
          onPress={() => Linking.openURL("https://ok2eat.com")}>
          <Text style={{ fontSize: 24 }}>🌐</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.bold, { fontSize: 15 }]}>Visit ok2eat.com</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Learn more about the app</Text>
          </View>
          <Text style={{ color: T.muted, fontSize: 16 }}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState("fridge");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [addSection, setAddSection] = useState("fridge");
  const [toast, setToast] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const appState = useRef(AppState.currentState);

  // ── All hooks must come before any conditional returns ──
  
  // Auth state listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) identifyUser(session.user.id);
      else { setItems([]); resetAnalytics(); }
    });
    return () => authSub.unsubscribe();
  }, []);

  // AppState + notification tap listeners
  useEffect(() => {
    const appStateSub = AppState.addEventListener("change", nextAppState => {
      if (appState.current.match(/inactive|background/) && nextAppState === "active") {
        loadItems();
      }
      appState.current = nextAppState;
    });
    const notifSub = Notifications.addNotificationResponseReceivedListener(() => {
      setTab("reminders");
    });
    return () => {
      appStateSub.remove();
      notifSub.remove();
    };
  }, []);

  // Load items and setup notifications when user logs in
  useEffect(() => {
    if (user) {
      loadItems();
      setupNotifications();
    }
  }, [user]);

  // Check expiring items when app comes to foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", nextState => {
      if (nextState === "active" && notificationsEnabled && items.length > 0) {
        checkAndNotifyExpiring(items);
      }
    });
    return () => sub.remove();
  }, [items, notificationsEnabled]);

  // ── Helper functions ──

  async function setupNotifications() {
    const granted = await requestNotificationPermission();
    setNotificationsEnabled(granted);
  }

  async function toggleNotifications() {
    if (notificationsEnabled) {
      await Notifications.cancelAllScheduledNotificationsAsync();
      setNotificationsEnabled(false);
      showToast("🔕 Daily reminders turned off");
    } else {
      const granted = await requestNotificationPermission();
      if (granted) {
        await scheduleDailyReminder();
        setNotificationsEnabled(true);
        showToast("🔔 Daily reminders enabled!");
      } else {
        Alert.alert("Permission Required", "Please enable notifications in your iPhone Settings to use this feature.");
      }
    }
  }

  async function sendTestNotification() {
    const granted = await requestNotificationPermission();
    if (!granted) { Alert.alert("Permission Required", "Please enable notifications in your iPhone Settings."); return; }
    await Notifications.scheduleNotificationAsync({
      content: { title: "🧊 ok2eat Test", body: "Notifications are working!" },
      trigger: { type: "timeInterval", seconds: 2, repeats: false },
    });
    showToast("Test notification sent!");
  }

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
      const saved = await dbAddItem({ name: product.name, category: product.category, emoji: product.emoji, quantity: 1, barcode: product.code, addedDate: new Date().toISOString(), expiryDate: new Date(Date.now() + product.defaultExpiry * 86400000).toISOString(), section: addSection || "fridge" });
      setItems(prev => [rowToItem(saved), ...prev]);
      showToast(`✅ ${product.name} added!`);
      track("item_scanned", { category: product.category });
      setTimeout(() => setTab("fridge"), 1200);
    } catch (e) { Alert.alert("Couldn't save item", "Check your connection."); }
  }

  async function handleAddManual(data) {
    try {
      const saved = await dbAddItem({ ...data, section: data.section || "fridge" });
      setItems(prev => [rowToItem(saved), ...prev]);
      showToast(`✅ ${data.name} added!`);
      track("item_added_manual", { category: data.category });
    } catch (e) { Alert.alert("Couldn't save item", "Check your connection."); }
  }

  async function handleBulkAdd(itemsList) {
    try {
      const saved = [];
      for (const item of itemsList) {
        const row = await dbAddItem(item);
        saved.push(rowToItem(row));
      }
      setItems(prev => [...saved, ...prev]);
      showToast(`✅ ${saved.length} item${saved.length !== 1 ? "s" : ""} added!`);
      track("item_added_bulk", { count: saved.length });
      setTab("fridge");
    } catch (e) { Alert.alert("Couldn't save items", "Check your connection."); }
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
      if (newQty === null) {
        await dbDeleteItem(id);
        setItems(prev => prev.filter(i => i.id !== id));
        showToast("✅ Item fully used and removed!");
      } else {
        await dbUpdateItem(id, { quantity: newQty });
        setItems(prev => prev.map(i => i.id === id ? { ...i, quantity: newQty } : i));
        showToast(`✅ Updated — ${newQty} remaining`);
      }
      track("item_used", { fully_used: newQty === null });
    } catch (e) { Alert.alert("Couldn't update item", "Check your connection."); }
  }

  async function handleDelete(id) {
    try {
      await dbDeleteItem(id);
      setItems(prev => prev.filter(i => i.id !== id));
      showToast("🗑️ Item removed");
      track("item_deleted");
    } catch (e) { Alert.alert("Couldn't delete item", "Check your connection."); }
  }

  // ── Conditional renders after all hooks ──

  if (authLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={T.accent} size="large" />
      </SafeAreaView>
    );
  }

  if (!user) return <AuthScreen onAuth={setUser} />;

  const navItems = [{ id: "fridge", label: "Fridge", icon: "🧊" }, { id: "recipes", label: "Recipes", icon: "🍳" }, { id: "reminders", label: "Alerts", icon: "🔔" }, { id: "share", label: "Share", icon: "↑" }];

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={T.bg} />
      <View style={s.appBar}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={s.appLogo}><Text style={{ fontSize: 14 }}>🧊</Text></View>
          <Text style={s.appName}>ok2eat</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TouchableOpacity
            onPress={() => Linking.openURL("mailto:hello@ok2eat.com?subject=ok2eat%20Feedback&body=Hi%20ok2eat%20team%2C%0A%0A")}
            style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "rgba(22,163,74,0.1)", borderWidth: 1, borderColor: "rgba(22,163,74,0.2)", borderRadius: 8 }}
          >
            <Text style={{ fontSize: 10, color: T.accent, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}>✉ FEEDBACK</Text>
          </TouchableOpacity>
          <View style={s.aiBadge}><Text style={s.aiBadgeText}>⚡ LIVE</Text></View>
          <TouchableOpacity onPress={() => supabase.auth.signOut()} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text style={{ fontSize: 10, color: T.muted, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}>OUT</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ flex: 1 }}>
        {tab === "fridge" && <FridgeScreen items={items} onDelete={handleDelete} onAdd={(section) => { setAddSection(section || "fridge"); setShowAdd(true); }} onUpdate={handleUpdate} onUse={handleUse} loading={loading} />}
        {tab === "scan" && <ScanScreen onScanned={handleScanned} />}
        {tab === "recipes" && <RecipesScreen items={items} />}
        {tab === "reminders" && <RemindersScreen items={items} notificationsEnabled={notificationsEnabled} onToggleNotifications={toggleNotifications} onTestNotification={sendTestNotification} />}
        {tab === "share" && <ShareScreen />}
      </View>
      {toast !== "" && <Animated.View style={[s.toast, { opacity: toastOpacity }]}><Text style={s.toastText}>{toast}</Text></Animated.View>}
      <AddModal visible={showAdd} onClose={() => setShowAdd(false)} onAdd={handleAddManual} onGoToScan={() => { setShowAdd(false); setTab("scan"); }} section={addSection} onBulkAdd={() => setShowBulkAdd(true)} />
      <BulkAddModal visible={showBulkAdd} onClose={() => setShowBulkAdd(false)} onAddItems={handleBulkAdd} section={addSection} />
      <View style={s.navBar}>
        {navItems.map(n => (
          <TouchableOpacity key={n.id} style={s.navBtn} onPress={() => setTab(n.id)}>
            {n.id === "fridge" && <MaterialIcons name="kitchen" size={24} color={tab === n.id ? T.accent : T.muted} />}
            {n.id === "recipes" && <Ionicons name="restaurant-outline" size={24} color={tab === n.id ? T.accent : T.muted} />}
            {n.id === "reminders" && <Ionicons name="notifications-outline" size={24} color={tab === n.id ? T.accent : T.muted} />}
            {n.id === "share" && <Ionicons name="share-outline" size={24} color={tab === n.id ? T.accent : T.muted} />}
            <Text style={[s.navLabel, tab === n.id && { color: T.accent }]}>{n.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg }, screen: { flex: 1, backgroundColor: T.bg },
  appBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border, backgroundColor: "#FFFFFF" },
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
  chipActive: { backgroundColor: "rgba(22,163,74,0.15)", borderColor: T.accent },
  chipText: { color: T.textSoft, fontSize: 12, fontWeight: "500" },
  chipTextActive: { color: T.accent },
  warnBanner: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 12, backgroundColor: "rgba(234,88,12,0.08)", borderWidth: 1, borderColor: "rgba(234,88,12,0.25)", borderRadius: 14, padding: 12 },
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
  btnPrimaryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  btnSecondary: { backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 14, alignItems: "center" },
  btnSecondaryText: { color: T.text, fontSize: 15, fontWeight: "600" },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: "rgba(22,163,74,0.1)", borderWidth: 1, borderColor: "rgba(22,163,74,0.2)" },
  pillText: { fontSize: 12, color: T.accent, fontWeight: "500" },
  recipeEmojiBox: { width: 56, height: 56, backgroundColor: "rgba(22,163,74,0.1)", borderWidth: 1, borderColor: "rgba(22,163,74,0.2)", borderRadius: 14, alignItems: "center", justifyContent: "center" },
  backBtn: { padding: 16, paddingBottom: 0 },
  ingredientRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  checkBox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  aiBadge: { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "rgba(22,163,74,0.1)", borderWidth: 1, borderColor: "rgba(22,163,74,0.2)", borderRadius: 8 },
  aiBadgeText: { fontSize: 10, color: T.accent, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  reminderIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  urgentBadge: { paddingHorizontal: 8, paddingVertical: 2, backgroundColor: "rgba(220,38,38,0.1)", borderWidth: 1, borderColor: "rgba(220,38,38,0.2)", borderRadius: 4 },
  urgentText: { fontSize: 10, color: T.danger, fontWeight: "600", letterSpacing: 0.5 },
  dismissBtn: { width: 32, height: 32, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  navBar: { flexDirection: "row", backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: T.border, paddingBottom: Platform.OS === "ios" ? 20 : 8, paddingTop: 8 },
  navBtn: { flex: 1, alignItems: "center", gap: 3 },
  navLabel: { fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: "500" },
  toast: { position: "absolute", bottom: 100, left: 16, right: 16, backgroundColor: T.accent, borderRadius: 14, padding: 14 },
  toastText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14, textAlign: "center" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 48, borderWidth: 1, borderColor: T.border },
  sheetHandle: { width: 36, height: 4, backgroundColor: T.border, borderRadius: 99, alignSelf: "center", marginBottom: 20 },
  modeToggle: { flexDirection: "row", marginHorizontal: 16, marginBottom: 16, backgroundColor: T.card, borderRadius: 12, borderWidth: 1, borderColor: T.border, padding: 4, gap: 4 },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  modeBtnActive: { backgroundColor: T.accent },
  modeBtnText: { fontSize: 13, fontWeight: "600", color: T.textSoft },
  modeBtnTextActive: { color: "#FFFFFF" },
  errorBox: { marginHorizontal: 16, marginBottom: 12, backgroundColor: "rgba(220,38,38,0.08)", borderWidth: 1, borderColor: "rgba(220,38,38,0.25)", borderRadius: 12, padding: 12 },
  cameraBigBtn: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 16, backgroundColor: T.accent, borderRadius: 16, padding: 18 },
});