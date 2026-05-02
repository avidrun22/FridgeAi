import { useState, useEffect, useRef } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, SafeAreaView, StatusBar, Modal, Alert,
  Animated, Platform, ActivityIndicator, AppState, KeyboardAvoidingView,
  PanResponder, Dimensions, Keyboard, InputAccessoryView,
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

// ─── Global font-scaling cap ─────────────────────────────────────────────────
// iOS Dynamic Type can scale fonts up to 3.5x. Our card-based layouts break
// past about 1.3x — text spills over flex containers, badges overlap labels,
// etc. Hard ceiling here lets accessibility users still get larger text but
// keeps the UI from breaking.
Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.maxFontSizeMultiplier = 1.3;
TextInput.defaultProps = TextInput.defaultProps || {};
TextInput.defaultProps.maxFontSizeMultiplier = 1.3;

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

// As of v1.0.5 we use a server-driven daily digest instead of per-item local
// notifications, so this is a no-op kept only so any stale callers still
// compile. Cancel any leftover schedules from older builds.
async function cancelLegacyNotifications() {
  try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch {}
}

// Get the Expo push token for this device (returns null if simulator or denied)
async function getExpoPushToken() {
  try {
    const Constants = require("expo-constants").default;
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ||
      Constants?.easConfig?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return tokenData?.data || null;
  } catch (e) {
    console.log("Push token error:", e?.message || e);
    return null;
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

// ─── App Store update check ──────────────────────────────────────────────────
// APP_VERSION reads from app.json's expo.version at runtime via expo-constants
// — no manual bumping required. Previously this was hardcoded and got stale
// (left at "1.0.9" through 1.0.10 and 1.1.0 ships), which caused the update
// modal to fire even for users on the latest build.
const _expoConstants = require("expo-constants").default;
const APP_VERSION =
  _expoConstants?.expoConfig?.version ||
  _expoConstants?.manifest?.version ||
  "1.12";
const APP_STORE_URL = "https://apps.apple.com/app/id6761730687";
const ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup?bundleId=com.gregorygoldberg.ok2eat";
const APP_STORE_APP_ID = "6761730687"; // Apple's numeric app ID, used for itms:// fallback

// Apple's iTunes Lookup API normalizes "X.Y.Z" by concatenating the last
// two segments into one: "1.0.6" → "1.06", "1.1.0" → "1.10", "1.0.10" →
// "1.010", "1.0.9" → "1.09". The concatenated form is genuinely ambiguous
// when parsed as a version (does "1.10" mean [1,10] or [1,1,0]?), so we
// can't reliably disambiguate at parse time. Instead, when comparing local
// (canonical X.Y.Z from app.json) against remote (Apple-normalized), we
// also try Apple-normalizing local and check for string equality. If they
// match, the versions are equal — no update needed.
function _appleNormalize(v) {
  const parts = String(v).split(".");
  if (parts.length === 3) return parts[0] + "." + parts[1] + parts[2];
  return String(v);
}

function _versionParts(v) {
  return String(v).split(".").flatMap(seg =>
    seg.length > 1 && seg.startsWith("0") ? seg.split("") : [seg]
  ).map(n => parseInt(n, 10) || 0);
}

function compareVersions(local, remote) {
  // Compare both versions in Apple's normalized space ("X.YZ"). This sidesteps
  // the ambiguity of trying to parse Apple's "1.10" back into either [1,10]
  // or [1,1,0] — both sides get folded into the same shape, then we numeric-
  // compare segment by segment. Examples:
  //   local "1.1.1" vs remote "1.10"  → "1.11" vs "1.10"  → [1,11] vs [1,10]  → local newer
  //   local "1.1.0" vs remote "1.10"  → "1.10" vs "1.10"  → equal (no modal)
  //   local "1.0.9" vs remote "1.10"  → "1.09" vs "1.10"  → [1,9]  vs [1,10]  → remote newer
  //   local "1.0.10" vs remote "1.010" → "1.010" vs "1.010" → equal
  if (local === remote) return 0;
  const a = _appleNormalize(local).split(".").map(s => parseInt(s, 10) || 0);
  const b = _appleNormalize(remote).split(".").map(s => parseInt(s, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const da = a[i] || 0, db = b[i] || 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

// Render a version string for display. Used only for our LOCAL version
// (which we control), so we don't need to handle Apple's normalized forms.
function formatVersion(v) {
  const parts = _versionParts(v);
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3).join(".");
}

async function dbGetItems() {
  const { data, error } = await supabase.from("fridge_items").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

async function dbAddItem(item) {
  const { data: { user } } = await supabase.auth.getUser();

  // v1.0.8 — make sure we have a household_id. Items added without it would
  // be invisible to the new household-scoped RLS policies. ensure_household_for_user
  // is idempotent on the server.
  let householdId = item.householdId;
  if (!householdId) {
    const { data: hhId, error: rpcErr } = await supabase.rpc("ensure_household_for_user");
    if (rpcErr) throw rpcErr;
    householdId = hhId;
  }

  // Normalize container (v1.0.8). Mirror to section so v1.0.6/v1.0.7
  // clients reading the old `section` column still see the item.
  const container = ["fridge", "pantry", "freezer"].includes(item.container)
    ? item.container
    : (["fridge", "pantry", "freezer"].includes(item.section) ? item.section : "fridge");
  const sectionMirror = container === "pantry" ? "cupboard" : container;

  const { data, error } = await supabase.from("fridge_items").insert({
    name: item.name, category: item.category, emoji: item.emoji,
    quantity: item.quantity || 1,
    unit: item.unit || null,
    added_date: item.addedDate || new Date().toISOString(),
    expiry_date: item.expiryDate, barcode: item.barcode || null,
    user_id: user.id,
    household_id: householdId,
    container,
    section: sectionMirror,
    // Open/closed expiry tracking
    is_opened: item.isOpened || false,
    opened_at: item.openedAt || null,
    expiry_opened_days: item.expiryOpenedDays || null,
    expiry_unopened: item.expiryUnopened || null,
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
  // v1.0.8 — prefer the new container column; fall back to mapping the legacy
  // section field for any row not yet backfilled.
  const container = row.container && ["fridge", "pantry", "freezer"].includes(row.container)
    ? row.container
    : (row.section === "cupboard" ? "pantry"
      : ["fridge", "pantry", "freezer"].includes(row.section) ? row.section
      : "fridge");
  return {
    id: row.id, name: row.name, category: row.category, emoji: row.emoji,
    quantity: row.quantity, unit: row.unit || "",
    addedDate: row.added_date, expiryDate: row.expiry_date,
    barcode: row.barcode,
    container,
    section: row.section || "fridge",
    householdId: row.household_id || null,
    isOpened: row.is_opened || false,
    openedAt: row.opened_at || null,
    expiryOpenedDays: row.expiry_opened_days || null,
    expiryUnopened: row.expiry_unopened || null,
  };
}

// Display helper: "2 lbs", "1 dozen", or just "2" if no unit
function formatQty(item) {
  const q = item?.quantity;
  const u = (item?.unit || "").trim();
  if (q === undefined || q === null || q === "") return u || "—";
  return u ? `${q} ${u}` : String(q);
}

// ─── Open Food Facts ──────────────────────────────────────────────────────────
const CATEGORY_MAP = { "beverages": "Beverages", "dairies": "Dairy", "dairy": "Dairy", "cheeses": "Dairy", "milks": "Dairy", "yogurts": "Dairy", "meats": "Protein", "poultry": "Protein", "seafood": "Protein", "eggs": "Protein", "fish": "Protein", "fruits": "Produce", "vegetables": "Produce", "fresh": "Produce", "breads": "Dry Goods", "cereals": "Dry Goods", "snacks": "Dry Goods", "pasta": "Dry Goods" };
const EMOJI_MAP = { "Dairy": "🧀", "Protein": "🍗", "Produce": "🥬", "Dry Goods": "🥣", "Beverages": "🍶", "Other": "📦" };
const EXPIRY_MAP = { "Dairy": 14, "Protein": 3, "Produce": 5, "Dry Goods": 180, "Beverages": 7, "Other": 7 };

// Categories where the open-vs-closed distinction matters. v1.0.9 expanded
// this to include Protein (canned tuna, jerky, packaged deli, etc.) — Greg's
// mental model is "fresh = Dairy + Produce; everything else gets dual
// closed/opened expiry by default." Users can still leave the opened-days
// blank for items where the distinction is meaningless (a fresh chicken
// breast in plastic wrap doesn't really have an "opened" shelf life).
const FRESH_CATEGORIES = new Set(["Dairy", "Produce"]);
const PACKAGED_CATEGORIES = new Set(["Protein", "Beverages", "Dry Goods", "Other"]);
const isPackagedCategory = (cat) => PACKAGED_CATEGORIES.has(cat);

// Default once-opened shelf life by category (days). Conservative defaults
// based on USDA FoodKeeper guidance; the user can override per item.
const OPENED_DAYS_MAP = { "Protein": 3, "Beverages": 7, "Dry Goods": 30, "Other": 7 };

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
        <View style={{ flex: 1, marginRight: 10 }}>
          <Text style={[s.bold, { fontSize: 14, letterSpacing: 0.5 }]}>NUTRITION FACTS</Text>
          <Text style={{ color: T.textSoft, fontSize: 11, marginTop: 2 }} numberOfLines={1}>Per serving · {nutrition.serving}</Text>
        </View>
        {grade && /^[a-e]$/i.test(grade) && (
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
// v1.0.10 — simplified to match the web. The old version had a unit picker
// + FRACTION_MAP for cross-unit math (1 tbsp of a 16 oz bottle → 15.5 oz),
// which was overkill for a fridge tracker. New version: amount in the
// item's existing unit, subtract directly, "Use it all" shortcut.
function UseItemModal({ item, visible, onClose, onUse }) {
  const [amount, setAmount] = useState("1");

  useEffect(() => {
    if (visible) setAmount("1");
  }, [visible]);

  if (!item) return null;

  const currentQty = parseFloat(item.quantity) || 1;
  const unit = (item.unit || "").trim();

  function handleConfirm() {
    const used = parseFloat(amount) || 0;
    if (used <= 0) {
      Alert.alert("Enter an amount", "How many did you use?");
      return;
    }
    const remaining = currentQty - used;
    if (remaining <= 0) {
      Alert.alert(
        "Item fully used",
        `Remove ${item.name} from your fridge?`,
        [
          { text: "Keep it", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: () => onUse(item.id, null) },
        ]
      );
      return;
    }
    // Round to 1 decimal so we don't store float noise.
    const cleanRemaining = Math.round(remaining * 10) / 10;
    onUse(item.id, cleanRemaining);
  }

  function handleUseAll() {
    Alert.alert(
      `Used all of ${item.name}?`,
      "It'll be removed from your fridge.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => onUse(item.id, null) },
      ]
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.modalSheet}>
          <View style={s.sheetHandle} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <Text style={{ fontSize: 36 }}>{item.emoji}</Text>
            <View>
              <Text style={[s.bold, { fontSize: 18 }]}>Use this item</Text>
              <Text style={{ color: T.textSoft, fontSize: 13 }}>{item.name}</Text>
            </View>
          </View>

          <Text style={{ color: T.textSoft, fontSize: 13, marginBottom: 12 }}>
            How {unit ? `many ${unit}` : "much"} did you use? You have {currentQty}{unit ? ` ${unit}` : ""}.
          </Text>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <TextInput
              style={[s.input, { flex: 1, fontSize: 22, textAlign: "center", fontWeight: "700", marginBottom: 0 }]}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={T.muted}
              autoFocus
            />
            {unit ? (
              <Text style={{ color: T.textSoft, fontSize: 16, fontWeight: "600", paddingHorizontal: 4 }}>{unit}</Text>
            ) : null}
          </View>

          <TouchableOpacity style={s.btnPrimary} onPress={handleConfirm}>
            <Text style={s.btnPrimaryText}>
              {`Use ${amount || 0}${unit ? " " + unit : ""}`}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.btnSecondary, { marginTop: 10 }]} onPress={handleUseAll}>
            <Text style={[s.btnSecondaryText, { color: T.accent }]}>Use it all</Text>
          </TouchableOpacity>

          <TouchableOpacity style={{ alignItems: "center", paddingVertical: 14, marginTop: 4 }} onPress={onClose}>
            <Text style={{ color: T.textSoft, fontSize: 14 }}>Cancel</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Reorder Sheet ──────────────────────────────────────────────────────────
// Affiliate IDs:
//   Amazon — "ok2eat-20" is a live Associates tag; commissions track in
//     https://affiliate-program.amazon.com → Reports.
//   Target & Instacart — affiliate programs run via Impact (impact.com).
//     Replace afid/aff placeholders with real IDs once Impact applications
//     are approved. Until then clicks land on the right pages but no
//     commission accrues.
// Order matters — the first retailer appears first in every reorder sheet
// and the shopping-list "Order N items" picker. Reordered 2026-04-28 after
// payout research: Target paid $0 on grocery, Amazon Associates is minimal
// for food. Instacart (Impact) is the strongest payout for groceries;
// Walmart (also Impact) is the second-best for groceries. Amazon stays in
// the middle for non-grocery / pantry-staple longtail.
const RETAILERS = [
  { id: "instacart", label: "Instacart", color: "#43B02A", url: (name) => `https://www.instacart.com/store/search?k=${encodeURIComponent(name)}&utm_source=ok2eat&utm_medium=affiliate` },
  { id: "amazon",    label: "Amazon",    color: "#FF9900", url: (name) => `https://www.amazon.com/s?k=${encodeURIComponent(name)}&tag=ok2eat-20` },
  // Walmart affiliate runs through Impact (same platform as Instacart). The
  // utm params below are placeholders until Greg's Impact application is
  // approved and we get the real Walmart tracking ID — replace then.
  { id: "walmart",   label: "Walmart",   color: "#0071CE", url: (name) => `https://www.walmart.com/search?q=${encodeURIComponent(name)}&utm_source=ok2eat&utm_medium=affiliate` },
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
  const [unit, setUnit] = useState("");
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
      setQuantity(String(item.quantity || 1)); setUnit(item.unit || "");
      setCategory(item.category || "Other");
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
    // quantity is an integer column — coerce, default to 1 if blank/garbage
    const parsedQty = parseInt(String(quantity || "").trim(), 10);
    const safeQty = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;
    const updates = { name: name.trim(), category, emoji: emojiMap[category] || item.emoji, quantity: safeQty, unit: (unit || "").trim() || null, expiry_date: expiryDate ? new Date(expiryDate).toISOString() : item.expiryDate };
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
            {/* Mark-as-opened (only for packaged items not yet opened) */}
            {!editing && item.expiryOpenedDays && !item.isOpened && (
              <TouchableOpacity
                style={{ backgroundColor: "rgba(234,88,12,0.08)", borderWidth: 1.5, borderColor: "rgba(234,88,12,0.3)", borderRadius: 14, padding: 16, marginBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }}
                onPress={() => {
                  Alert.alert("Mark as opened?", `Once opened, ${item.name} should be used within ${item.expiryOpenedDays} days. The expiry will update.`, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Mark Opened", onPress: () => {
                        const newExpiry = new Date(Date.now() + item.expiryOpenedDays * 86400000).toISOString();
                        onUpdate(item.id, { is_opened: true, opened_at: new Date().toISOString(), expiry_date: newExpiry });
                      } }
                  ]);
                }}
              >
                <Text style={{ fontSize: 20 }}>🔓</Text>
                <View>
                  <Text style={[s.bold, { color: T.warn, fontSize: 15 }]}>Mark as opened</Text>
                  <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 1 }}>Use within {item.expiryOpenedDays} days once opened</Text>
                </View>
              </TouchableOpacity>
            )}
            {/* Already-opened indicator + undo */}
            {!editing && item.isOpened && (
              <TouchableOpacity
                style={{ backgroundColor: "rgba(234,88,12,0.05)", borderWidth: 1, borderColor: "rgba(234,88,12,0.2)", borderRadius: 14, padding: 14, marginBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                onPress={() => {
                  Alert.alert("Mark as unopened?", "This restores the original closed-state expiry date.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Undo", onPress: () => {
                        const restored = item.expiryUnopened
                          ? new Date(item.expiryUnopened).toISOString()
                          : item.expiryDate;
                        onUpdate(item.id, { is_opened: false, opened_at: null, expiry_date: restored });
                      } }
                  ]);
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                  <Text style={{ fontSize: 18 }}>🔓</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.bold, { color: T.warn, fontSize: 14 }]}>Opened {item.openedAt ? formatDate(item.openedAt) : "recently"}</Text>
                    <Text style={{ color: T.textSoft, fontSize: 11, marginTop: 1 }}>Tap to undo</Text>
                  </View>
                </View>
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
                <View style={{ flex: 0.6 }}>
                  <Text style={s.inputLabel}>Amount</Text>
                  {editing
                    ? <TextInput style={s.input} value={quantity} onChangeText={setQuantity} placeholder="2" placeholderTextColor={T.muted} keyboardType="decimal-pad" />
                    : <Text style={{ color: T.text, fontSize: 15 }}>{item.quantity}</Text>}
                </View>
                <View style={{ flex: 0.9 }}>
                  <Text style={s.inputLabel}>Unit</Text>
                  {editing
                    ? <UnitPicker value={unit} onChange={setUnit} />
                    : <Text style={{ color: T.text, fontSize: 15 }}>{item.unit || "—"}</Text>}
                </View>
                <View style={{ flex: 1.5 }}>
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
// v1.0.9 — compact replacement for the iOS Picker that was eating ~150px of
// vertical space on the fridge screen. Same behavior, ~36px tall, modal opens
// only on tap. Same pattern as UnitPicker.
function CategoryFilterButton({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const label = value === "All" ? "All Categories" : value;
  return (
    <View>
      <TouchableOpacity
        style={[s.input, { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 0 }]}
        onPress={() => setOpen(true)}
      >
        <Text style={{ color: T.text, fontSize: 15, fontWeight: "500" }}>{label}</Text>
        <Ionicons name="chevron-down" size={16} color={T.muted} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 }} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={{ backgroundColor: "#FFFFFF", borderRadius: 12, maxHeight: "70%" }}>
            <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
              {options.map(opt => (
                <TouchableOpacity
                  key={opt}
                  style={{ paddingHorizontal: 16, paddingVertical: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                  onPress={() => { onChange(opt); setOpen(false); }}
                >
                  <Text style={{ color: T.text, fontSize: 16 }}>{opt === "All" ? "All Categories" : opt}</Text>
                  {value === opt && <Ionicons name="checkmark" size={18} color={T.accent} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function FridgeScreen({ items, onDelete, onBulkDelete, onAdd, onUpdate, onUse, loading, householdName, onOpenManageInventory }) {
  const [filter, setFilter] = useState("All");
  const [selectedItem, setSelectedItem] = useState(null);
  const [useItem, setUseItem] = useState(null);
  const [activeSection, setActiveSection] = useState("fridge");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  // v1.0.10 — inventory search. Filters items in-place by case-insensitive
  // name substring across the active container.
  const [searchQuery, setSearchQuery] = useState("");

  function toggleSelected(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }
  function selectAllVisible() {
    setSelectedIds(new Set(filtered.map(i => i.id)));
  }
  function confirmBulkDelete() {
    const count = selectedIds.size;
    if (count === 0) return;
    Alert.alert(
      `Delete ${count} item${count !== 1 ? "s" : ""}?`,
      "This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: async () => {
          await onBulkDelete([...selectedIds]);
          exitSelectMode();
        } },
      ]
    );
  }
  const [sections, setSections] = useState([
    { id: "fridge",  label: "Fridge",  icon: "kitchen" },
    { id: "pantry",  label: "Pantry",  icon: "shelves" },
    { id: "freezer", label: "Freezer", icon: "ac-unit" },
  ]);
  const [editingSection, setEditingSection] = useState(null);
  const [editLabel, setEditLabel] = useState("");
  const categories = ["All", "Dairy", "Protein", "Produce", "Dry Goods", "Beverages"];
  const sectionItems = items.filter(i => (i.container || i.section || "fridge") === activeSection);
  // First apply category/expiry filter, then narrow with the text search.
  const categoryFiltered = filter === "All"
    ? sectionItems
    : filter === "expiring"
      ? sectionItems.filter(i => { const d = daysUntil(i.expiryDate); return d > 0 && d <= 3; })
      : filter === "expired"
        ? sectionItems.filter(i => daysUntil(i.expiryDate) <= 0)
        : sectionItems.filter(i => i.category === filter);
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? categoryFiltered.filter(i => (i.name || "").toLowerCase().includes(q))
    : categoryFiltered;
  const expired = sectionItems.filter(i => daysUntil(i.expiryDate) <= 0).length;
  const expiringSoon = sectionItems.filter(i => { const d = daysUntil(i.expiryDate); return d > 0 && d <= 3; }).length;

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
          <View style={{ flex: 1 }}>
            <Text style={s.pageTitle}>{householdName || "My Fridge"}</Text>
            <Text style={s.pageSubtitle}>{loading ? "Loading..." : `${sectionItems.length} items tracked`}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {onOpenManageInventory && (
              <TouchableOpacity
                onPress={onOpenManageInventory}
                style={{ paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "rgba(22,163,74,0.1)", borderWidth: 1, borderColor: "rgba(22,163,74,0.2)", borderRadius: 14 }}
              >
                <Text style={{ fontSize: 11, color: T.accent, fontWeight: "600" }}>Manage inventory</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {/* v1.0.10 — inline search bar (filters across the active container) */}
        <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: T.card, borderRadius: 12, borderWidth: 1, borderColor: T.border, paddingHorizontal: 12 }}>
            <Ionicons name="search" size={16} color={T.muted} />
            <TextInput
              style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8, fontSize: 14, color: T.text }}
              placeholder="Search your fridge…"
              placeholderTextColor={T.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
              clearButtonMode="while-editing"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && Platform.OS !== "ios" && (
              <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close-circle" size={18} color={T.muted} />
              </TouchableOpacity>
            )}
          </View>
        </View>
        {/* Storage Section Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 16, marginBottom: 12 }}>
          {sections.map(sec => (
            <TouchableOpacity
              key={sec.id}
              onPress={() => { setActiveSection(sec.id); setFilter("All"); }}
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
          <TouchableOpacity style={[s.statBox, filter === "expired" && { borderColor: T.danger, borderWidth: 2 }]} onPress={() => setFilter(filter === "expired" ? "All" : "expired")}>
            <Text style={[s.statNum, { color: expired > 0 ? T.danger : T.accent }]}>{expired}</Text>
            <Text style={s.statLabel}>Expired</Text>
          </TouchableOpacity>
        </View>
        <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <CategoryFilterButton
            value={filter}
            options={categories}
            onChange={setFilter}
          />
        </View>
        {expiringSoon > 0 && <View style={s.warnBanner}><Text style={{ fontSize: 18 }}>⚠️</Text><View style={{ marginLeft: 10 }}><Text style={[s.bold, { color: T.warn }]}>Heads up!</Text><Text style={{ color: T.textSoft, fontSize: 12 }}>{expiringSoon} item{expiringSoon > 1 ? "s" : ""} expiring within 3 days</Text></View></View>}

        {/* Multi-select toolbar */}
        {filtered.length > 0 && (
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, marginBottom: 8 }}>
            {selectMode ? (
              <>
                <TouchableOpacity onPress={exitSelectMode}><Text style={{ color: T.accent, fontSize: 14, fontWeight: "600" }}>Cancel</Text></TouchableOpacity>
                <Text style={{ color: T.textSoft, fontSize: 13 }}>{selectedIds.size} selected</Text>
                <View style={{ flexDirection: "row", gap: 14 }}>
                  <TouchableOpacity onPress={selectAllVisible}><Text style={{ color: T.accent, fontSize: 14, fontWeight: "600" }}>Select all</Text></TouchableOpacity>
                  <TouchableOpacity onPress={confirmBulkDelete} disabled={selectedIds.size === 0}>
                    <Text style={{ color: selectedIds.size > 0 ? T.danger : T.muted, fontSize: 14, fontWeight: "700" }}>Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <View />
                <TouchableOpacity onPress={() => setSelectMode(true)}><Text style={{ color: T.accent, fontSize: 14, fontWeight: "600" }}>Select</Text></TouchableOpacity>
              </>
            )}
          </View>
        )}
        {loading ? (
          <View style={{ alignItems: "center", padding: 48 }}><ActivityIndicator color={T.accent} size="large" /><Text style={{ color: T.textSoft, marginTop: 12 }}>Loading your fridge...</Text></View>
        ) : (
          <>
            <Text style={s.sectionLabel}>{filter === "expiring" ? "// EXPIRING SOON" : filter === "expired" ? "// EXPIRED — REMOVE OR DISCARD" : "// CONTENTS · TAP TO VIEW DETAILS"}</Text>
            {filtered.length === 0 && (
              q ? (
                <View style={{ alignItems: "center", padding: 48 }}>
                  <Text style={{ fontSize: 48 }}>🔍</Text>
                  <Text style={[s.bold, { fontSize: 16, marginTop: 12 }]}>No items match "{searchQuery}"</Text>
                  <Text style={{ color: T.textSoft, fontSize: 13, marginTop: 6 }}>Try a different search.</Text>
                  <TouchableOpacity onPress={() => setSearchQuery("")} style={[s.btnSecondary, { marginTop: 14, paddingHorizontal: 16 }]}>
                    <Text style={{ color: T.accent, fontWeight: "600" }}>Clear search</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ alignItems: "center", padding: 48 }}>
                  <Text style={{ fontSize: 48 }}>🧊</Text>
                  <Text style={[s.bold, { fontSize: 18, marginTop: 12 }]}>Your fridge is empty!</Text>
                  <Text style={{ color: T.textSoft, fontSize: 14, marginTop: 6 }}>Tap + to add your first item.</Text>
                </View>
              )
            )}
            {filtered.map(item => {
              const days = daysUntil(item.expiryDate); const color = expiryColor(days);
              const isSelected = selectedIds.has(item.id);
              return (
                <SwipeableRow
                  key={item.id}
                  disabled={selectMode}
                  onSwipeRight={() => { onUse(item.id, null); track("item_swipe_use_all"); }}
                  onSwipeLeft={() => {
                    Alert.alert(
                      `Delete ${item.name}?`,
                      "This can't be undone.",
                      [
                        { text: "Cancel", style: "cancel" },
                        { text: "Delete", style: "destructive", onPress: () => { onDelete(item.id); track("item_swipe_delete"); } },
                      ]
                    );
                  }}
                >
                  <TouchableOpacity
                    style={[s.fridgeItem, { marginHorizontal: 0, marginBottom: 0 }, isSelected && { borderColor: T.accent, borderWidth: 2 }]}
                    onPress={() => selectMode ? toggleSelected(item.id) : setSelectedItem(item)}
                    onLongPress={() => { if (!selectMode) { setSelectMode(true); toggleSelected(item.id); } }}
                    activeOpacity={0.7}
                  >
                    {selectMode ? (
                      <View style={{ width: 44, alignItems: "center" }}>
                        <Ionicons name={isSelected ? "checkmark-circle" : "ellipse-outline"} size={26} color={isSelected ? T.accent : T.muted} />
                      </View>
                    ) : (
                      <Text style={{ fontSize: 32, width: 44, textAlign: "center" }}>{item.emoji}</Text>
                    )}
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={s.itemName} numberOfLines={1}>{item.name}</Text>
                      <Text style={s.itemMeta}>{item.category} · {formatQty(item)}</Text>
                      {item.barcode && <Text style={[s.monoText, { color: T.muted, fontSize: 10, marginTop: 2 }]}>#{item.barcode}</Text>}
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 8 }}>
                      <View style={[s.expiryBadge, { backgroundColor: color + "22", borderColor: color + "55" }]}><Text style={[s.expiryText, { color }]}>{days <= 0 ? "Expired" : days === 1 ? "1 day" : `${days}d`}</Text></View>
                      {!selectMode && <Text style={{ color: T.muted, fontSize: 12 }}>›</Text>}
                    </View>
                  </TouchableOpacity>
                </SwipeableRow>
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
  const [editedExpiryDays, setEditedExpiryDays] = useState("");
  const [editedOpenedDays, setEditedOpenedDays] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (selected) {
      setEditedExpiryDays(String(selected.defaultExpiry));
      // For packaged items, default to OPENED_DAYS_MAP for the category
      setEditedOpenedDays(isPackagedCategory(selected.category) ? String(OPENED_DAYS_MAP[selected.category] ?? 7) : "");
    }
  }, [selected]);
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
              <Text style={[s.bold, { fontSize: 18, textAlign: "center", marginTop: 10, lineHeight: 24 }]} numberOfLines={3} adjustsFontSizeToFit>{selected.name}</Text>
              <View style={[s.pill, { marginTop: 10 }]}><Text style={s.pillText}>{selected.category}</Text></View>
            </View>
            <View style={{ backgroundColor: T.surface, borderRadius: 12, padding: 14 }}>
              <Text style={[s.inputLabel, { marginBottom: 8 }]}>{isPackagedCategory(selected.category) ? "Expires (unopened)" : "Expires in"}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <TouchableOpacity
                  onPress={() => setEditedExpiryDays(d => String(Math.max(1, (parseInt(d, 10) || 0) - 1)))}
                  style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontSize: 22, color: T.text, fontWeight: "600" }}>−</Text>
                </TouchableOpacity>
                <TextInput
                  value={editedExpiryDays}
                  onChangeText={t => setEditedExpiryDays(t.replace(/[^0-9]/g, "").slice(0, 4))}
                  keyboardType="number-pad"
                  selectTextOnFocus
                  style={{ flex: 1, fontSize: 20, fontWeight: "700", color: T.accent, textAlign: "center", borderWidth: 1, borderColor: T.border, borderRadius: 10, paddingVertical: 8, backgroundColor: "#FFFFFF" }}
                />
                <TouchableOpacity
                  onPress={() => setEditedExpiryDays(d => String(Math.min(9999, (parseInt(d, 10) || 0) + 1)))}
                  style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontSize: 22, color: T.text, fontWeight: "600" }}>+</Text>
                </TouchableOpacity>
                <Text style={{ color: T.textSoft, fontSize: 14, fontWeight: "600" }}>days</Text>
              </View>
              <Text style={{ color: T.muted, fontSize: 11, marginTop: 8 }}>Suggested for {selected.category}: {selected.defaultExpiry} days</Text>

              {isPackagedCategory(selected.category) && (
                <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: T.border }}>
                  <Text style={[s.inputLabel, { marginBottom: 8 }]}>Once opened, use within</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <TouchableOpacity
                      onPress={() => setEditedOpenedDays(d => String(Math.max(1, (parseInt(d, 10) || 0) - 1)))}
                      style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ fontSize: 22, color: T.text, fontWeight: "600" }}>−</Text>
                    </TouchableOpacity>
                    <TextInput
                      value={editedOpenedDays}
                      onChangeText={t => setEditedOpenedDays(t.replace(/[^0-9]/g, "").slice(0, 4))}
                      keyboardType="number-pad"
                      selectTextOnFocus
                      style={{ flex: 1, fontSize: 20, fontWeight: "700", color: T.warn, textAlign: "center", borderWidth: 1, borderColor: T.border, borderRadius: 10, paddingVertical: 8, backgroundColor: "#FFFFFF" }}
                    />
                    <TouchableOpacity
                      onPress={() => setEditedOpenedDays(d => String(Math.min(9999, (parseInt(d, 10) || 0) + 1)))}
                      style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ fontSize: 22, color: T.text, fontWeight: "600" }}>+</Text>
                    </TouchableOpacity>
                    <Text style={{ color: T.textSoft, fontSize: 14, fontWeight: "600" }}>days</Text>
                  </View>
                  <Text style={{ color: T.muted, fontSize: 11, marginTop: 8 }}>Applies once you mark this as opened.</Text>
                </View>
              )}
            </View>
          </View>
          <NutritionPanel nutrition={selected.nutrition} grade={selected.nutritionGrade} />
          {selected.ingredients && <View style={[s.card, { marginBottom: 12, padding: 14 }]}><Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 8, paddingHorizontal: 0 }]}>INGREDIENTS</Text><Text style={{ color: T.textSoft, fontSize: 12, lineHeight: 18 }}>{selected.ingredients}</Text></View>}
          <TouchableOpacity style={[s.btnPrimary, { marginBottom: 10 }]} onPress={() => {
            const closed = parseInt(editedExpiryDays, 10);
            const finalClosed = Number.isFinite(closed) && closed > 0 ? closed : selected.defaultExpiry;
            const opened = parseInt(editedOpenedDays, 10);
            const finalOpened = isPackagedCategory(selected.category) && Number.isFinite(opened) && opened > 0 ? opened : null;
            addToFridge({ ...selected, defaultExpiry: finalClosed, openedDays: finalOpened });
          }}><Text style={s.btnPrimaryText}>✅  Add to My Fridge</Text></TouchableOpacity>
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
function RemindersScreen({ items, notificationsEnabled, onToggleNotifications, emailDigestEnabled, onToggleEmailDigest }) {
  const [dismissed, setDismissed] = useState([]);
  const [reorderItem, setReorderItem] = useState(null);
  const autoReminders = items.filter(i => daysUntil(i.expiryDate) <= 3 && !dismissed.includes("auto-" + i.id)).map(i => ({ id: "auto-" + i.id, type: "toss", text: `Check ${i.name}`, detail: `Expires in ${Math.max(0, daysUntil(i.expiryDate))} day(s)`, time: formatDate(i.expiryDate), emoji: i.emoji, urgent: daysUntil(i.expiryDate) <= 1 }));
  const allReminders = [...autoReminders];
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

      {/* Reminders — push + email channels combined into one card so the
          "wait, are these the same thing?" confusion goes away. v1.0.9. */}
      <View style={[s.card, { margin: 16, padding: 16, marginBottom: 12 }]}>
        <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 14, paddingHorizontal: 0 }]}>REMINDERS</Text>
        <Text style={{ color: T.textSoft, fontSize: 12, marginBottom: 14 }}>
          One daily summary of what's expiring soon or already expired — at 9am. Pick where you want it.
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <View style={{ flex: 1 }}>
            <Text style={[s.bold, { fontSize: 14 }]}>Push to phone</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>iPhone notification with the day's summary.</Text>
          </View>
          <TouchableOpacity
            onPress={onToggleNotifications}
            style={{ width: 50, height: 28, borderRadius: 14, backgroundColor: notificationsEnabled ? T.accent : T.border, justifyContent: "center", padding: 3, marginLeft: 12 }}
          >
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: notificationsEnabled ? "flex-end" : "flex-start" }} />
          </TouchableOpacity>
        </View>

        <View style={{ height: 1, backgroundColor: T.border, marginBottom: 14 }} />

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <Text style={[s.bold, { fontSize: 14 }]}>Email to inbox</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Same summary, sent to your account email.</Text>
          </View>
          <TouchableOpacity
            onPress={onToggleEmailDigest}
            style={{ width: 50, height: 28, borderRadius: 14, backgroundColor: emailDigestEnabled ? T.accent : T.border, justifyContent: "center", padding: 3, marginLeft: 12 }}
          >
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: emailDigestEnabled ? "flex-end" : "flex-start" }} />
          </TouchableOpacity>
        </View>
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
                  <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Qty: {formatQty(i)} · {i.category}</Text>
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
// Ordered for the picker: blank ("no unit") first, then most-common, then
// US weight, metric weight, US volume, metric volume, packaged containers,
// and the grouped units last. Anything stored in fridge_items.unit that
// doesn't match a chip stays as-is — UnitPicker shows the raw value.
const UNIT_OPTIONS = [
  "",
  "count",
  // weight (US then metric)
  "oz", "lb", "g", "kg",
  // volume (US then metric)
  "fl oz", "cup", "pt", "qt", "gallon", "ml", "L",
  // packaged containers
  "pack", "box", "jar", "can", "bottle", "carton", "bag",
  // grouped
  "bunch", "dozen",
];

function UnitPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <TouchableOpacity
        style={[s.input, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}
        onPress={() => setOpen(true)}
      >
        <Text style={{ color: value ? T.text : T.muted, fontSize: 15 }}>{value || "—"}</Text>
        <Ionicons name="chevron-down" size={16} color={T.muted} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 }} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={{ backgroundColor: "#FFFFFF", borderRadius: 12, maxHeight: "70%" }}>
            <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
              {UNIT_OPTIONS.map(u => (
                <TouchableOpacity
                  key={u || "none"}
                  style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                  onPress={() => { onChange(u); setOpen(false); }}
                >
                  <Text style={{ color: T.text, fontSize: 16 }}>{u || "— (no unit)"}</Text>
                  {value === u && <Ionicons name="checkmark" size={18} color={T.accent} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function BulkAddModal({ visible, onClose, onAddItems, section }) {
  const emptyRow = () => ({ id: Date.now() + Math.random(), name: "", quantity: "1", unit: "", expiry: "" });
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
    const newRows = parsed
      .filter(item => item && typeof item.name === "string" && item.name.trim())
      .map(item => {
        const cat = guessCategory(item.name) !== "Other" ? guessCategory(item.name) : (item.category || "Other");
        // Defensive: receipt parser sometimes returns "fresh" or null for expiry_days
        const rawDays = item.expiry_days;
        const days = Number.isFinite(Number(rawDays)) && Number(rawDays) > 0
          ? Number(rawDays)
          : (EXPIRY_MAP[cat] || 7);
        const expiryDate = new Date(Date.now() + days * 86400000);
        const yyyy = expiryDate.getFullYear();
        const mm = String(expiryDate.getMonth() + 1).padStart(2, "0");
        const dd = String(expiryDate.getDate()).padStart(2, "0");
        // Split "2 lbs" → amount "2", unit "lbs". Falls back to amount only.
        const qStr = String(item.quantity || "1").trim();
        const qMatch = qStr.match(/^([\d.]+)\s*(.*)$/);
        const amount = qMatch ? qMatch[1] : qStr;
        const unit = qMatch && qMatch[2] ? qMatch[2].trim() : "";
        return {
          id: Date.now() + Math.random(),
          name: item.name.trim(),
          quantity: amount || "1",
          unit: unit,
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
      // Parse expiry safely; bad strings fall back to category default
      let expiry;
      const trimmed = (r.expiry || "").trim();
      const parsed = trimmed ? new Date(trimmed) : null;
      if (parsed && !Number.isNaN(parsed.getTime())) {
        expiry = parsed.toISOString();
      } else {
        expiry = new Date(Date.now() + defaultDays * 86400000).toISOString();
      }
      // v1.0.9 — quantity is an integer column; coerce to int with fallback
      // to 1. Same fix that landed in AddModal earlier.
      const parsedQty = parseInt((r.quantity || "").trim(), 10);
      const quantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;
      // For packaged categories, default-to-closed and stash opened-days +
      // expiry-unopened so "Mark as opened" works on these rows later.
      const packaged = isPackagedCategory(cat);
      return {
        name: r.name.trim(),
        category: cat,
        emoji: EMOJI_MAP[cat],
        quantity,
        unit: (r.unit || "").trim() || null,
        expiryDate: expiry,
        section: section || "fridge",
        isOpened: false,
        openedAt: null,
        expiryOpenedDays: packaged ? (OPENED_DAYS_MAP[cat] || 7) : null,
        expiryUnopened: packaged ? expiry.slice(0, 10) : null,
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
                    <View style={{ flex: 0.7 }}>
                      <Text style={s.inputLabel}>Amount</Text>
                      <TextInput
                        style={s.input}
                        placeholder="2"
                        placeholderTextColor={T.muted}
                        value={row.quantity}
                        onChangeText={v => updateRow(row.id, "quantity", v)}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.inputLabel}>Unit</Text>
                      <UnitPicker
                        value={row.unit}
                        onChange={v => updateRow(row.id, "unit", v)}
                      />
                    </View>
                    <View style={{ flex: 1.4 }}>
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

// ─── Household Onboarding Modal (v1.0.8) ──────────────────────────────────────
//
// Two-step intro: name your household → pick first container. Shown once per
// user, gated by user_settings.has_seen_household_onboarding. Existing testers
// see it on the v1.0.8 update; new users see it after first sign-in. The
// chosen container is informational for v1.0.8 (all items still default to
// 'fridge') but is stored as a default so future "add item" prompts can
// pre-select it.
const ONBOARDING_DEFAULT_CONTAINER_KEY = "ok2eat:default_container";
// v1.0.10 — first-run tour. Set after the user completes the 3-card tour
// (or skips). We never show the tour again once this is set, even after a
// reinstall (would need an explicit reset).
const TOUR_SEEN_KEY = "ok2eat:tourSeen_v1";

function OnboardingModal({ visible, initialName, onComplete }) {
  // v1.0.9 — `phase` replaces a numeric step. Forks early between joining
  // an existing household and creating a new one, so users with an invite
  // code don't get stuck creating a junk household first.
  //   "fork"      — initial choice between join / create
  //   "join"      — enter invite code
  //   "name"      — name your new household (create path, step 1)
  //   "container" — pick first container (create path, step 2)
  const [phase, setPhase] = useState("fork");
  const [name, setName] = useState(initialName || "My household");
  const [container, setContainer] = useState("fridge");
  const [joinCode, setJoinCode] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setPhase("fork");
      setName(initialName || "My household");
      setContainer("fridge");
      setJoinCode("");
      setSaving(false);
    }
  }, [visible, initialName]);

  const containers = [
    { id: "fridge",  label: "Fridge",  hint: "Dairy, produce, leftovers" },
    { id: "pantry",  label: "Pantry",  hint: "Dry goods, canned" },
    { id: "freezer", label: "Freezer", hint: "Frozen meats, ice cream" },
  ];

  async function markOnboarded() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in");
    await supabase.from("user_settings").upsert({
      user_id: user.id,
      has_seen_household_onboarding: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    return user;
  }

  async function finishCreate() {
    if (saving) return;
    setSaving(true);
    try {
      await markOnboarded();
      const { data: hhId, error: rpcErr } = await supabase.rpc("ensure_household_for_user");
      if (rpcErr) throw rpcErr;

      const trimmed = (name || "").trim();
      if (hhId && trimmed) {
        await supabase.from("households").update({ name: trimmed }).eq("id", hhId);
      }
      try { await AsyncStorage.setItem(ONBOARDING_DEFAULT_CONTAINER_KEY, container); } catch {}

      track("household_onboarding_completed", { path: "create", container });
      onComplete({ householdId: hhId, householdName: trimmed, defaultContainer: container });
    } catch (e) {
      Alert.alert("Setup error", e?.message || "Couldn't save your setup. Please try again.");
      setSaving(false);
    }
  }

  async function finishJoin() {
    if (saving) return;
    const trimmed = (joinCode || "").trim().toUpperCase();
    if (trimmed.length !== 6) {
      Alert.alert("Invalid code", "Invite codes are 6 characters.");
      return;
    }
    setSaving(true);
    try {
      const { data: hhId, error: rpcErr } = await supabase.rpc("redeem_household_invite", { p_code: trimmed });
      if (rpcErr) throw rpcErr;
      await markOnboarded();
      track("household_onboarding_completed", { path: "join" });
      onComplete({ householdId: hhId });
    } catch (e) {
      Alert.alert("Couldn't join", e?.message || "Check the code and try again.");
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
        <View style={{ flex: 1, padding: 20, justifyContent: "space-between" }}>
          <View>
            {phase === "fork" && (
              <>
                <Text style={{ fontSize: 12, color: T.accent, fontWeight: "600", marginBottom: 14 }}>
                  Welcome to ok2eat
                </Text>
                <Text style={{ fontSize: 24, fontWeight: "800", color: T.text, letterSpacing: -0.5 }}>
                  Let's get you set up
                </Text>
                <Text style={{ fontSize: 13, color: T.textSoft, marginTop: 6, marginBottom: 28 }}>
                  Joining someone else's fridge, or starting your own?
                </Text>

                <TouchableOpacity
                  onPress={() => setPhase("join")}
                  style={{
                    flexDirection: "row", alignItems: "center", padding: 16,
                    backgroundColor: T.card, borderWidth: 1, borderColor: T.border,
                    borderRadius: 14, marginBottom: 12,
                  }}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(22,163,74,0.1)", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="key-outline" size={20} color={T.accent} />
                  </View>
                  <View style={{ marginLeft: 14, flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: T.text }}>I have an invite code</Text>
                    <Text style={{ fontSize: 12, color: T.textSoft, marginTop: 2 }}>Join an existing shared fridge</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={T.muted} />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setPhase("name")}
                  style={{
                    flexDirection: "row", alignItems: "center", padding: 16,
                    backgroundColor: T.card, borderWidth: 1, borderColor: T.border,
                    borderRadius: 14,
                  }}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(22,163,74,0.1)", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="home-outline" size={20} color={T.accent} />
                  </View>
                  <View style={{ marginLeft: 14, flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: T.text }}>Start a new household</Text>
                    <Text style={{ fontSize: 12, color: T.textSoft, marginTop: 2 }}>You can invite family later</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={T.muted} />
                </TouchableOpacity>
              </>
            )}

            {phase === "join" && (
              <>
                <Text style={{ fontSize: 12, color: T.accent, fontWeight: "600", marginBottom: 14 }}>
                  Join a household
                </Text>
                <Text style={{ fontSize: 24, fontWeight: "800", color: T.text, letterSpacing: -0.5 }}>
                  Enter your invite code
                </Text>
                <Text style={{ fontSize: 13, color: T.textSoft, marginTop: 6, marginBottom: 22 }}>
                  Six characters. Whoever invited you sent it via text, email, or a link.
                </Text>
                <Text style={s.inputLabel}>Invite code</Text>
                <TextInput
                  style={[s.input, { letterSpacing: 4, textTransform: "uppercase", fontSize: 18, fontWeight: "700" }]}
                  value={joinCode}
                  onChangeText={t => setJoinCode(t.toUpperCase())}
                  placeholder="ABC123"
                  placeholderTextColor={T.muted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={6}
                />
                <Text style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>
                  No code yet? Tap Back and start your own household.
                </Text>
              </>
            )}

            {phase === "name" && (
              <>
                <Text style={{ fontSize: 12, color: T.accent, fontWeight: "600", marginBottom: 14 }}>
                  Step 1 of 2
                </Text>
                <Text style={{ fontSize: 24, fontWeight: "800", color: T.text, letterSpacing: -0.5 }}>
                  Name your household
                </Text>
                <Text style={{ fontSize: 13, color: T.textSoft, marginTop: 6, marginBottom: 22 }}>
                  You can invite others later. One household per person.
                </Text>
                <Text style={s.inputLabel}>Household name</Text>
                <TextInput
                  style={s.input}
                  value={name}
                  onChangeText={setName}
                  placeholder='e.g. "The Smiths", "Apt 4B"'
                  placeholderTextColor={T.muted}
                  autoCapitalize="words"
                  maxLength={60}
                />
                <Text style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>
                  Examples: "Smith Family", "Jess + Greg"
                </Text>
              </>
            )}

            {phase === "container" && (
              <>
                <Text style={{ fontSize: 12, color: T.accent, fontWeight: "600", marginBottom: 14 }}>
                  Step 2 of 2
                </Text>
                <Text style={{ fontSize: 24, fontWeight: "800", color: T.text, letterSpacing: -0.5 }}>
                  Where will you start?
                </Text>
                <Text style={{ fontSize: 13, color: T.textSoft, marginTop: 6, marginBottom: 22 }}>
                  Pick one. You can add more later in Manage Inventory.
                </Text>
                {containers.map(c => {
                  const selected = container === c.id;
                  return (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => setContainer(c.id)}
                      style={{
                        flexDirection: "row", alignItems: "center", padding: 14,
                        backgroundColor: T.card,
                        borderWidth: selected ? 2 : 1,
                        borderColor: selected ? T.accent : T.border,
                        borderRadius: 14, marginBottom: 10,
                      }}
                    >
                      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(22,163,74,0.1)", alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ fontSize: 14, fontWeight: "700", color: T.accent }}>{c.label[0]}</Text>
                      </View>
                      <View style={{ marginLeft: 12, flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: "600", color: T.text }}>{c.label}</Text>
                        <Text style={{ fontSize: 12, color: T.textSoft, marginTop: 2 }}>{c.hint}</Text>
                      </View>
                      {selected && (
                        <Ionicons name="checkmark-circle" size={22} color={T.accent} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </View>

          <View>
            {phase === "fork" && (
              <Text style={{ textAlign: "center", color: T.muted, fontSize: 12, paddingVertical: 12 }}>
                You can switch later from the Share tab.
              </Text>
            )}

            {phase === "join" && (
              <>
                <TouchableOpacity
                  style={[s.btnPrimary, (joinCode.trim().length !== 6 || saving) && { opacity: 0.5 }]}
                  disabled={joinCode.trim().length !== 6 || saving}
                  onPress={finishJoin}
                >
                  <Text style={s.btnPrimaryText}>{saving ? "Joining…" : "Join household"}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ alignItems: "center", paddingVertical: 12, marginTop: 6 }}
                  onPress={() => setPhase("fork")}
                  disabled={saving}
                >
                  <Text style={{ color: T.textSoft, fontSize: 14 }}>Back</Text>
                </TouchableOpacity>
              </>
            )}

            {phase === "name" && (
              <>
                <TouchableOpacity
                  style={[s.btnPrimary, (!name.trim() || saving) && { opacity: 0.5 }]}
                  disabled={!name.trim() || saving}
                  onPress={() => setPhase("container")}
                >
                  <Text style={s.btnPrimaryText}>Continue</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ alignItems: "center", paddingVertical: 12, marginTop: 6 }}
                  onPress={() => setPhase("fork")}
                  disabled={saving}
                >
                  <Text style={{ color: T.textSoft, fontSize: 14 }}>Back</Text>
                </TouchableOpacity>
              </>
            )}

            {phase === "container" && (
              <>
                <TouchableOpacity
                  style={[s.btnPrimary, saving && { opacity: 0.6 }]}
                  disabled={saving}
                  onPress={finishCreate}
                >
                  <Text style={s.btnPrimaryText}>{saving ? "Saving…" : "Get started"}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ alignItems: "center", paddingVertical: 12, marginTop: 6 }}
                  onPress={() => setPhase("name")}
                  disabled={saving}
                >
                  <Text style={{ color: T.textSoft, fontSize: 14 }}>Back</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Container helpers (v1.0.8) ───────────────────────────────────────────────
const CONTAINERS = [
  { id: "fridge",  label: "Fridge",  hint: "Dairy, produce, leftovers" },
  { id: "pantry",  label: "Pantry",  hint: "Dry goods, canned" },
  { id: "freezer", label: "Freezer", hint: "Frozen meats, ice cream" },
];
const CONTAINER_LABEL = { fridge: "Fridge", pantry: "Pantry", freezer: "Freezer" };

// ─── Shopping list helpers (v1.0.8) ───────────────────────────────────────────
// Local-only for v1.0.8 — stored as a JSON array under one AsyncStorage key.
// Each entry: { id, name, checked }. We can graduate to a Supabase table in
// v1.0.9 once we know what users actually do with it.
const SHOPPING_LIST_KEY = "ok2eat:shopping_list:v1";
async function loadShoppingList() {
  try {
    const raw = await AsyncStorage.getItem(SHOPPING_LIST_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
async function saveShoppingList(list) {
  try { await AsyncStorage.setItem(SHOPPING_LIST_KEY, JSON.stringify(list)); } catch {}
}

// ─── Manage Inventory Modal (v1.0.8) ──────────────────────────────────────────
// Shows the household name, the three containers with item counts, and the
// member list. Members come from the list_household_members RPC because RLS
// only lets a user read their own household_members row.
function ManageInventoryModal({ visible, onClose, items, householdName, onOpenInvite }) {
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setLoadingMembers(true);
      try {
        const { data, error } = await supabase.rpc("list_household_members");
        if (!cancelled) setMembers(error ? [] : (data || []));
      } catch { if (!cancelled) setMembers([]); }
      finally { if (!cancelled) setLoadingMembers(false); }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const counts = { fridge: 0, pantry: 0, freezer: 0 };
  for (const i of items || []) {
    const c = i.container || "fridge";
    if (counts[c] !== undefined) counts[c] += 1;
  }

  function initials(email) {
    if (!email) return "·";
    const local = email.split("@")[0];
    return (local[0] || "?").toUpperCase();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: T.border }}>
          <TouchableOpacity onPress={onClose} style={{ paddingRight: 14, paddingVertical: 4 }}>
            <Ionicons name="chevron-back" size={24} color={T.accent} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: T.text }}>Manage inventory</Text>
            <Text style={{ fontSize: 12, color: T.textSoft, marginTop: 2 }}>
              {householdName || "Your household"} · {members.length || 1} {members.length === 1 ? "member" : "members"}
            </Text>
          </View>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          <Text style={s.sectionLabel}>// CONTAINERS</Text>
          {CONTAINERS.map(c => (
            <View key={c.id} style={{ flexDirection: "row", alignItems: "center", padding: 14, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14, marginBottom: 10, marginHorizontal: 16 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(22,163,74,0.1)", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: T.accent }}>{c.label[0]}</Text>
              </View>
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: "600", color: T.text }}>{c.label}</Text>
                <Text style={{ fontSize: 12, color: T.textSoft, marginTop: 2 }}>
                  {counts[c.id]} {counts[c.id] === 1 ? "item" : "items"}
                </Text>
              </View>
            </View>
          ))}

          <Text style={[s.sectionLabel, { marginTop: 8 }]}>// MEMBERS</Text>
          <View style={{ marginHorizontal: 16 }}>
            {loadingMembers ? (
              <View style={{ padding: 16, alignItems: "center" }}>
                <ActivityIndicator color={T.accent} size="small" />
              </View>
            ) : members.length === 0 ? (
              <View style={{ padding: 14, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14 }}>
                <Text style={{ fontSize: 13, color: T.textSoft }}>Just you for now — invite someone to share your fridge.</Text>
              </View>
            ) : (
              members.map(m => (
                <View key={m.user_id} style={{ flexDirection: "row", alignItems: "center", padding: 14, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14, marginBottom: 8 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(22,163,74,0.1)", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: T.accent }}>{initials(m.email)}</Text>
                  </View>
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: T.text }}>{m.email}</Text>
                    <Text style={{ fontSize: 11, color: T.textSoft, marginTop: 2 }}>
                      {m.is_owner ? "Owner" : "Member"}
                    </Text>
                  </View>
                </View>
              ))
            )}
            <TouchableOpacity
              style={[s.btnPrimary, { marginTop: 8 }]}
              onPress={() => { onClose(); setTimeout(onOpenInvite, 250); }}
            >
              <Text style={s.btnPrimaryText}>Invite a family member</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Invite Household Modal (v1.0.8) ──────────────────────────────────────────
// The "share fridge" flow. Two halves: generate an invite code (calls
// create_household_invite RPC) and redeem one (calls redeem_household_invite).
// Codes are 6 chars, valid 7 days. Joining replaces the user's current
// household — we warn before redeeming.
function InviteHouseholdModal({ visible, onClose, householdId, householdName, onJoined }) {
  const [code, setCode] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [redeemInput, setRedeemInput] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    if (!visible) { setCode(null); setRedeemInput(""); }
  }, [visible]);

  async function generateCode() {
    if (!householdId) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.rpc("create_household_invite", { p_household_id: householdId });
      if (error) throw error;
      setCode(data);
      track("household_invite_created");
    } catch (e) {
      Alert.alert("Couldn't create invite", e?.message || "Try again in a moment.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleShareCode() {
    if (!code) return;
    try {
      // Link recipients to the ok2eat.com/join landing page with the code as
      // a query param. The page displays the code prominently, has an App
      // Store install button, and walks them through "Share → Invite a
      // family member → enter code" if they already have the app. Much
      // clearer than just dumping a 6-char string in their inbox.
      const joinUrl = `https://ok2eat.com/join?code=${code}`;
      await Share.share({
        message: `Join my ok2eat household — your invite code is ${code}.\n\nTap to start: ${joinUrl}`,
      });
    } catch {}
  }

  async function copyCode() {
    if (!code) return;
    try {
      const Clipboard = (await import("expo-clipboard").catch(() => null))?.default;
      if (Clipboard?.setStringAsync) await Clipboard.setStringAsync(code);
      Alert.alert("Copied", "Invite code copied to clipboard.");
    } catch {
      Alert.alert("Copy", "Long-press the code to copy.");
    }
  }

  function confirmRedeem() {
    const trimmed = (redeemInput || "").trim().toUpperCase();
    if (trimmed.length !== 6) {
      Alert.alert("Invalid code", "Codes are 6 characters.");
      return;
    }
    Alert.alert(
      "Join this household?",
      "You'll lose access to your current household and its items. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Join", style: "destructive", onPress: () => doRedeem(trimmed) },
      ],
    );
  }

  async function doRedeem(trimmed) {
    setRedeeming(true);
    try {
      const { data: newHhId, error } = await supabase.rpc("redeem_household_invite", { p_code: trimmed });
      if (error) throw error;
      track("household_invite_redeemed");
      onJoined?.(newHhId);
      onClose();
    } catch (e) {
      Alert.alert("Couldn't join", e?.message || "Check the code and try again.");
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: T.border }}>
          <TouchableOpacity onPress={onClose} style={{ paddingRight: 14, paddingVertical: 4 }}>
            <Ionicons name="chevron-back" size={24} color={T.accent} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: T.text }}>Invite a family member</Text>
            <Text style={{ fontSize: 12, color: T.textSoft, marginTop: 2 }}>Equal access — they see and edit everything.</Text>
          </View>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          <Text style={s.sectionLabel}>// YOUR INVITE CODE</Text>
          <View style={[s.card, { padding: 22, alignItems: "center", marginHorizontal: 16, marginBottom: 12 }]}>
            {code ? (
              <>
                <Text selectable style={[s.monoText, { fontSize: 28, fontWeight: "700", color: T.text, letterSpacing: 4, marginBottom: 6 }]}>
                  {code}
                </Text>
                <Text style={{ fontSize: 11, color: T.textSoft }}>Expires in 7 days</Text>
              </>
            ) : (
              <Text style={{ fontSize: 13, color: T.textSoft, textAlign: "center" }}>
                Generate a 6-character code and share it with someone in your household.
              </Text>
            )}
          </View>

          {code ? (
            <View style={{ flexDirection: "row", gap: 10, marginHorizontal: 16, marginBottom: 12 }}>
              <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={copyCode}>
                <Text style={s.btnSecondaryText}>Copy code</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btnPrimary, { flex: 1 }]} onPress={handleShareCode}>
                <Text style={s.btnPrimaryText}>Share link</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[s.btnPrimary, { marginHorizontal: 16, marginBottom: 12, opacity: generating ? 0.6 : 1 }]}
              disabled={generating}
              onPress={generateCode}
            >
              <Text style={s.btnPrimaryText}>{generating ? "Generating…" : "Generate invite code"}</Text>
            </TouchableOpacity>
          )}

          <Text style={[s.sectionLabel, { marginTop: 8 }]}>// HAVE A CODE?</Text>
          <View style={{ flexDirection: "row", gap: 8, marginHorizontal: 16 }}>
            <TextInput
              style={[s.input, { flex: 1, marginBottom: 0, letterSpacing: 2, textTransform: "uppercase" }]}
              value={redeemInput}
              onChangeText={t => setRedeemInput(t.toUpperCase())}
              placeholder="ENTER CODE"
              placeholderTextColor={T.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
            />
            <TouchableOpacity
              style={[s.btnPrimary, { paddingHorizontal: 18, opacity: redeeming || redeemInput.trim().length !== 6 ? 0.5 : 1 }]}
              disabled={redeeming || redeemInput.trim().length !== 6}
              onPress={confirmRedeem}
            >
              <Text style={s.btnPrimaryText}>{redeeming ? "…" : "Join"}</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 11, color: T.muted, marginTop: 8, marginHorizontal: 16 }}>
            Joining replaces your current household.
          </Text>

          <View style={{ height: 32 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// Compact +/- stepper used by AddModal for editable expiry-day inputs.
// Min/max clamp to keep nonsense out of the int column.
// v1.0.10 — number is now an editable TextInput so users can type a value
// directly (e.g. 90 days for canned goods, faster than tapping + ninety
// times). +/- buttons still adjust it.
function DayStepper({ value, onChange, min = 0, max = 365, label, suffix = "days" }) {
  const set = (v) => {
    const num = typeof v === "number" ? v : parseInt(v, 10);
    if (!Number.isFinite(num)) return;
    onChange(Math.max(min, Math.min(max, num)));
  };
  return (
    <View style={{ marginBottom: 12 }}>
      {label && <Text style={[s.inputLabel, { marginBottom: 6 }]}>{label}</Text>}
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 6 }}>
        <TouchableOpacity onPress={() => set(value - 1)} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="remove" size={20} color={value <= min ? T.muted : T.accent} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <TextInput
            value={String(value)}
            onChangeText={(t) => {
              if (t === "") return;             // allow temporary empty while editing
              const n = parseInt(t.replace(/[^0-9]/g, ""), 10);
              if (Number.isFinite(n)) set(n);
            }}
            onBlur={() => { if (!Number.isFinite(value)) set(min); }}
            keyboardType="number-pad"
            selectTextOnFocus
            /* v1.13 — share AddModal's Done accessory so numeric keyboard is dismissable.
               Only used inside AddModal currently; if reused elsewhere later, hoist
               the InputAccessoryView to App root and update this ID. */
            inputAccessoryViewID={Platform.OS === "ios" ? "addModalDone" : undefined}
            style={{ fontSize: 16, fontWeight: "700", color: T.text, textAlign: "center", padding: 0, minWidth: 40 }}
          />
          <Text style={{ fontSize: 11, color: T.textSoft, marginTop: -2 }}>{suffix}</Text>
        </View>
        <TouchableOpacity onPress={() => set(value + 1)} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="add" size={20} color={value >= max ? T.muted : T.accent} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── ExpiryDateField (v1.1.0) ─────────────────────────────────────────────────
// Tappable date hint that converts to a YYYY-MM-DD editor on tap. Two-way
// bound with the parent's `days` prop: when the user types a new date we
// compute days-from-today and call onDaysChange; when `days` changes from
// the stepper we re-derive the date display. Direct response to user
// feedback: "you should be able to put in an actual date instead of number
// of days till expiration."
function ExpiryDateField({ days, onDaysChange }) {
  const [editing, setEditing] = useState(false);
  // Derived date string from days (YYYY-MM-DD)
  const targetDate = new Date(Date.now() + days * 86400000);
  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, "0");
  const dd = String(targetDate.getDate()).padStart(2, "0");
  const isoStr = `${yyyy}-${mm}-${dd}`;
  const [draft, setDraft] = useState(isoStr);
  // Friendly format for the hint: "May 4, 2026"
  const friendly = targetDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // Keep the draft in sync when the stepper changes `days` and we're not editing.
  useEffect(() => { if (!editing) setDraft(isoStr); }, [isoStr, editing]);

  function commit() {
    // Parse YYYY-MM-DD and convert to days-from-today.
    const m = (draft || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) { setDraft(isoStr); setEditing(false); return; }
    const picked = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(picked.getTime())) { setDraft(isoStr); setEditing(false); return; }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    picked.setHours(0, 0, 0, 0);
    const diffDays = Math.round((picked.getTime() - today.getTime()) / 86400000);
    if (diffDays < 1) { setDraft(isoStr); setEditing(false); return; }
    onDaysChange?.(diffDays);
    setEditing(false);
    track("addmodal_date_used", { days: diffDays });
  }

  if (editing) {
    return (
      <View style={{ marginTop: -6, marginBottom: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: 11, color: T.textSoft }}>Date:</Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={commit}
          onSubmitEditing={commit}
          autoFocus
          placeholder="YYYY-MM-DD"
          placeholderTextColor={T.muted}
          keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
          autoCorrect={false}
          style={{ flex: 1, fontSize: 13, color: T.text, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 8 }}
        />
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={() => { setDraft(isoStr); setEditing(true); }}
      hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
      style={{ marginTop: -6, marginBottom: 12, alignSelf: "flex-start", paddingVertical: 4, paddingHorizontal: 6 }}
    >
      <Text style={{ fontSize: 11, color: T.textSoft }}>
        Goes bad {friendly}{" "}
        <Text style={{ color: T.accent, fontWeight: "600" }}>· tap to pick a date</Text>
      </Text>
    </TouchableOpacity>
  );
}

// ─── Add Item Modal ───────────────────────────────────────────────────────────
function AddModal({ visible, onClose, onAdd, onBulkAdd, onGoToScan, onScanReceipt, section, recentItems }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Other");
  const [initialQty, setInitialQty] = useState("");
  const [initialUnit, setInitialUnit] = useState("");
  // v1.0.9 — expiration is now editable in the form. closedDays = days from
  // today the item lasts UNOPENED (or just "lasts" for fresh items).
  // openedDays = how many days after opening the item is still good. Both
  // default from category maps; user can override.
  const [closedDays, setClosedDays] = useState(EXPIRY_MAP["Other"] || 7);
  const [openedDays, setOpenedDays] = useState(OPENED_DAYS_MAP["Other"] || 7);
  const categories = ["Dairy", "Protein", "Produce", "Dry Goods", "Beverages", "Other"];
  const emojiMap = { Dairy: "🥛", Protein: "🍗", Produce: "🥬", "Dry Goods": "🥣", Beverages: "🍶", Other: "📦" };

  // Reset all fields when the modal opens. Avoids stale state from a prior add.
  useEffect(() => {
    if (visible) {
      setName(""); setCategory("Other"); setInitialQty(""); setInitialUnit("");
      setClosedDays(EXPIRY_MAP["Other"] || 7);
      setOpenedDays(OPENED_DAYS_MAP["Other"] || 7);
    }
  }, [visible]);

  // When the user picks a different category, snap the day defaults to that
  // category's typical shelf life so they don't have to remember it.
  function handleCategoryChange(c) {
    setCategory(c);
    setClosedDays(EXPIRY_MAP[c] || 7);
    setOpenedDays(OPENED_DAYS_MAP[c] || 7);
  }

  function handleAdd() {
    if (!name.trim()) return;
    const parsed = parseInt((initialQty || "").trim(), 10);
    const quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    const unit = (initialUnit || "").trim() || null;

    // Closed-expiry date = today + closedDays. We always store this as the
    // active expiry (default-to-closed per spec). For packaged categories
    // we ALSO store opened-shelf-life days + a snapshot of the closed expiry
    // so "Mark as opened" / "Undo" round-trips cleanly later.
    const expiryDateIso = new Date(Date.now() + closedDays * 86400000).toISOString();
    const packaged = isPackagedCategory(category);

    onAdd({
      name: name.trim(),
      category,
      emoji: emojiMap[category],
      quantity,
      unit,
      expiryDate: expiryDateIso,
      section,
      isOpened: false,
      openedAt: null,
      expiryOpenedDays: packaged ? openedDays : null,
      expiryUnopened: packaged ? expiryDateIso.slice(0, 10) : null,
    });
    onClose();
  }

  // v1.0.10 — one-tap re-add of a previously-added item. Uses the template's
  // category/quantity/unit, but recomputes expiry from the category default
  // (the original item's expiry is months stale by now in most cases).
  function handleQuickAdd(template) {
    const cat = template.category || "Other";
    const days = EXPIRY_MAP[cat] || 7;
    const expiryDateIso = new Date(Date.now() + days * 86400000).toISOString();
    const packaged = isPackagedCategory(cat);
    onAdd({
      name: template.name,
      category: cat,
      emoji: template.emoji || emojiMap[cat] || "📦",
      quantity: Number.isFinite(template.quantity) && template.quantity > 0 ? template.quantity : 1,
      unit: template.unit || null,
      expiryDate: expiryDateIso,
      section,
      isOpened: false,
      openedAt: null,
      expiryOpenedDays: packaged ? (OPENED_DAYS_MAP[cat] || 7) : null,
      expiryUnopened: packaged ? expiryDateIso.slice(0, 10) : null,
    });
    track("item_quick_added", { category: cat });
    onClose();
  }

  const packaged = isPackagedCategory(category);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.modalSheet}>
          {/* v1.13 — keyboard handling. Number-pad inputs (Amount field
              especially) were getting covered by the iOS keyboard with no
              auto-scroll. Same fix pattern as v1.11 PlanScreen. */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets={true}
            contentInsetAdjustmentBehavior="automatic"
          >
            <View style={s.sheetHandle} />
            <Text style={[s.bold, { fontSize: 20, marginBottom: 14 }]}>Add Item</Text>

            {/* v1.0.10 — Two prominent peer tiles for the fast-paths.
                Receipt scanning was previously buried inside "Add multiple
                items"; testers said they didn't realize it existed. */}
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: "rgba(22,163,74,0.08)", borderWidth: 1, borderColor: "rgba(22,163,74,0.25)", borderRadius: 14, padding: 14, alignItems: "center", gap: 6 }}
                onPress={() => { onClose(); setTimeout(() => onGoToScan && onGoToScan(), 350); }}
                accessibilityLabel="Scan barcode"
              >
                <Text style={{ fontSize: 28 }}>📷</Text>
                <Text style={[s.bold, { fontSize: 13, textAlign: "center" }]}>Scan Barcode</Text>
                <Text style={{ color: T.textSoft, fontSize: 11, textAlign: "center" }}>One product</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: "rgba(22,163,74,0.08)", borderWidth: 1, borderColor: "rgba(22,163,74,0.25)", borderRadius: 14, padding: 14, alignItems: "center", gap: 6 }}
                onPress={() => { onClose(); setTimeout(() => onScanReceipt && onScanReceipt(), 350); }}
                accessibilityLabel="Scan receipt"
              >
                <Text style={{ fontSize: 28 }}>🧾</Text>
                <Text style={[s.bold, { fontSize: 13, textAlign: "center" }]}>Scan Receipt</Text>
                <Text style={{ color: T.textSoft, fontSize: 11, textAlign: "center" }}>Whole grocery run</Text>
              </TouchableOpacity>
            </View>

            {/* v1.0.10 — Recently used quick-add. Most fridge restocking is
                repeat purchases, so kill the typing+stepper flow for the
                common case. */}
            {Array.isArray(recentItems) && recentItems.length > 0 && (
              <View style={{ marginBottom: 14 }}>
                <Text style={{ color: T.textSoft, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 8 }}>RECENTLY ADDED · TAP TO ADD AGAIN</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {recentItems.map((it, idx) => (
                    <TouchableOpacity
                      key={(it.name || "") + "_" + idx}
                      onPress={() => handleQuickAdd(it)}
                      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, marginRight: 8 }}
                    >
                      <Text style={{ fontSize: 16 }}>{it.emoji || "📦"}</Text>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: T.text, maxWidth: 140 }} numberOfLines={1}>{it.name}</Text>
                      <Text style={{ fontSize: 13, color: T.accent, fontWeight: "700" }}>+</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* "Or add manually" separator */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
              <Text style={{ color: T.muted, fontSize: 11, fontWeight: "600", letterSpacing: 0.5 }}>OR ADD MANUALLY</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
            </View>

            <Text style={s.inputLabel}>Item name *</Text>
            <TextInput style={s.input} placeholder="e.g. Almond Butter" placeholderTextColor={T.muted} value={name} onChangeText={setName} />

            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.inputLabel}>Amount</Text>
                <TextInput
                  style={s.input}
                  placeholder="e.g. 1"
                  placeholderTextColor={T.muted}
                  value={initialQty}
                  onChangeText={setInitialQty}
                  keyboardType="number-pad"
                  /* v1.13 — number-pad keyboards on iOS have no Return key,
                     so users had no way to dismiss the keyboard. Wire up an
                     accessory toolbar with a Done button (iOS only). */
                  inputAccessoryViewID={Platform.OS === "ios" ? "addModalDone" : undefined}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.inputLabel}>Unit</Text>
                <UnitPicker value={initialUnit} onChange={setInitialUnit} />
              </View>
            </View>
            {Platform.OS === "ios" && (
              <InputAccessoryView nativeID="addModalDone">
                <View style={{ backgroundColor: "#F4F4F5", borderTopWidth: 1, borderTopColor: T.border, paddingHorizontal: 12, paddingVertical: 8, alignItems: "flex-end" }}>
                  <TouchableOpacity onPress={() => Keyboard.dismiss()} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
                    <Text style={{ color: T.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
                  </TouchableOpacity>
                </View>
              </InputAccessoryView>
            )}

            <Text style={[s.inputLabel, { marginTop: 4 }]}>Category</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {categories.map(c => (
                <TouchableOpacity key={c} onPress={() => handleCategoryChange(c)} style={[s.chip, category === c && s.chipActive]}>
                  <Text style={[s.chipText, category === c && s.chipTextActive]}>{emojiMap[c]} {c}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <DayStepper
              value={closedDays}
              onChange={setClosedDays}
              min={1}
              label={packaged ? "Lasts (unopened)" : "Lasts"}
              suffix="days from today"
            />
            {/* v1.1.0 — tappable date hint that flips into a YYYY-MM-DD
                editor. Two-way bound with closedDays: tapping the date and
                editing it computes new days-from-today; stepper changes
                update the visible date. Direct response to user feedback
                that "days from today" forces mental date math. */}
            <ExpiryDateField
              days={closedDays}
              onDaysChange={setClosedDays}
            />

            {packaged && (
              <DayStepper
                value={openedDays}
                onChange={setOpenedDays}
                min={1}
                label="Once opened, lasts"
                suffix="more days"
              />
            )}

            <Text style={{ fontSize: 11, color: T.muted, marginBottom: 14 }}>
              {packaged
                ? "Item starts as unopened. Tap \"Mark as opened\" later to switch to the shorter shelf life."
                : "Fresh items don't change after opening — same expiry either way."}
            </Text>

            <TouchableOpacity style={s.btnPrimary} onPress={handleAdd}><Text style={s.btnPrimaryText}>Add to Fridge</Text></TouchableOpacity>
            {/* v1.13 — explicit Cancel button below Add. Tapping outside the
                modal sheet also closes it (overlay onPress=onClose), but
                testers reported feeling "stuck" inside the manual-add flow
                with no obvious escape hatch. */}
            <TouchableOpacity
              style={{ marginTop: 10, alignItems: "center", paddingVertical: 12 }}
              onPress={onClose}
              accessibilityLabel="Cancel and close add-item screen"
            >
              <Text style={{ color: T.textSoft, fontSize: 14, fontWeight: "600" }}>Cancel</Text>
            </TouchableOpacity>
            {/* v1.0.10 — kept as a low-emphasis link; "Scan Receipt" tile up
                top now opens the same multi-add screen, but the manual list
                workflow still has its own path for users who prefer it. */}
            <TouchableOpacity style={{ marginTop: 6, alignSelf: "center", paddingVertical: 6, paddingHorizontal: 12 }} onPress={() => { onClose(); setTimeout(() => onBulkAdd && onBulkAdd(), 350); }}>
              <Text style={{ color: T.textSoft, fontSize: 13, fontWeight: "500", textDecorationLine: "underline" }}>Add a list of items manually →</Text>
            </TouchableOpacity>
            <View style={{ height: 16 }} />
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Share Screen ─────────────────────────────────────────────────────────────
function ShareScreen({ householdName, memberCount, onOpenInvite, onBack }) {
  const APP_URL = "https://apps.apple.com/us/app/ok2eat/id6761730687";

  async function handleShareApp() {
    try {
      const result = await Share.share({
        message: "I've been using ok2eat to track my fridge and reduce food waste. Check it out! " + APP_URL,
        url: APP_URL,
        title: "Check out ok2eat!",
      });
      if (result.action === Share.sharedAction) track("share_app_tapped");
    } catch (e) { console.log(e); }
  }

  return (
    <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
      {/* v1.0.10 — back arrow because Share is no longer in the bottom nav. */}
      {onBack && (
        <TouchableOpacity
          onPress={onBack}
          style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={20} color={T.accent} />
          <Text style={{ color: T.accent, fontSize: 15, fontWeight: "600", marginLeft: 2 }}>Fridge</Text>
        </TouchableOpacity>
      )}
      <View style={s.headerRow}>
        <View>
          <Text style={s.pageTitle}>Share</Text>
          <Text style={s.pageSubtitle}>Tell friends about ok2eat or invite family to your fridge.</Text>
        </View>
      </View>

      {/* PRIMARY — spread the word */}
      <Text style={s.sectionLabel}>// SPREAD THE WORD</Text>
      <View style={[s.card, { marginHorizontal: 16, marginBottom: 16, padding: 4 }]}>
        <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 14 }} onPress={handleShareApp}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(22,163,74,0.1)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="share-outline" size={20} color={T.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.bold, { fontSize: 15 }]}>Share the app</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Send a link to friends</Text>
          </View>
          <Text style={{ color: T.muted, fontSize: 16 }}>›</Text>
        </TouchableOpacity>
        <View style={{ height: 1, backgroundColor: T.border, marginHorizontal: 14 }} />
        <TouchableOpacity
          style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 14 }}
          onPress={() => { track("review_link_tapped"); Linking.openURL(APP_URL); }}
        >
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(234,88,12,0.1)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="star-outline" size={20} color={T.warn} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.bold, { fontSize: 15 }]}>Leave a review</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Help others find ok2eat</Text>
          </View>
          <Text style={{ color: T.muted, fontSize: 16 }}>›</Text>
        </TouchableOpacity>
        <View style={{ height: 1, backgroundColor: T.border, marginHorizontal: 14 }} />
        <TouchableOpacity
          style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 14 }}
          onPress={() => { track("website_link_tapped"); Linking.openURL("https://ok2eat.com"); }}
        >
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(33,99,219,0.1)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="globe-outline" size={20} color="#2563EB" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.bold, { fontSize: 15 }]}>Visit ok2eat.com</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Tips, recipes, FAQ</Text>
          </View>
          <Text style={{ color: T.muted, fontSize: 16 }}>›</Text>
        </TouchableOpacity>
      </View>

      {/* SECONDARY — your household */}
      <Text style={s.sectionLabel}>// YOUR HOUSEHOLD</Text>
      <View style={[s.card, { marginHorizontal: 16, marginBottom: 16, padding: 4 }]}>
        <TouchableOpacity
          style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 14 }}
          onPress={onOpenInvite}
        >
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(22,163,74,0.1)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="person-add-outline" size={20} color={T.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.bold, { fontSize: 15 }]}>Invite a family member</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Share your fridge with someone you live with</Text>
          </View>
          <Text style={{ color: T.muted, fontSize: 16 }}>›</Text>
        </TouchableOpacity>
        <View style={{ height: 1, backgroundColor: T.border, marginHorizontal: 14 }} />
        <View style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 10 }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(22,163,74,0.1)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="home-outline" size={14} color={T.accent} />
          </View>
          <Text style={{ flex: 1, fontSize: 13, color: T.textSoft }} numberOfLines={1}>
            {householdName || "Your household"} · {memberCount} {memberCount === 1 ? "member" : "members"}
          </Text>
        </View>
      </View>

      {/* TERTIARY — feedback. Was a Feedback button in the global app bar
          before v1.0.10; moved here so the app bar reads more cleanly. */}
      <Text style={s.sectionLabel}>// HELP US IMPROVE</Text>
      <View style={[s.card, { marginHorizontal: 16, marginBottom: 16, padding: 4 }]}>
        <TouchableOpacity
          style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 14 }}
          onPress={() => { track("feedback_tapped"); Linking.openURL("mailto:support@ok2eat.com?subject=ok2eat%20Feedback&body=Hi%20ok2eat%20team%2C%0A%0A"); }}
        >
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(22,163,74,0.1)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={T.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.bold, { fontSize: 15 }]}>Send feedback</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Bug, idea, anything — straight to our inbox</Text>
          </View>
          <Text style={{ color: T.muted, fontSize: 16 }}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ─── Plan Screen (v1.0.8) ─────────────────────────────────────────────────────
// Replaces the AI Recipes screen. Two sections:
//   1. Recipe ideas — search-link cards (AllRecipes / NYT Cooking / Epicurious)
//      seeded from the user's top fridge ingredients. No AI calls; this saves
//      tokens AND avoids per-user Anthropic costs.
//   2. Shopping list — local-only for v1.0.8, persisted via AsyncStorage.
//      Manual add + check-off. Auto-suggest from low inventory is on the
//      v1.0.9 roadmap.
function PlanScreen({ items, householdId }) {
  // v1.1.0 — multiple named shopping lists per household. The shopping_lists
  // table is the new canonical source. Each item has a list_id FK. Existing
  // households were backfilled by the migration to a single "Shopping list"
  // list, so v1.0.x users see the same single-list experience by default.
  const [lists, setLists] = useState([]);              // [{id,name,archived_at,item_count,unchecked_count}]
  const [activeListId, setActiveListId] = useState(null);
  const [list, setList] = useState([]);                // items in the active list
  const [adding, setAdding] = useState("");
  const [showOrderSheet, setShowOrderSheet] = useState(false);
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [showCreateList, setShowCreateList] = useState(false);
  const [newListName, setNewListName] = useState("");
  // v1.13 — bulk-add state. User taps "Add many", types one item per line
  // (or comma-separated), we parse + batch-insert.
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkText, setBulkText] = useState("");
  // v1.13 — checked items collapse to a "Got N" group at the bottom by default.
  // Tap the group header to expand and see / un-check / remove individual items.
  const [checkedExpanded, setCheckedExpanded] = useState(false);
  // v1.13 — recently-added names (shared across household). Mirrors the
  // fridge AddModal's recent-items chips. Computed from the most recent
  // unique items added by anyone in the household, capped at 6.
  const [recentShoppingNames, setRecentShoppingNames] = useState([]);
  // v1.13 — past lists. Archived lists show in a collapsed-by-default
  // section below the active lists. Tapping one offers to clone it into
  // a new active list — solves "Costco trip is usually the same 15 items."
  const [archivedLists, setArchivedLists] = useState([]);   // [{id,name,archived_at,item_count}]
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);
  // v1.1.0 — creator initial map: { user_id: "G" } from list_household_members
  // RPC. Used to render a small initial badge next to items so household
  // members can see who added what.
  const [memberInitials, setMemberInitials] = useState({});

  // Load household lists + members in parallel.
  async function loadLists() {
    if (!householdId) { setLists([]); setLoadingLists(false); return; }
    try {
      const { data, error } = await supabase
        .from("shopping_lists")
        .select("id, name, archived_at, created_by, created_at")
        .eq("household_id", householdId)
        .is("archived_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      setLists(data || []);
      // Auto-select if exactly one list exists — keeps the v1.0.x single-list
      // experience seamless for users who never create additional lists.
      if ((data || []).length === 1 && !activeListId) {
        setActiveListId(data[0].id);
      } else if ((data || []).length === 0 && !activeListId) {
        // Fallback: no lists at all (shouldn't happen post-migration). Stay
        // on picker view — user can tap "+ New list" to create one.
      }
    } catch (e) {
      console.warn("[plan] loadLists failed:", e?.message || e);
    } finally {
      setLoadingLists(false);
    }
  }

  async function loadMembers() {
    if (!householdId) { setMemberInitials({}); return; }
    try {
      const { data, error } = await supabase.rpc("list_household_members");
      if (error) throw error;
      const map = {};
      (data || []).forEach(m => {
        const local = (m.email || "").split("@")[0] || "";
        map[m.user_id] = (local[0] || "?").toUpperCase();
      });
      setMemberInitials(map);
    } catch (e) {
      // Non-fatal — initials are cosmetic. Silent failure.
    }
  }

  async function loadItems(listId) {
    if (!listId) { setList([]); return; }
    try {
      setLoadingList(true);
      const { data, error } = await supabase
        .from("shopping_list_items")
        .select("id, name, checked, created_by, created_at")
        .eq("list_id", listId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      setList((data || []).map(r => ({ id: r.id, name: r.name, checked: !!r.checked, created_by: r.created_by })));
    } catch (e) {
      console.warn("[plan] loadItems failed:", e?.message || e);
    } finally {
      setLoadingList(false);
    }
  }

  // v1.13 — load archived shopping lists for the "Past lists" section.
  // Includes a count of items per list via PostgREST relation embedding.
  // Capped at 20 most-recent — we don't need decades of history.
  async function loadArchivedLists() {
    if (!householdId) { setArchivedLists([]); return; }
    try {
      setLoadingArchived(true);
      const { data, error } = await supabase
        .from("shopping_lists")
        .select("id, name, archived_at, shopping_list_items(count)")
        .eq("household_id", householdId)
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      const enriched = (data || []).map(l => ({
        id: l.id,
        name: l.name,
        archived_at: l.archived_at,
        item_count: (l.shopping_list_items && l.shopping_list_items[0] && l.shopping_list_items[0].count) || 0,
      }));
      setArchivedLists(enriched);
    } catch (e) {
      console.warn("[plan] loadArchivedLists failed:", e?.message || e);
    } finally {
      setLoadingArchived(false);
    }
  }

  // v1.13 — clone an archived list into a new active list. Copies all the
  // archived items (preserving names, dropping checked state). The new list
  // gets a name like "Costco trip · May 2" so users can tell it apart from
  // the original at a glance.
  async function cloneArchivedList(archived) {
    if (!householdId || !archived?.id) return;
    try {
      // Fetch the items from the archived list. We strip check state — a
      // cloned list should start fresh, with everything still to-buy.
      const { data: items, error: itemsErr } = await supabase
        .from("shopping_list_items")
        .select("name")
        .eq("list_id", archived.id);
      if (itemsErr) throw itemsErr;

      const names = (items || []).map(i => (i.name || "").trim()).filter(Boolean);
      if (names.length === 0) {
        Alert.alert("Nothing to copy", "That list doesn't have any items.");
        return;
      }

      // New list name: archived name + short date suffix.
      const today = new Date();
      const monthDay = today.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const newName = `${archived.name} · ${monthDay}`;

      const { data: { user } } = await supabase.auth.getUser();
      const { data: newList, error: newErr } = await supabase
        .from("shopping_lists")
        .insert({ household_id: householdId, name: newName, created_by: user?.id || null })
        .select("id, name, archived_at, created_by, created_at")
        .single();
      if (newErr) throw newErr;

      // Bulk-insert the items into the new list.
      const rows = names.map(name => ({
        household_id: householdId,
        list_id: newList.id,
        name,
        created_by: user?.id || null,
      }));
      const { error: insErr } = await supabase.from("shopping_list_items").insert(rows);
      if (insErr) throw insErr;

      // Update local state and switch to the new list.
      setLists(prev => [...prev, newList]);
      setActiveListId(newList.id);
      track("shopping_list_cloned", { source_id: archived.id, item_count: names.length });
    } catch (e) {
      console.warn("[plan] cloneArchivedList failed:", e?.message || e);
      Alert.alert("Couldn't reuse list", "Try again in a moment.");
    }
  }

  // v1.13 — load most recent unique item names added across ANY of the
  // household's lists (active or archived). Powers the quick-add chips
  // above the add row. Pulls more rows than we need so we can dedupe
  // case-insensitively in JS, then truncates to 6.
  async function loadRecentShoppingNames() {
    if (!householdId) { setRecentShoppingNames([]); return; }
    try {
      const { data, error } = await supabase
        .from("shopping_list_items")
        .select("name, created_at")
        .eq("household_id", householdId)
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      const seen = new Set();
      const out = [];
      for (const r of data || []) {
        const k = (r.name || "").trim().toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(r.name.trim());
        if (out.length >= 6) break;
      }
      setRecentShoppingNames(out);
    } catch (e) {
      // Silent — chips are cosmetic.
    }
  }

  useEffect(() => { loadLists(); loadMembers(); loadRecentShoppingNames(); loadArchivedLists(); /* eslint-disable-line */ }, [householdId]);
  useEffect(() => { if (activeListId) loadItems(activeListId); else setList([]); /* eslint-disable-line */ }, [activeListId]);

  async function createList() {
    const trimmed = (newListName || "").trim();
    if (!trimmed || !householdId) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("shopping_lists")
        .insert({ household_id: householdId, name: trimmed, created_by: user?.id || null })
        .select("id, name, archived_at, created_by, created_at")
        .single();
      if (error) throw error;
      setLists(prev => [...prev, data]);
      setActiveListId(data.id);
      setNewListName("");
      setShowCreateList(false);
      track("shopping_list_created");
    } catch (e) {
      console.warn("[plan] createList failed:", e?.message || e);
      Alert.alert("Couldn't create list", "Try again in a moment.");
    }
  }

  async function archiveList(id) {
    try {
      const { error } = await supabase.from("shopping_lists").update({ archived_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      setLists(prev => prev.filter(l => l.id !== id));
      if (activeListId === id) setActiveListId(null);
      track("shopping_list_archived");
      // v1.13 — refresh past-lists so the just-archived list shows up there.
      loadArchivedLists();
    } catch (e) {
      console.warn("[plan] archiveList failed:", e?.message || e);
      Alert.alert("Couldn't archive list", "Try again in a moment.");
    }
  }

  async function addItem() {
    const trimmed = (adding || "").trim();
    if (!trimmed || !householdId || !activeListId) return;
    setAdding("");
    const tempId = "temp-" + Date.now();
    setList(prev => [...prev, { id: tempId, name: trimmed, checked: false }]);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("shopping_list_items")
        .insert({
          household_id: householdId,
          list_id: activeListId,
          name: trimmed,
          created_by: user?.id || null,
        })
        .select("id, name, checked, created_by")
        .single();
      if (error) throw error;
      setList(prev => prev.map(i => i.id === tempId ? { id: data.id, name: data.name, checked: !!data.checked, created_by: data.created_by } : i));
      track("shopping_list_item_added");
      // v1.13 — optimistic update of the recent chips so the freshly added
      // name jumps to the top of the chip row.
      setRecentShoppingNames(prev => {
        const k = trimmed.toLowerCase();
        const filtered = prev.filter(n => n.toLowerCase() !== k);
        return [trimmed, ...filtered].slice(0, 6);
      });
    } catch (e) {
      console.warn("[plan] add failed:", e?.message || e);
      setList(prev => prev.filter(i => i.id !== tempId));
      Alert.alert("Couldn't add to list", "Try again in a moment.");
    }
  }

  // v1.13 — bulk add. Takes an array of trimmed names and batch-inserts them
  // into Supabase. Uses optimistic UI: temp IDs appear immediately, then the
  // real DB rows replace them on success. On failure, we reload from server
  // rather than try to surgically revert (simpler + safer at small scale).
  async function bulkAddItems(names) {
    if (!householdId || !activeListId) return;
    const cleaned = (names || []).map(n => (n || "").trim()).filter(Boolean);
    if (cleaned.length === 0) return;

    const tempBase = Date.now();
    const tempItems = cleaned.map((name, i) => ({
      id: `temp-${tempBase}-${i}`,
      name,
      checked: false,
    }));
    setList(prev => [...prev, ...tempItems]);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const rows = cleaned.map(name => ({
        household_id: householdId,
        list_id: activeListId,
        name,
        created_by: user?.id || null,
      }));
      const { data, error } = await supabase
        .from("shopping_list_items")
        .insert(rows)
        .select("id, name, checked, created_by");
      if (error) throw error;

      // Replace the temp rows with the real ones returned from Supabase. We
      // assume order is preserved by the insert returning clause; if not,
      // worst case is some duplicate visual flicker until next loadItems().
      setList(prev => {
        const tempIds = new Set(tempItems.map(t => t.id));
        const withoutTemps = prev.filter(i => !tempIds.has(i.id));
        const real = (data || []).map(r => ({ id: r.id, name: r.name, checked: !!r.checked, created_by: r.created_by }));
        return [...withoutTemps, ...real];
      });
      track("shopping_list_bulk_added", { count: cleaned.length });
      // Optimistic chip update — newest names go to the front, dedupe.
      setRecentShoppingNames(prev => {
        const newSet = new Set();
        const merged = [];
        for (const n of [...cleaned.slice().reverse(), ...prev]) {
          const k = n.toLowerCase();
          if (newSet.has(k)) continue;
          newSet.add(k);
          merged.push(n);
          if (merged.length >= 6) break;
        }
        return merged;
      });
    } catch (e) {
      console.warn("[plan] bulkAdd failed:", e?.message || e);
      // Pessimistic rollback: drop the temp rows and refetch authoritative state.
      const tempIds = new Set(tempItems.map(t => t.id));
      setList(prev => prev.filter(i => !tempIds.has(i.id)));
      Alert.alert("Couldn't add to list", "Some items may not have been saved. Pull down to refresh.");
      loadItems(activeListId);
    }
  }

  async function toggle(id) {
    const item = list.find(i => i.id === id);
    if (!item) return;
    const nextChecked = !item.checked;
    setList(prev => prev.map(i => i.id === id ? { ...i, checked: nextChecked } : i));
    try {
      const { error } = await supabase.from("shopping_list_items").update({ checked: nextChecked }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.warn("[plan] toggle failed:", e?.message || e);
      setList(prev => prev.map(i => i.id === id ? { ...i, checked: !nextChecked } : i));
    }
  }

  async function remove(id) {
    const removed = list.find(i => i.id === id);
    setList(prev => prev.filter(i => i.id !== id));
    try {
      const { error } = await supabase.from("shopping_list_items").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.warn("[plan] remove failed:", e?.message || e);
      if (removed) setList(prev => [...prev, removed]);
    }
  }

  async function clearChecked() {
    const checkedItems = list.filter(i => i.checked);
    if (checkedItems.length === 0) return;
    const ids = checkedItems.map(i => i.id);
    setList(prev => prev.filter(i => !i.checked));
    try {
      const { error } = await supabase.from("shopping_list_items").delete().in("id", ids);
      if (error) throw error;
      track("shopping_list_cleared", { count: ids.length });
    } catch (e) {
      console.warn("[plan] clearChecked failed:", e?.message || e);
      loadItems(activeListId);
    }
  }

  const activeList = lists.find(l => l.id === activeListId);
  const showPicker = !activeListId;

  // Items that would actually go into the order — anything not yet checked.
  const unchecked = list.filter(i => !i.checked);
  const orderQuery = unchecked.map(i => i.name).join(" ").trim();

  function handleOrderRetailer(retailer) {
    if (!orderQuery) return;
    Linking.openURL(retailer.url(orderQuery));
    track("shopping_list_order_tapped", { retailer: retailer.id, item_count: unchecked.length });
    setShowOrderSheet(false);
  }

  // Pull top 3 ingredients from the fridge (most recently added, fresh ones)
  const ingredients = (items || [])
    .filter(i => daysUntil(i.expiryDate) > 0)
    .slice(0, 3)
    .map(i => i.name)
    .filter(Boolean);
  const seedQuery = ingredients.join(" ").trim();
  const recipeSources = seedQuery
    ? [
        { label: "AllRecipes",  url: `https://www.allrecipes.com/search?q=${encodeURIComponent(seedQuery)}` },
        { label: "NYT Cooking", url: `https://cooking.nytimes.com/search?q=${encodeURIComponent(seedQuery)}` },
        { label: "Epicurious",  url: `https://www.epicurious.com/search/${encodeURIComponent(seedQuery)}` },
      ]
    : [];

  return (
    // v1.0.11 — keyboardShouldPersistTaps + automaticallyAdjustKeyboardInsets
    // fix: testers reported the keyboard covered the shopping-list input when
    // typing. iOS auto-adjusts content insets when the keyboard appears so the
    // focused field stays visible. keyboardShouldPersistTaps lets the user
    // tap outside the input to dismiss without needing a second tap.
    <ScrollView
      style={s.screen}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets={true}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={s.headerRow}>
        <View>
          <Text style={s.pageTitle}>Plan</Text>
          <Text style={s.pageSubtitle}>Recipes from your fridge · shopping list</Text>
        </View>
      </View>

      <Text style={s.sectionLabel}>// RECIPE IDEAS</Text>
      {recipeSources.length > 0 ? (
        <>
          <Text style={{ fontSize: 11, color: T.textSoft, marginHorizontal: 16, marginBottom: 8 }}>
            Based on {ingredients.join(", ")}
          </Text>
          <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
            {recipeSources.map((src, i) => (
              <TouchableOpacity
                key={src.label}
                style={[s.card, { padding: 14, marginBottom: 8, flexDirection: "row", alignItems: "center" }]}
                onPress={() => { track("plan_recipe_link_tapped", { source: src.label }); Linking.openURL(src.url); }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.bold, { fontSize: 14 }]}>{src.label}</Text>
                  <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Search results for your fridge</Text>
                </View>
                <Ionicons name="open-outline" size={18} color={T.accent} />
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : (
        <View style={[s.card, { marginHorizontal: 16, marginBottom: 16, padding: 16 }]}>
          <Text style={{ fontSize: 13, color: T.textSoft }}>
            Add some items to your fridge and we'll suggest recipes based on what you have.
          </Text>
        </View>
      )}

      {/* v1.1.0 — Shopping list section: list-picker view OR in-list view. */}
      {showPicker ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 10, marginTop: 8 }}>
            <Text style={[s.sectionLabel, { paddingHorizontal: 0, marginBottom: 0 }]}>// SHOPPING LISTS</Text>
            <TouchableOpacity onPress={() => { setNewListName(""); setShowCreateList(true); }}>
              <Text style={{ fontSize: 12, color: T.accent, fontWeight: "600" }}>+ New list</Text>
            </TouchableOpacity>
          </View>
          <View style={{ marginHorizontal: 16 }}>
            {loadingLists ? (
              <View style={[s.card, { padding: 14 }]}>
                <Text style={{ fontSize: 13, color: T.textSoft }}>Loading lists…</Text>
              </View>
            ) : lists.length === 0 ? (
              <TouchableOpacity
                style={[s.card, { padding: 16, alignItems: "center", borderStyle: "dashed" }]}
                onPress={() => { setNewListName(""); setShowCreateList(true); }}
              >
                <Text style={{ fontSize: 14, color: T.accent, fontWeight: "600" }}>+ Create your first list</Text>
                <Text style={{ fontSize: 12, color: T.textSoft, marginTop: 4, textAlign: "center" }}>Examples: "Costco trip", "This week", "Birthday party"</Text>
              </TouchableOpacity>
            ) : (
              lists.map(l => (
                <TouchableOpacity
                  key={l.id}
                  onPress={() => setActiveListId(l.id)}
                  style={[s.card, { padding: 14, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 12 }]}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(22,163,74,0.10)", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="list-outline" size={18} color={T.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.bold, { fontSize: 15 }]}>{l.name}</Text>
                    <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Tap to view</Text>
                  </View>
                  <Text style={{ color: T.muted, fontSize: 16 }}>›</Text>
                </TouchableOpacity>
              ))
            )}

            {/* v1.13 — Past lists. Collapsed by default; archived lists open
                here so users can clone a recurring trip (Costco run, etc.)
                instead of typing the same 15 items each week. */}
            {archivedLists.length > 0 && (
              <View style={{ marginTop: 18 }}>
                <TouchableOpacity
                  onPress={() => setArchivedExpanded(v => !v)}
                  style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 4 }}
                >
                  <Ionicons name="time-outline" size={16} color={T.muted} />
                  <Text style={{ fontSize: 12, color: T.muted, fontWeight: "700", letterSpacing: 0.5, marginLeft: 6, flex: 1 }}>
                    PAST LISTS · {archivedLists.length}
                  </Text>
                  <Ionicons name={archivedExpanded ? "chevron-up" : "chevron-down"} size={14} color={T.muted} />
                </TouchableOpacity>
                {archivedExpanded && (
                  <>
                    {archivedLists.map(al => {
                      const archivedDate = new Date(al.archived_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                      return (
                        <TouchableOpacity
                          key={al.id}
                          onPress={() => Alert.alert(
                            `Reuse "${al.name}"?`,
                            `Start a new shopping list with the ${al.item_count} ${al.item_count === 1 ? "item" : "items"} from this past list. The original stays archived.`,
                            [
                              { text: "Cancel", style: "cancel" },
                              { text: "Start new list", onPress: () => cloneArchivedList(al) },
                            ]
                          )}
                          style={[s.card, { padding: 12, marginTop: 8, flexDirection: "row", alignItems: "center", gap: 10, opacity: 0.85 }]}
                        >
                          <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: "rgba(0,0,0,0.04)", alignItems: "center", justifyContent: "center" }}>
                            <Ionicons name="archive-outline" size={15} color={T.muted} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[s.bold, { fontSize: 14, color: T.text }]} numberOfLines={1}>{al.name}</Text>
                            <Text style={{ color: T.textSoft, fontSize: 11, marginTop: 2 }}>
                              {al.item_count} {al.item_count === 1 ? "item" : "items"} · archived {archivedDate}
                            </Text>
                          </View>
                          <Text style={{ color: T.accent, fontSize: 11, fontWeight: "700" }}>REUSE</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}
              </View>
            )}
          </View>
        </>
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, marginBottom: 10, marginTop: 8, gap: 10 }}>
            {/* Back to list-picker if there's more than one list. With only
                one list (default state) we hide the back arrow — but ALWAYS
                show the "+ New list" button so single-list users can create
                additional lists without navigating to a picker view they
                can't see. */}
            {lists.length > 1 && (
              <TouchableOpacity onPress={() => setActiveListId(null)} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
                <Ionicons name="chevron-back" size={20} color={T.accent} />
              </TouchableOpacity>
            )}
            <Text style={[s.sectionLabel, { paddingHorizontal: 0, marginBottom: 0, flex: 1 }]} numberOfLines={1}>
              // {(activeList?.name || "SHOPPING LIST").toUpperCase()}
            </Text>
            {list.some(i => i.checked) && (
              <TouchableOpacity onPress={clearChecked}>
                <Text style={{ fontSize: 12, color: T.accent, fontWeight: "600" }}>Clear checked</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => { setNewListName(""); setShowCreateList(true); }}>
              <Text style={{ fontSize: 12, color: T.accent, fontWeight: "600" }}>+ New list</Text>
            </TouchableOpacity>
          </View>

          <View style={{ marginHorizontal: 16 }}>
            {loadingList ? (
              <View style={[s.card, { padding: 14, marginBottom: 8 }]}>
                <Text style={{ fontSize: 13, color: T.textSoft }}>Loading…</Text>
              </View>
            ) : list.length === 0 ? (
              <View style={[s.card, { padding: 14, marginBottom: 8 }]}>
                <Text style={{ fontSize: 13, color: T.textSoft }}>Nothing on the list yet. Add an item below.</Text>
              </View>
            ) : (
              (() => {
                /* v1.14 — checked items collapse to a "Got these N" group at the
                   bottom of the list, with the working "still need" portion
                   staying visible. Tap the group header to expand. */
                const pending = list.filter(i => !i.checked);
                const checkedItems = list.filter(i => i.checked);

                const renderRow = (item) => {
                  const initial = item.created_by ? memberInitials[item.created_by] : null;
                  return (
                    <View
                      key={item.id}
                      style={[s.card, { flexDirection: "row", alignItems: "center", padding: 12, marginBottom: 6 }]}
                    >
                      <TouchableOpacity onPress={() => toggle(item.id)} style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: item.checked ? T.accent : T.border, backgroundColor: item.checked ? T.accent : "transparent", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                        {item.checked && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </TouchableOpacity>
                      <Text style={{ flex: 1, fontSize: 14, color: item.checked ? T.muted : T.text, textDecorationLine: item.checked ? "line-through" : "none" }}>
                        {item.name}
                      </Text>
                      {initial && (
                        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(22,163,74,0.15)", alignItems: "center", justifyContent: "center", marginRight: 4 }}>
                          <Text style={{ fontSize: 11, color: T.accent, fontWeight: "700" }}>{initial}</Text>
                        </View>
                      )}
                      <TouchableOpacity onPress={() => remove(item.id)} style={{ padding: 6 }}>
                        <Ionicons name="close" size={16} color={T.muted} />
                      </TouchableOpacity>
                    </View>
                  );
                };

                return (
                  <>
                    {pending.length === 0 && checkedItems.length > 0 && (
                      <View style={[s.card, { padding: 16, marginBottom: 6, alignItems: "center", backgroundColor: "rgba(22,163,74,0.05)", borderColor: "rgba(22,163,74,0.20)" }]}>
                        <Text style={{ fontSize: 14, color: T.text, fontWeight: "700", marginBottom: 4 }}>🎉 All caught up</Text>
                        <Text style={{ fontSize: 12, color: T.textSoft, textAlign: "center", marginBottom: 12 }}>
                          Save this list to your past trips so you can reuse it next time.
                        </Text>
                        {/* v1.13 — "Save & start fresh" archives the list and
                            returns the user to the picker view. The list will
                            re-appear in PAST LISTS, ready to clone. */}
                        <TouchableOpacity
                          onPress={() => Alert.alert(
                            "Save this trip?",
                            "We'll archive this list so you can reuse it later. Other lists are unaffected.",
                            [
                              { text: "Cancel", style: "cancel" },
                              { text: "Save & start fresh", onPress: () => archiveList(activeListId) },
                            ]
                          )}
                          style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: T.accent }}
                        >
                          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Save &amp; start fresh</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {pending.map(renderRow)}
                    {checkedItems.length > 0 && (
                      <>
                        <TouchableOpacity
                          onPress={() => setCheckedExpanded(v => !v)}
                          style={[s.card, { flexDirection: "row", alignItems: "center", padding: 12, marginTop: 6, marginBottom: 6, backgroundColor: "rgba(22,163,74,0.06)", borderColor: "rgba(22,163,74,0.20)" }]}
                          accessibilityLabel={checkedExpanded ? "Hide bought items" : "Show bought items"}
                        >
                          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: T.accent, alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                            <Ionicons name="checkmark" size={14} color="#fff" />
                          </View>
                          <Text style={{ flex: 1, fontSize: 13, color: T.accent, fontWeight: "700" }}>
                            Got {checkedItems.length} {checkedItems.length === 1 ? "item" : "items"}
                          </Text>
                          <Ionicons name={checkedExpanded ? "chevron-up" : "chevron-down"} size={16} color={T.accent} />
                        </TouchableOpacity>
                        {checkedExpanded && checkedItems.map(renderRow)}
                      </>
                    )}
                  </>
                );
              })()
            )}

            {/* v1.13 — recently-added chips. Mirrors the fridge AddModal pattern.
                Pulled from the household's recent shopping_list_items, capped at
                6, deduped case-insensitively. One tap re-adds the name to the
                current list. */}
            {recentShoppingNames.length > 0 && (
              <View style={{ marginTop: 14 }}>
                <Text style={{ color: T.textSoft, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 8 }}>RECENTLY ADDED · TAP TO ADD AGAIN</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  {recentShoppingNames.map((n, idx) => (
                    <TouchableOpacity
                      key={n + "_" + idx}
                      onPress={async () => {
                        setAdding(n);
                        // Defer to next tick so the input visually reflects the
                        // tapped name, then trigger the same add flow as Enter.
                        setTimeout(() => {
                          setAdding(""); // clear before optimistic insert
                          // Re-implement the addItem core inline so we don't
                          // race with setAdding's batched state.
                          (async () => {
                            if (!householdId || !activeListId) return;
                            const tempId = "temp-" + Date.now();
                            setList(prev => [...prev, { id: tempId, name: n, checked: false }]);
                            try {
                              const { data: { user } } = await supabase.auth.getUser();
                              const { data, error } = await supabase
                                .from("shopping_list_items")
                                .insert({ household_id: householdId, list_id: activeListId, name: n, created_by: user?.id || null })
                                .select("id, name, checked, created_by")
                                .single();
                              if (error) throw error;
                              setList(prev => prev.map(i => i.id === tempId ? { id: data.id, name: data.name, checked: !!data.checked, created_by: data.created_by } : i));
                              track("shopping_list_chip_tapped");
                              setRecentShoppingNames(prev => {
                                const k = n.toLowerCase();
                                const filtered = prev.filter(x => x.toLowerCase() !== k);
                                return [n, ...filtered].slice(0, 6);
                              });
                            } catch (e) {
                              console.warn("[plan] chip add failed:", e?.message || e);
                              setList(prev => prev.filter(i => i.id !== tempId));
                            }
                          })();
                        }, 0);
                      }}
                      style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, marginRight: 8 }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: "600", color: T.text, maxWidth: 140 }} numberOfLines={1}>{n}</Text>
                      <Text style={{ fontSize: 13, color: T.accent, fontWeight: "700" }}>+</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8, gap: 8 }}>
              <TextInput
                style={[s.input, { flex: 1, marginBottom: 0 }]}
                placeholder="Add an item…"
                placeholderTextColor={T.muted}
                value={adding}
                onChangeText={setAdding}
                onSubmitEditing={addItem}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: T.accent, alignItems: "center", justifyContent: "center", opacity: adding.trim() ? 1 : 0.4 }}
                onPress={addItem}
                disabled={!adding.trim()}
              >
                <Ionicons name="add" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* v1.13 — bulk-add. Single-item-at-a-time was the top friction point
                in real-user feedback. Same UX pattern as the fridge BulkAddModal:
                multiline input, one item per line, batch-insert. */}
            <TouchableOpacity
              style={{ marginTop: 10, alignSelf: "center", paddingVertical: 8, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 }}
              onPress={() => { setBulkText(""); setShowBulkAdd(true); }}
            >
              <Ionicons name="list" size={14} color={T.accent} />
              <Text style={{ color: T.accent, fontSize: 13, fontWeight: "600" }}>Add multiple items</Text>
            </TouchableOpacity>

            {unchecked.length > 0 && (
              <TouchableOpacity
                style={[s.btnPrimary, { marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }]}
                onPress={() => setShowOrderSheet(true)}
              >
                <Ionicons name="bag-handle-outline" size={18} color="#fff" />
                <Text style={s.btnPrimaryText}>
                  Order {unchecked.length} {unchecked.length === 1 ? "item" : "items"}
                </Text>
              </TouchableOpacity>
            )}

            {/* v1.13 — Archive this list. Previously gated on lists.length > 1
                because archiving the only list left users without one. With
                Past Lists in v1.13, that's no longer a dead end — archived
                lists can be cloned back. So we always show this affordance. */}
            <TouchableOpacity
              onPress={() => Alert.alert(
                `Archive "${activeList?.name}"?`,
                "This list moves to Past Lists. You can reuse it later or pick from the others.",
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Archive", style: "destructive", onPress: () => archiveList(activeList.id) },
                ]
              )}
              style={{ marginTop: 12, alignSelf: "center", paddingVertical: 6, paddingHorizontal: 12 }}
            >
              <Text style={{ color: T.muted, fontSize: 12 }}>Archive this list</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* v1.13 — bulk-add modal. One item per line (trailing/leading spaces
          OK). Empty lines are skipped. Save batches all into Supabase in
          one insert via bulkAddItems(). */}
      <Modal visible={showBulkAdd} transparent animationType="slide" onRequestClose={() => setShowBulkAdd(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowBulkAdd(false)}>
          <TouchableOpacity activeOpacity={1} style={s.modalSheet}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets={true}
              contentInsetAdjustmentBehavior="automatic"
            >
              <View style={s.sheetHandle} />
              <Text style={[s.bold, { fontSize: 18, marginBottom: 6 }]}>Add multiple items</Text>
              <Text style={{ color: T.textSoft, fontSize: 13, marginBottom: 14 }}>
                One item per line. Or paste a list from elsewhere — we'll split it on line breaks.
              </Text>
              <TextInput
                style={[s.input, { minHeight: 160, textAlignVertical: "top", paddingTop: 12 }]}
                placeholder={"eggs\nmilk\nbread\navocados (3)\nsourdough"}
                placeholderTextColor={T.muted}
                value={bulkText}
                onChangeText={setBulkText}
                multiline
                autoFocus
                autoCorrect={false}
                autoCapitalize="none"
              />
              {(() => {
                const parsed = (bulkText || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                return (
                  <Text style={{ color: T.muted, fontSize: 11, marginTop: 6, marginBottom: 10 }}>
                    {parsed.length === 0
                      ? "Type or paste items above."
                      : `${parsed.length} ${parsed.length === 1 ? "item" : "items"} ready to add.`}
                  </Text>
                );
              })()}
              <TouchableOpacity
                style={[s.btnPrimary, { opacity: bulkText.trim() ? 1 : 0.5 }]}
                disabled={!bulkText.trim()}
                onPress={async () => {
                  const names = (bulkText || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                  if (names.length === 0) return;
                  setShowBulkAdd(false);
                  setBulkText("");
                  await bulkAddItems(names);
                }}
              >
                <Text style={s.btnPrimaryText}>Add to list</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ marginTop: 10, alignItems: "center", paddingVertical: 12 }}
                onPress={() => setShowBulkAdd(false)}
              >
                <Text style={{ color: T.textSoft, fontSize: 14, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <View style={{ height: 16 }} />
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* New list modal */}
      <Modal visible={showCreateList} transparent animationType="slide" onRequestClose={() => setShowCreateList(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowCreateList(false)}>
          <TouchableOpacity activeOpacity={1} style={s.modalSheet}>
            <View style={s.sheetHandle} />
            <Text style={[s.bold, { fontSize: 18, marginBottom: 6 }]}>New shopping list</Text>
            <Text style={{ color: T.textSoft, fontSize: 13, marginBottom: 14 }}>
              Name it after a store, a trip, or whatever helps you keep things separate.
            </Text>
            <TextInput
              style={s.input}
              placeholder='e.g. "Costco trip"'
              placeholderTextColor={T.muted}
              value={newListName}
              onChangeText={setNewListName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={createList}
            />
            <TouchableOpacity
              style={[s.btnPrimary, { marginTop: 8, opacity: newListName.trim() ? 1 : 0.5 }]}
              disabled={!newListName.trim()}
              onPress={createList}
            >
              <Text style={s.btnPrimaryText}>Create list</Text>
            </TouchableOpacity>
            <View style={{ height: 16 }} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <View style={{ height: 32 }} />

      {/* Retailer picker — searches for all unchecked items in one go */}
      <Modal visible={showOrderSheet} transparent animationType="slide" onRequestClose={() => setShowOrderSheet(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowOrderSheet(false)}>
          <TouchableOpacity activeOpacity={1} style={s.modalSheet}>
            <View style={s.sheetHandle} />
            <Text style={[s.bold, { fontSize: 18, marginBottom: 4 }]}>Order shopping list</Text>
            <Text style={{ color: T.textSoft, fontSize: 13, marginBottom: 16 }} numberOfLines={2}>
              Searching for: {unchecked.map(i => i.name).join(", ")}
            </Text>
            {RETAILERS.map(r => (
              <TouchableOpacity
                key={r.id}
                onPress={() => handleOrderRetailer(r)}
                style={{ flexDirection: "row", alignItems: "center", padding: 14, marginBottom: 8, backgroundColor: r.color + "0D", borderWidth: 1, borderColor: r.color + "33", borderRadius: 14, gap: 12 }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: r.color + "1A", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 11, fontWeight: "800", color: r.color }}>{r.label.charAt(0)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.bold, { fontSize: 15, color: r.color }]}>{r.label}</Text>
                  <Text style={{ color: T.textSoft, fontSize: 11, marginTop: 1 }}>
                    Find {unchecked.length} {unchecked.length === 1 ? "item" : "items"} on {r.label}
                  </Text>
                </View>
                <Text style={{ color: r.color, fontSize: 16 }}>›</Text>
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

// ─── SwipeableRow (v1.0.10, regression-hardened in v1.13) ───────────────────
// PanResponder-based swipe-to-action wrapper around fridge item rows. Swipe
// LEFT (drag finger left) reveals "Delete"; swipe RIGHT reveals "Use it all".
// We use PanResponder rather than react-native-gesture-handler to avoid a
// new native dependency / rebuild for v1.0.10. Tap and long-press on the
// inner child still work — the responder only activates after the user moves
// horizontally past 12px AND the gesture is more horizontal than vertical
// (so vertical scrolls in the list still scroll the parent ScrollView).
//
// v1.13 — fixes "swipe-to-delete not working" regression. Two issues:
//   1) The inner TouchableOpacity claims the responder on touch start, then
//      fights the bubble-phase onMoveShouldSetPanResponder on horizontal
//      drags. Solution: also claim in the *capture phase* so the parent
//      decides before the child Touchable.
//   2) PanResponder created via useRef captures the FIRST render's closure
//      values for `disabled`, `onSwipeRight`, `onSwipeLeft`. When the row
//      re-renders with different props, the captured callbacks are stale.
//      Solution: route handlers through refs that are kept current.
function SwipeableRow({ children, onSwipeRight, onSwipeLeft, disabled }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const swipeWidth = 100;
  const trigger = 70;

  // Keep latest prop values in refs so the responder closures (created once)
  // always see current values, not the initial-render snapshot.
  const disabledRef = useRef(disabled);
  const onSwipeRightRef = useRef(onSwipeRight);
  const onSwipeLeftRef = useRef(onSwipeLeft);
  disabledRef.current = disabled;
  onSwipeRightRef.current = onSwipeRight;
  onSwipeLeftRef.current = onSwipeLeft;

  const shouldClaim = (_, g) =>
    !disabledRef.current &&
    Math.abs(g.dx) > 12 &&
    Math.abs(g.dx) > Math.abs(g.dy) * 1.5;

  const panResponder = useRef(
    PanResponder.create({
      // Claim in the capture phase so the parent wins over the inner
      // TouchableOpacity, which also tries to handle this gesture.
      onMoveShouldSetPanResponderCapture: shouldClaim,
      onMoveShouldSetPanResponder: shouldClaim,
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      // Don't yield the responder mid-swipe to a parent ScrollView.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        translateX.setOffset(0);
        translateX.setValue(0);
      },
      onPanResponderMove: (_, g) => {
        // Clamp so the row can't be dragged off-screen.
        const next = Math.max(-swipeWidth - 20, Math.min(swipeWidth + 20, g.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const dx = g.dx;
        if (dx > trigger && onSwipeRightRef.current) {
          // Animate to the right, fire callback, then snap back so the row
          // doesn't appear to vanish — the parent state is what removes /
          // updates the item.
          Animated.timing(translateX, { toValue: swipeWidth, duration: 120, useNativeDriver: true }).start(() => {
            onSwipeRightRef.current && onSwipeRightRef.current();
            Animated.timing(translateX, { toValue: 0, duration: 200, useNativeDriver: true }).start();
          });
        } else if (dx < -trigger && onSwipeLeftRef.current) {
          Animated.timing(translateX, { toValue: -swipeWidth, duration: 120, useNativeDriver: true }).start(() => {
            onSwipeLeftRef.current && onSwipeLeftRef.current();
            Animated.timing(translateX, { toValue: 0, duration: 200, useNativeDriver: true }).start();
          });
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
      },
    })
  ).current;

  // Whether enabled or disabled (selectMode), we always provide consistent
  // outer margins so the inner row can use marginHorizontal:0 / marginBottom:0
  // and rely on us. Keeps multi-select and swipe modes visually identical.
  if (disabled) {
    return <View style={{ marginHorizontal: 16, marginBottom: 10 }}>{children}</View>;
  }

  return (
    <View style={{ position: "relative", marginHorizontal: 16, marginBottom: 10 }}>
      {/* Action backdrops, revealed as the row is dragged */}
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, flexDirection: "row", borderRadius: 14, overflow: "hidden" }}>
        <View style={{ flex: 1, backgroundColor: T.accent, justifyContent: "center", paddingLeft: 18 }}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>✓ Use it all</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: T.danger, justifyContent: "center", alignItems: "flex-end", paddingRight: 18 }}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Delete 🗑</Text>
        </View>
      </View>
      <Animated.View
        {...panResponder.panHandlers}
        style={{ transform: [{ translateX }] }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

// ─── How To (v1.0.10) ────────────────────────────────────────────────────────
// Originally a bottom sheet (HelpSheet) opened from a "?" icon in the fridge
// header. Greg moved it into the bottom nav after testing v1.0.10 — easier
// to discover, and Share moved up into the fridge header in its place.
const HOWTO_SECTIONS = [
  {
    icon: "📦",
    title: "Adding items",
    body: "Tap + on the Fridge tab. Type a name, pick a category, set how many days it lasts. Or scan a barcode for a single product, scan a receipt to bulk-import a whole grocery run, or use the manual list for typing several items at once.",
  },
  {
    icon: "🧾",
    title: "Scanning receipts",
    body: "Tap + → Scan Receipt. Take a photo or upload one from your camera roll. We use AI to extract food items and pre-fill names, quantities, and expiration dates. Review the list and tap Add All.",
  },
  {
    icon: "🤝",
    title: "Sharing your fridge",
    body: "Tap the share icon at the top of the Fridge screen → Invite household member. Send the code to anyone in your home — once they enter it, you both see the same fridge in real time. New items, deletions, marked-as-used — all sync.",
  },
  {
    icon: "🔔",
    title: "Reminders",
    body: "On the Alerts tab, turn on push notifications, daily email digest, or both. We'll let you know which items are 3 days from expiring so nothing gets thrown out.",
  },
  {
    icon: "👆",
    title: "Quick actions",
    body: "Swipe RIGHT on an item to mark it all used. Swipe LEFT to delete. Long-press to enter multi-select. Tap any item to edit details, change quantity, or mark as opened.",
  },
  {
    icon: "📍",
    title: "Containers",
    body: "Items live in Fridge, Pantry, or Freezer by default. Tap a container chip to filter; tap the + chip to add custom containers like “Spice rack” or “Garage fridge”.",
  },
];

function HowToScreen() {
  return (
    <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.pageTitle}>How To</Text>
          <Text style={s.pageSubtitle}>The short tour. New here? Start with the Fridge tab.</Text>
        </View>
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        {HOWTO_SECTIONS.map(sec => (
          <View key={sec.title} style={[s.card, { padding: 14, marginBottom: 10, flexDirection: "row", gap: 12 }]}>
            <Text style={{ fontSize: 28, width: 36, textAlign: "center" }}>{sec.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.bold, { fontSize: 15, marginBottom: 4 }]}>{sec.title}</Text>
              <Text style={{ color: T.textSoft, fontSize: 13, lineHeight: 19 }}>{sec.body}</Text>
            </View>
          </View>
        ))}
        <View style={{ borderTopWidth: 1, borderTopColor: T.border, paddingTop: 16, marginTop: 12, marginBottom: 32, alignItems: "center" }}>
          <Text style={{ color: T.muted, fontSize: 12, marginBottom: 8 }}>Stuck? Send us a note.</Text>
          <TouchableOpacity
            onPress={() => Linking.openURL("mailto:support@ok2eat.com?subject=ok2eat%20Help")}
            style={[s.btnSecondary, { paddingHorizontal: 20 }]}
          >
            <Text style={{ color: T.accent, fontWeight: "600" }}>Email support</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

// ─── TourModal (v1.0.10) ─────────────────────────────────────────────────────
// First-run tour shown after onboarding completes. 3 horizontally-paged cards
// with a Skip button on every card and Next/Done on the right. Persists
// TOUR_SEEN_KEY on completion so it never shows twice.
function TourModal({ visible, onClose }) {
  const [page, setPage] = useState(0);
  const screenWidth = Dimensions.get("window").width;
  const scrollRef = useRef(null);

  useEffect(() => {
    if (visible) setPage(0);
  }, [visible]);

  const cards = [
    {
      emoji: "📷",
      title: "Add items in seconds",
      body: "Scan a barcode or snap a photo of your receipt — we'll auto-fill names, categories, and expiration dates. Way faster than typing.",
    },
    {
      emoji: "📅",
      title: "We track when it'll go bad",
      body: "Each item gets a freshness countdown based on what it is. Open something? Tap “Mark as opened” to switch to the shorter shelf life.",
    },
    {
      emoji: "🔔",
      title: "Get a heads-up before it expires",
      body: "Daily digest emails (or push notifications) tell you what's expiring in the next 3 days. Less waste, more savings.",
    },
  ];

  async function finish() {
    try { await AsyncStorage.setItem(TOUR_SEEN_KEY, "1"); } catch (e) { /* noop */ }
    track("tour_completed", { last_page: page });
    onClose();
  }

  function handleNext() {
    if (page < cards.length - 1) {
      const next = page + 1;
      setPage(next);
      scrollRef.current?.scrollTo({ x: next * screenWidth, animated: true });
    } else {
      finish();
    }
  }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={finish}>
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 20, paddingTop: 8 }}>
          <TouchableOpacity onPress={finish} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={{ color: T.textSoft, fontSize: 14, fontWeight: "600" }}>Skip</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / screenWidth))}
          style={{ flex: 1 }}
        >
          {cards.map((c, i) => (
            <View key={i} style={{ width: screenWidth, padding: 32, justifyContent: "center", alignItems: "center" }}>
              <Text style={{ fontSize: 88, marginBottom: 24 }}>{c.emoji}</Text>
              <Text style={{ fontSize: 24, fontWeight: "800", color: T.text, textAlign: "center", marginBottom: 14, letterSpacing: -0.5 }}>{c.title}</Text>
              <Text style={{ fontSize: 15, color: T.textSoft, textAlign: "center", lineHeight: 22, maxWidth: 320 }}>{c.body}</Text>
            </View>
          ))}
        </ScrollView>
        {/* Page dots */}
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 16 }}>
          {cards.map((_, i) => (
            <View
              key={i}
              style={{ width: i === page ? 24 : 8, height: 8, borderRadius: 4, backgroundColor: i === page ? T.accent : T.border }}
            />
          ))}
        </View>
        <View style={{ paddingHorizontal: 24, paddingBottom: 24 }}>
          <TouchableOpacity style={s.btnPrimary} onPress={handleNext}>
            <Text style={s.btnPrimaryText}>{page === cards.length - 1 ? "Get started" : "Next"}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
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
  const [emailDigestEnabled, setEmailDigestEnabled] = useState(true);
  const [updateInfo, setUpdateInfo] = useState(null);
  // v1.0.8 — shared household state
  const [householdId, setHouseholdId] = useState(null);
  const [householdName, setHouseholdName] = useState("");
  const [defaultContainer, setDefaultContainer] = useState("fridge");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showManageInventory, setShowManageInventory] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [memberCount, setMemberCount] = useState(1);
  // v1.0.10 — first-run tour. We check AsyncStorage on mount and after
  // onboarding completion to decide whether to show.
  const [showTour, setShowTour] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const appState = useRef(AppState.currentState);

  // v1.0.10 — recently-added items, deduped by name (case-insensitive),
  // newest first, capped at 6. Most fridge restocking is repeat purchases,
  // so the AddModal surfaces these as one-tap re-add chips.
  const recentItems = (() => {
    const seen = new Set();
    const out = [];
    // `items` is already ordered created_at DESC by dbGetItems.
    for (const it of items) {
      const k = (it.name || "").trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(it);
      if (out.length >= 6) break;
    }
    return out;
  })();

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

  // Check for App Store update once per session, deferred slightly so it
  // doesn't compete with auth/load on cold start. Soft prompt: user can
  // dismiss and we re-check on the next launch.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const resp = await fetch(ITUNES_LOOKUP_URL);
        const data = await resp.json();
        if (cancelled) return;
        if (!data?.results?.length) return;
        const latest = data.results[0].version;
        if (compareVersions(APP_VERSION, latest) < 0) {
          setUpdateInfo({
            current: APP_VERSION,
            latest,
            url: data.results[0].trackViewUrl || APP_STORE_URL,
          });
        }
      } catch {
        // Network or parse error — silently no-op; we'll try again next launch
      }
    }, 2000);
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  // Load items and setup notifications when user logs in
  useEffect(() => {
    if (user) {
      loadItems();
      setupNotifications();
      loadEmailDigestSetting();
      loadHouseholdState();
    }
  }, [user]);

  // v1.0.5: per-item foreground notifications removed.
  // The daily digest is sent server-side via the send-daily-digest Edge Function.

  // ── Helper functions ──

  async function setupNotifications() {
    // Sweep any leftover per-item schedules from pre-1.0.5 builds.
    await cancelLegacyNotifications();
    const granted = await requestNotificationPermission();
    setNotificationsEnabled(granted);
    if (granted) await registerPushTokenWithSupabase();
  }

  // Save (or refresh) this device's Expo push token into expo_push_tokens
  // so the server-side digest can target it.
  async function registerPushTokenWithSupabase() {
    try {
      const token = await getExpoPushToken();
      if (!token) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("expo_push_tokens").upsert({
        token,
        user_id: user.id,
        platform: Platform.OS,
        device_name: (typeof Platform !== "undefined" && Platform.constants?.systemName) || Platform.OS,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "token" });
    } catch (e) {
      console.log("registerPushToken failed:", e?.message || e);
    }
  }

  async function toggleNotifications() {
    if (notificationsEnabled) {
      await cancelLegacyNotifications();
      // Mark notifications disabled in user_settings (digest skipped server-side)
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("user_settings").upsert({
            user_id: user.id,
            notifications_enabled: false,
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id" });
        }
      } catch {}
      setNotificationsEnabled(false);
      showToast("🔕 Daily digest turned off");
    } else {
      const granted = await requestNotificationPermission();
      if (granted) {
        await registerPushTokenWithSupabase();
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await supabase.from("user_settings").upsert({
              user_id: user.id,
              notifications_enabled: true,
              updated_at: new Date().toISOString(),
            }, { onConflict: "user_id" });
          }
        } catch {}
        setNotificationsEnabled(true);
        showToast("🔔 Daily digest enabled!");
      } else {
        Alert.alert("Permission Required", "Please enable notifications in your iPhone Settings to use this feature.");
      }
    }
  }

  // Read the user's current email_digest_enabled flag from user_settings.
  // If no row exists yet, default to true (matches the SQL column default).
  async function loadEmailDigestSetting() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("user_settings")
        .select("email_digest_enabled")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error || !data) {
        setEmailDigestEnabled(true);
        return;
      }
      setEmailDigestEnabled(data.email_digest_enabled !== false);
    } catch {}
  }

  async function toggleEmailDigest() {
    const next = !emailDigestEnabled;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("user_settings").upsert({
          user_id: user.id,
          email_digest_enabled: next,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
      }
    } catch {}
    setEmailDigestEnabled(next);
    showToast(next ? "📧 Email digest enabled!" : "📭 Email digest turned off");
  }

  // v1.0.8 — Loads household membership and onboarding state for the signed-in
  // user. Idempotent: ensure_household_for_user is a server-side RPC that
  // returns the existing household or creates one. We then read the household
  // name (for Manage Inventory) and the has_seen_household_onboarding flag
  // (which gates the 2-step intro modal). Default container preference comes
  // from AsyncStorage so we can pre-select it on the next add.
  async function loadHouseholdState() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // v1.0.9 — defer household auto-creation until the user finishes
      // onboarding. New users with an invite code shouldn't end up with a
      // junk household that gets abandoned the moment they redeem. We only
      // auto-create for users who have ALREADY onboarded (safety net for
      // edge-case states), or who have an existing membership.
      const { data: settings } = await supabase
        .from("user_settings")
        .select("has_seen_household_onboarding")
        .eq("user_id", user.id)
        .maybeSingle();

      const hasOnboarded = !!settings?.has_seen_household_onboarding;

      // Check if they already have a membership (from a prior install or
      // having been added/redeemed earlier).
      const { data: existingMember } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("user_id", user.id)
        .maybeSingle();

      let hhId = existingMember?.household_id || null;

      if (!hhId && hasOnboarded) {
        // Edge case: user finished onboarding before but doesn't currently
        // have a household. Re-create one for them so the app keeps working.
        const { data: newHh, error: rpcErr } = await supabase.rpc("ensure_household_for_user");
        if (!rpcErr) hhId = newHh;
      }

      if (hhId) setHouseholdId(hhId);

      // Read household name + member count only if a household exists
      if (hhId) {
        const [{ data: hh }, { data: memberRows }] = await Promise.all([
          supabase.from("households").select("name").eq("id", hhId).maybeSingle(),
          supabase.rpc("list_household_members"),
        ]);
        if (hh?.name) setHouseholdName(hh.name);
        if (Array.isArray(memberRows)) setMemberCount(memberRows.length || 1);
      }

      try {
        const stored = await AsyncStorage.getItem(ONBOARDING_DEFAULT_CONTAINER_KEY);
        if (stored && ["fridge", "pantry", "freezer"].includes(stored)) {
          setDefaultContainer(stored);
        }
      } catch {}

      if (!hasOnboarded) {
        setShowOnboarding(true);
      }
    } catch (e) {
      console.warn("loadHouseholdState error:", e?.message || e);
    }
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
      const expiryDateIso = new Date(Date.now() + product.defaultExpiry * 86400000).toISOString();
      // For packaged items, we also store the once-opened shelf life in days
      // and snapshot the unopened expiry so "Mark as opened" / undo work cleanly.
      const expiryUnopenedDate = expiryDateIso.slice(0, 10); // YYYY-MM-DD for the date column
      const saved = await dbAddItem({
        name: product.name, category: product.category, emoji: product.emoji,
        quantity: 1, barcode: product.code,
        addedDate: new Date().toISOString(),
        expiryDate: expiryDateIso,
        section: addSection || "fridge",
        // Open/closed expiry
        isOpened: false,
        openedAt: null,
        expiryOpenedDays: product.openedDays || null,
        expiryUnopened: expiryUnopenedDate,
      });
      setItems(prev => [rowToItem(saved), ...prev]);
      showToast(`✅ ${product.name} added!`);
      track("item_scanned", { category: product.category });
      setTimeout(() => setTab("fridge"), 1200);
    } catch (e) {
      console.warn("handleScanned save failed:", e?.message || e);
      Alert.alert("Couldn't save item", e?.message || "Check your connection.");
    }
  }

  async function handleAddManual(data) {
    try {
      // Snapshot expiry_unopened for manual adds so the open/close feature
      // also works when items are typed in by hand.
      const expiryUnopened = data.expiryDate ? data.expiryDate.slice(0, 10) : null;
      const saved = await dbAddItem({
        ...data,
        section: data.section || "fridge",
        isOpened: data.isOpened || false,
        openedAt: data.openedAt || null,
        expiryOpenedDays: data.expiryOpenedDays || null,
        expiryUnopened: data.expiryUnopened || expiryUnopened,
      });
      setItems(prev => [rowToItem(saved), ...prev]);
      showToast(`✅ ${data.name} added!`);
      track("item_added_manual", { category: data.category });
    } catch (e) {
      console.warn("handleAddManual save failed:", e?.message || e);
      Alert.alert("Couldn't save item", e?.message || "Check your connection.");
    }
  }

  async function handleBulkAdd(itemsList) {
    if (!itemsList || itemsList.length === 0) return;
    // Save items in parallel and tolerate partial failure: a malformed
    // expiry on one row shouldn't lose the other valid rows.
    const results = await Promise.allSettled(itemsList.map(it => dbAddItem(it)));
    const saved = [];
    let failed = 0;
    for (const r of results) {
      if (r.status === "fulfilled") {
        saved.push(rowToItem(r.value));
      } else {
        failed += 1;
        console.warn("bulk add item failed:", r.reason?.message || r.reason);
      }
    }
    if (saved.length > 0) {
      setItems(prev => [...saved, ...prev]);
      track("item_added_bulk", { count: saved.length, failed });
    }
    if (failed === 0) {
      showToast(`✅ ${saved.length} item${saved.length !== 1 ? "s" : ""} added!`);
      setTab("fridge");
    } else if (saved.length === 0) {
      Alert.alert("Couldn't save items", "Check your connection and try again.");
    } else {
      Alert.alert(
        "Partially saved",
        `Added ${saved.length} of ${itemsList.length} items. ${failed} couldn't be saved — open them again to retry.`
      );
      setTab("fridge");
    }
  }

  async function handleUpdate(id, updates) {
    try {
      await dbUpdateItem(id, updates);
      setItems(prev => prev.map(i => i.id === id ? {
        ...i,
        name: updates.name || i.name,
        category: updates.category || i.category,
        emoji: updates.emoji || i.emoji,
        quantity: updates.quantity || i.quantity,
        unit: updates.unit !== undefined ? updates.unit : i.unit,
        expiryDate: updates.expiry_date || i.expiryDate,
        // Open/closed fields — explicit undefined check so we can write null/false
        isOpened: updates.is_opened !== undefined ? updates.is_opened : i.isOpened,
        openedAt: updates.opened_at !== undefined ? updates.opened_at : i.openedAt,
        expiryOpenedDays: updates.expiry_opened_days !== undefined ? updates.expiry_opened_days : i.expiryOpenedDays,
        expiryUnopened: updates.expiry_unopened !== undefined ? updates.expiry_unopened : i.expiryUnopened,
      } : i));
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

  async function handleBulkDelete(ids) {
    if (!ids || ids.length === 0) return;
    const results = await Promise.allSettled(ids.map(id => dbDeleteItem(id)));
    const succeededIds = new Set();
    let failed = 0;
    results.forEach((r, idx) => {
      if (r.status === "fulfilled") succeededIds.add(ids[idx]);
      else failed += 1;
    });
    if (succeededIds.size > 0) {
      setItems(prev => prev.filter(i => !succeededIds.has(i.id)));
      track("items_bulk_deleted", { count: succeededIds.size, failed });
    }
    if (failed === 0) {
      showToast(`✅ ${succeededIds.size} item${succeededIds.size !== 1 ? "s" : ""} deleted`);
    } else {
      Alert.alert("Some items couldn't be deleted", `Removed ${succeededIds.size} of ${ids.length}. Try again on the rest.`);
    }
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

  // v1.0.10 — Share moved off the bottom nav into the fridge header (icon),
  // and "How To" took its slot. Tester feedback: help should be the most
  // discoverable thing for new users.
  const navItems = [{ id: "fridge", label: "Fridge" }, { id: "reminders", label: "Alerts" }, { id: "plan", label: "Plan" }, { id: "howto", label: "How To" }];

  return (
    // v1.0.10 — root is a plain View now, with the SafeAreaView nested
    // *inside* it. The navBar (below) is rendered as a sibling of
    // SafeAreaView, so it extends past the home-indicator inset and sits
    // flush with the bottom of the screen, Messages-app style. The nav's
    // own paddingBottom keeps labels above the actual home indicator.
    <View style={s.root}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF", paddingBottom: 0 }}>
      <StatusBar barStyle="dark-content" backgroundColor={T.bg} />
      <View style={s.appBar}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={s.appLogo}><Text style={{ fontSize: 14 }}>🧊</Text></View>
          <Text style={s.appName}>ok2eat</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {/* v1.0.10 — Share promoted to the global app bar so it's
              reachable from every tab. Replaces the Feedback button
              (whose action moved into the Share screen as a button). */}
          <TouchableOpacity
            onPress={() => { track("share_appbar_tapped"); setTab("share"); }}
            style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "rgba(22,163,74,0.1)", borderWidth: 1, borderColor: "rgba(22,163,74,0.2)", borderRadius: 8 }}
            accessibilityLabel="Share or invite household members"
          >
            <Text style={{ fontSize: 12, color: T.accent, fontWeight: "600" }}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => supabase.auth.signOut()} style={{ paddingHorizontal: 10, paddingVertical: 6 }} accessibilityLabel="Log out">
            <Text style={{ fontSize: 12, color: T.muted, fontWeight: "600" }}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ flex: 1 }}>
        {tab === "fridge" && <FridgeScreen items={items} onDelete={handleDelete} onBulkDelete={handleBulkDelete} onAdd={(section) => { setAddSection(section || "fridge"); setShowAdd(true); }} onUpdate={handleUpdate} onUse={handleUse} loading={loading} householdName={householdName} onOpenManageInventory={() => setShowManageInventory(true)} />}
        {tab === "scan" && <ScanScreen onScanned={handleScanned} />}
        {tab === "plan" && <PlanScreen items={items} householdId={householdId} />}
        {tab === "reminders" && <RemindersScreen items={items} notificationsEnabled={notificationsEnabled} onToggleNotifications={toggleNotifications} emailDigestEnabled={emailDigestEnabled} onToggleEmailDigest={toggleEmailDigest} />}
        {tab === "share" && <ShareScreen householdName={householdName} memberCount={memberCount} onOpenInvite={() => setShowInvite(true)} onBack={() => setTab("fridge")} />}
        {tab === "howto" && <HowToScreen />}
      </View>
      {toast !== "" && <Animated.View style={[s.toast, { opacity: toastOpacity }]}><Text style={s.toastText}>{toast}</Text></Animated.View>}
      <AddModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onAdd={handleAddManual}
        onGoToScan={() => { setShowAdd(false); setTab("scan"); }}
        onScanReceipt={() => { setShowAdd(false); setShowBulkAdd(true); }}
        section={addSection}
        onBulkAdd={() => setShowBulkAdd(true)}
        recentItems={recentItems}
      />
      <OnboardingModal
        visible={showOnboarding}
        initialName={householdName}
        onComplete={({ householdId: newHhId, householdName: newName, defaultContainer: dc }) => {
          if (newHhId) setHouseholdId(newHhId);
          if (newName) setHouseholdName(newName);
          if (dc) setDefaultContainer(dc);
          setShowOnboarding(false);
          // Refetch household state + items so the rest of the app reflects
          // the chosen path (especially the join path, which may have moved
          // items into a different household).
          loadHouseholdState();
          loadItems();
          showToast("👋 You're all set!");
          // v1.0.10 — first-run tour. Show right after onboarding (only once).
          AsyncStorage.getItem(TOUR_SEEN_KEY).then(val => {
            if (!val) setShowTour(true);
          }).catch(() => { /* noop — fall through, tour just won't show */ });
        }}
      />
      <TourModal visible={showTour} onClose={() => setShowTour(false)} />
      <ManageInventoryModal
        visible={showManageInventory}
        items={items}
        householdName={householdName}
        onClose={() => setShowManageInventory(false)}
        onOpenInvite={() => setShowInvite(true)}
      />
      <InviteHouseholdModal
        visible={showInvite}
        householdId={householdId}
        householdName={householdName}
        onClose={() => setShowInvite(false)}
        onJoined={() => {
          // Refresh state after joining a new household
          loadHouseholdState();
          loadItems();
          showToast("✓ Joined household");
        }}
      />
      <BulkAddModal visible={showBulkAdd} onClose={() => setShowBulkAdd(false)} onAddItems={handleBulkAdd} section={addSection} />

      <Modal
        visible={updateInfo !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setUpdateInfo(null)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <View style={{ backgroundColor: T.surface, borderRadius: 16, padding: 32, alignItems: "center", maxWidth: 360, width: "100%" }}>
            <Text style={{ fontSize: 56, marginBottom: 12 }}>🥑</Text>
            <Text style={{ fontSize: 22, fontWeight: "700", color: T.text, marginBottom: 8, textAlign: "center" }}>
              Update available
            </Text>
            <Text style={{ fontSize: 14, color: T.textSoft, textAlign: "center", lineHeight: 20, marginBottom: 24 }}>
              A new version of ok2eat is on the App Store.{"\n"}You're on {formatVersion(updateInfo?.current || "")}.
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: T.accent, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 10, marginBottom: 8, width: "100%", alignItems: "center" }}
              onPress={() => {
                track("update_prompt_accepted", { from: updateInfo?.current, to: updateInfo?.latest });
                if (updateInfo?.url) Linking.openURL(updateInfo.url);
                setUpdateInfo(null);
              }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 16 }}>Update Now</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                track("update_prompt_dismissed", { from: updateInfo?.current, to: updateInfo?.latest });
                setUpdateInfo(null);
              }}
              style={{ paddingVertical: 12 }}
            >
              <Text style={{ color: T.muted, fontSize: 14 }}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      </SafeAreaView>
      {/* navBar lives OUTSIDE the SafeAreaView so its white background
          extends through the home-indicator zone. paddingBottom on iOS
          (~24pt) keeps the labels above the actual indicator. */}
      <View style={[s.navBar, Platform.OS === "ios" && { paddingBottom: 24 }]}>
        {navItems.map(n => (
          <TouchableOpacity key={n.id} style={s.navBtn} onPress={() => setTab(n.id)}>
            {n.id === "fridge" && <MaterialIcons name="kitchen" size={24} color={tab === n.id ? T.accent : T.muted} />}
            {n.id === "reminders" && <Ionicons name="notifications-outline" size={24} color={tab === n.id ? T.accent : T.muted} />}
            {n.id === "plan" && <Ionicons name="list-outline" size={24} color={tab === n.id ? T.accent : T.muted} />}
            {n.id === "howto" && <Ionicons name="help-circle-outline" size={24} color={tab === n.id ? T.accent : T.muted} />}
            <Text style={[s.navLabel, tab === n.id && { color: T.accent }]}>{n.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // v1.0.10 — root bg switched to white so the SafeAreaView's bottom inset
  // (the home-indicator zone) reads as a continuation of the navBar instead
  // of a cream-tinted "gap" beneath it. Screens still set their own T.bg
  // background, so the visible content area is unchanged.
  root: { flex: 1, backgroundColor: "#FFFFFF" }, screen: { flex: 1, backgroundColor: T.bg },
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
  navBar: { flexDirection: "row", backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: T.border, paddingBottom: 8, paddingTop: 8 },
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