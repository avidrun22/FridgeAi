import { useState, useEffect, useRef } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, SafeAreaView, StatusBar, Modal, Alert,
  Animated, Platform, ActivityIndicator, AppState, KeyboardAvoidingView,
  PanResponder, Dimensions, Keyboard, InputAccessoryView, Image, Switch,
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

// ─── Android status-bar inset ────────────────────────────────────────────────
// v1.21 — React Native's built-in SafeAreaView only handles iOS notch/home
// indicator. On Android, full-screen <Modal>s render *underneath* the status
// bar (clock + wifi icons overlap our Back/Edit headers). Pad by the status
// bar height on Android, no-op on iOS. Defaults to 24 if currentHeight isn't
// available yet (rare — happens during the very first frame).
const ANDROID_TOP_INSET = Platform.OS === "android" ? (StatusBar.currentHeight || 24) : 0;

// ─── Analytics ───────────────────────────────────────────────────────────────
const posthog = new PostHog("phc_szxhjw2eQmYYhNGicX3kmNXxdz47Sj7evqx5Quqw8dTY", { host: "https://app.posthog.com" });

// App version + build number — read at module load from expo-constants. Same
// source as the in-app update modal (see APP_VERSION below). Hoisted up here
// so analytics events can include it from event #1 of the session. If the
// constant isn't available for any reason, fall back to "unknown" instead of
// reporting a stale hard-coded version — that was the v1.0.10 regression.
const _ANALYTICS_EC = (() => {
  try { return require("expo-constants").default; } catch { return null; }
})();
const _ANALYTICS_APP_VERSION =
  _ANALYTICS_EC?.expoConfig?.version ||
  _ANALYTICS_EC?.manifest?.version ||
  "unknown";
const _ANALYTICS_BUILD_NUMBER =
  _ANALYTICS_EC?.expoConfig?.ios?.buildNumber ||
  _ANALYTICS_EC?.manifest?.ios?.buildNumber ||
  "unknown";

// Register version + platform as super-properties so they attach to EVERY
// event automatically — including the auto-fired $identify and any future
// auto-captured events. Without this, only events that go through track()
// (with manually-added props) would carry version info.
//
// $set in identifyUser pushes version up to the person profile so we can
// answer "what version is user X on RIGHT NOW?" (latest known) vs the
// per-event view ("what version did this event come from?").
try {
  posthog.register({
    app_version: _ANALYTICS_APP_VERSION,
    build_number: _ANALYTICS_BUILD_NUMBER,
    platform: "ios",
  });
} catch (e) { /* analytics should never crash boot */ }

function track(event, properties) {
  try { posthog.capture(event, properties); } catch (e) { /* analytics should never crash the app */ }
}

function identifyUser(userId) {
  try {
    // $set pushes these onto the person profile (latest-wins). $set_once on
    // first_seen_app_version preserves the version a user first signed up on
    // — useful for cohort analysis of "users acquired during v1.17 era."
    posthog.identify(userId, {
      $set: {
        app_version: _ANALYTICS_APP_VERSION,
        build_number: _ANALYTICS_BUILD_NUMBER,
        platform: "ios",
      },
      $set_once: {
        first_seen_app_version: _ANALYTICS_APP_VERSION,
        first_seen_at: new Date().toISOString(),
      },
    });
  } catch (e) { /* noop */ }
}

function resetAnalytics() {
  try {
    posthog.reset();
    // Re-register super-properties after reset — without this, the next
    // session loses platform/app_version until the next track() call wires
    // them back in. PostHog's reset clears everything including registers.
    posthog.register({
      app_version: _ANALYTICS_APP_VERSION,
      build_number: _ANALYTICS_BUILD_NUMBER,
      platform: "ios",
    });
  } catch (e) { /* noop */ }
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

// v1.15 — D1 retention nudge. Local notification fired the same evening the
// user adds their first items, referencing what they just put in the fridge.
// The "this app remembered something I forgot" moment is the lever for D1
// retention (currently ~6%, well below the 30-40% benchmark for utility apps).
//
// Behavior:
//   - At most one nudge per calendar day. Repeat adds today are a no-op.
//   - If iOS notification permission isn't granted yet, we silently skip —
//     the user has to opt in via the daily digest toggle first. This is
//     not a re-prompt surface.
//   - Scheduled for 6:30 PM local time. If it's already past 6:00 PM when
//     the user adds, we schedule 30 minutes out so they don't catch it
//     while still in the app.
//   - Content references the soonest-expiring item if any has <=7 days
//     left; otherwise a soft "we'll notify you when something's about to
//     spoil" welcome.
//
// Telemetry: fires `d1_nudge_scheduled` (success), `d1_nudge_skipped`
// (already scheduled today, no perm, etc.) so we can measure schedule
// rate against actual delivery / open rate later.
const D1_NUDGE_KEY = "ok2eat:d1NudgeScheduled";
const D1_NUDGE_ID_KEY = "ok2eat:d1NudgeId";

async function scheduleD1RetentionNudge(allItems, helpers) {
  // helpers = { trackFn, daysUntilFn } — passed in so we can avoid module-
  // scope circular deps. App.js's `track` and `daysUntil` are defined later
  // than this helper.
  const trackFn = helpers?.trackFn;
  const daysUntilFn = helpers?.daysUntilFn;
  if (typeof daysUntilFn !== "function") return;

  try {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const existing = await AsyncStorage.getItem(D1_NUDGE_KEY);
    if (existing === todayKey) {
      // Already scheduled today; don't double-fire.
      if (trackFn) trackFn("d1_nudge_skipped", { reason: "already_scheduled_today" });
      return;
    }

    // Permissions: read without prompting.
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status !== "granted") {
      if (trackFn) trackFn("d1_nudge_skipped", { reason: "no_permission" });
      return;
    }

    // Cancel any prior D1 nudge schedule (e.g. yesterday's that hasn't fired
    // yet because the user backgrounded or device was asleep).
    try {
      const priorId = await AsyncStorage.getItem(D1_NUDGE_ID_KEY);
      if (priorId) await Notifications.cancelScheduledNotificationAsync(priorId);
    } catch { /* noop */ }

    // Pick the soonest-expiring item (>0 days, <=7 days) to reference. Items
    // already expired or missing dates are skipped — referencing them would
    // confuse a fresh user who just added items.
    const candidate = (allItems || [])
      .filter(it => {
        const d = daysUntilFn(it.expiryDate);
        return Number.isFinite(d) && d > 0 && d <= 7;
      })
      .sort((a, b) => daysUntilFn(a.expiryDate) - daysUntilFn(b.expiryDate))[0];

    let title, body;
    if (candidate) {
      const d = daysUntilFn(candidate.expiryDate);
      const itemName = (candidate.name || "item").trim();
      title = `${candidate.emoji || "🥑"} ${itemName} expires soon`;
      body = d <= 1
        ? `${itemName} is best used today. Tap for recipe ideas using what's in your fridge →`
        : `${itemName} expires in ${d} days. Tap for recipe ideas using what's in your fridge →`;
    } else {
      title = "🥑 Welcome to ok2eat";
      body = "Your fridge is set up. We'll nudge you when something's about to spoil.";
    }

    // Schedule for 6:30 PM local time, or 30 min from now if it's already
    // past 6:00 PM. (Past 6:30 PM, the trigger date would be in the past
    // and Notifications would either reject or fire instantly — we want
    // some delay so the user has at least exited the app first.)
    const fireAt = new Date();
    if (fireAt.getHours() >= 18) {
      fireAt.setTime(fireAt.getTime() + 30 * 60 * 1000);
    } else {
      fireAt.setHours(18, 30, 0, 0);
    }

    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: "default", data: { source: "d1_nudge" } },
      // expo-notifications accepts a Date object or a timestamp here. The
      // older `{ type: "date", date }` shape isn't required and isn't
      // supported on every SDK rev, so use the simpler form for portability.
      trigger: fireAt,
    });
    await AsyncStorage.setItem(D1_NUDGE_KEY, todayKey);
    await AsyncStorage.setItem(D1_NUDGE_ID_KEY, id);

    if (trackFn) {
      trackFn("d1_nudge_scheduled", {
        has_candidate: !!candidate,
        candidate_days_left: candidate ? daysUntilFn(candidate.expiryDate) : null,
        fire_at_hour: fireAt.getHours(),
        items_in_fridge: (allItems || []).length,
      });
    }
  } catch (e) {
    if (trackFn) trackFn("d1_nudge_failed", { message: String(e?.message || e).slice(0, 100) });
  }
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
    // v1.16 — USDA-suggested expiry date (from lookupShelfLife "foodkeeper"
    // hit at item-add time). NULL when no FoodKeeper match. Powers the
    // dual-date display in ItemDetailModal.
    expiry_usda_date: item.expiryUsdaDate || null,
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
    // v1.16 — USDA-suggested expiry from FoodKeeper at add time. NULL for
    // legacy rows + items without a FoodKeeper match. ItemDetailModal shows
    // a secondary line when this is later than expiryDate (the value moment
    // from Email 4 — "your date is conservative; USDA says it lasts longer").
    expiryUsdaDate: row.expiry_usda_date || null,
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

// ─── Smart emoji inference (v1.19) ────────────────────────────────────────────
// Items stored with category-default emojis (🍗 for any Protein, 🧀 for any
// Dairy, 🥬 for any Produce) look generic in the Fridge list. Eat First was
// already showing contextual emojis because many items happened to have
// smarter values stored at create time — but older rows (especially anything
// added via barcode/manual flow before v1.13's smart-name inference) still
// carry the category default. Rather than backfill the DB, infer at view
// time so the Fridge, Eat First, and Add-preview surfaces are consistent.
//
// Order matters: more specific tokens first (e.g. "ground beef" before
// "beef", "greek yogurt" before "yogurt"). We test substring against a
// lowercased name and return on first hit.
const FOOD_EMOJI_RULES = [
  // Proteins — fish + seafood
  [/\b(salmon|trout|tuna|cod|halibut|tilapia|bass|snapper|mackerel|sardine|anchov)/, "🐟"],
  [/\b(shrimp|prawn|lobster|crab|scallop|oyster|mussel|clam|calamari|squid|octopus)/, "🦐"],
  // Proteins — red + processed meat
  [/\b(ground beef|beef|steak|brisket|sirloin|ribeye|chuck|filet|burger patt)/, "🥩"],
  [/\b(bacon|pancetta|prosciutto|salami|pepperoni|chorizo|jerky)/, "🥓"],
  [/\b(sausage|hot dog|frank|brat|kielbasa|andouille)/, "🌭"],
  [/\b(pork|ham|ribs|tenderloin)/, "🥓"],
  [/\b(lamb|mutton|veal)/, "🥩"],
  // Proteins — poultry + eggs
  [/\b(chicken|turkey|duck|cornish|poultry|drumstick|thigh|breast|wing)/, "🍗"],
  [/\b(egg)/, "🥚"],
  // Proteins — plant-based
  [/\b(tofu|tempeh|seitan|edamame|soybean)/, "🫛"],
  [/\b(bean|lentil|chickpea|garbanzo|pea\b|peas\b|black bean|kidney bean|pinto|cannellini)/, "🫘"],
  [/\b(peanut|almond|walnut|pecan|cashew|pistachio|hazelnut|nut butter|trail mix)/, "🥜"],
  // Dairy
  [/\b(milk|half[- ]and[- ]half|cream\b|heavy cream|buttermilk)/, "🥛"],
  [/\b(yogurt|yoghurt|kefir|skyr)/, "🥛"],
  [/\b(butter|ghee|margarine)/, "🧈"],
  [/\b(ice cream|gelato|sorbet|frozen yogurt)/, "🍦"],
  [/\b(cheese|cheddar|mozzarella|parmesan|feta|brie|gouda|provolone|ricotta|cottage|cream cheese|swiss|gruyere|gruy)/, "🧀"],
  // Produce — leafy + herbs
  [/\b(cilantro|coriander|parsley|basil|mint|dill|chive|rosemary|thyme|sage|oregano|tarragon|herb)/, "🌿"],
  [/\b(spinach|kale|arugula|romaine|lettuce|salad|mesclun|spring mix|baby greens|chard|collard|bok choy|cabbage)/, "🥬"],
  // Produce — fruits
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
  // Produce — vegetables
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
  // Dry goods — grains + bread + pasta
  [/\b(bread|loaf|baguette|toast|bun|roll|bagel|english muffin|pita|naan|tortilla|wrap)/, "🍞"],
  [/\b(croissant|pastry|danish|scone|biscuit\b)/, "🥐"],
  [/\b(pasta|spaghetti|linguine|fettuccine|penne|rigatoni|macaroni|noodle|ramen|udon|soba|orzo|fusilli|farfalle|tortellini|ravioli|lasagna|gnocchi)/, "🍝"],
  [/\b(rice|jasmine|basmati|arborio|quinoa|couscous|farro|barley|bulgur|oat|granola|cereal|muesli|porridge|oatmeal)/, "🍚"],
  [/\b(flour|sugar|baking)/, "🥣"],
  [/\b(cracker|chip|pretzel|popcorn|snack)/, "🥨"],
  [/\b(cookie|brownie|cake|pie|donut|doughnut|muffin)/, "🍪"],
  [/\b(chocolate|candy|honey|jam|jelly|syrup|maple)/, "🍯"],
  // Pantry / condiment
  [/\b(oil|olive oil|vinegar|sauce|ketchup|mustard|mayo|mayonnaise|dressing|salsa|hummus|tahini|pesto|hot sauce|soy sauce|sriracha|tamari|fish sauce|oyster sauce|hoisin|gochujang|miso|curry paste)/, "🫙"],
  [/\b(salt|pepper\b|spice|seasoning|broth|stock|bouillon)/, "🧂"],
  // Beverages
  [/\b(water|sparkling|seltzer|la croix|topo chico)/, "💧"],
  [/\b(coffee|espresso|latte|cappuccino|cold brew)/, "☕"],
  [/\b(tea|matcha|chai|kombucha)/, "🍵"],
  [/\b(juice|lemonade|smoothie|cider|nectar)/, "🧃"],
  [/\b(soda|cola|pepsi|coke|sprite|fanta|root beer|ginger ale|tonic|gatorade|powerade)/, "🥤"],
  [/\b(beer|ale|lager|ipa|stout|pilsner)/, "🍺"],
  [/\b(wine|champagne|prosecco|rose\b|rosé)/, "🍷"],
  [/\b(liquor|whiskey|whisky|bourbon|vodka|gin|rum|tequila|sake)/, "🥃"],
  // Frozen / misc
  [/\b(pizza)/, "🍕"],
  [/\b(sushi|sashimi|maki|nigiri)/, "🍣"],
  [/\b(taco|burrito|quesadilla|enchilada)/, "🌮"],
  [/\b(soup|stew|chili|chowder)/, "🍲"],
  [/\b(salad)/, "🥗"],
];

function inferEmoji(name, fallback) {
  if (!name || typeof name !== "string") return fallback || "📦";
  const n = name.toLowerCase().trim();
  // Skip inference if the stored emoji is already non-default (anything other
  // than the 6 category defaults). Preserve user-edited or AI-suggested emojis.
  const defaultEmojis = ["🧀", "🍗", "🥬", "🥣", "🍶", "📦"];
  if (fallback && !defaultEmojis.includes(fallback)) return fallback;
  for (const [pattern, emoji] of FOOD_EMOJI_RULES) {
    if (pattern.test(n)) return emoji;
  }
  return fallback || "📦";
}

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

// v1.16 — per-item shelf life lookup against the FoodKeeper RPC. Returns
// { closedDays, openedDays, source } where source is "foodkeeper" on a hit
// and "category_default" on miss. Always resolves; never throws. Uses the
// max of the source's [min, max] range as the default — that's the
// optimistic-but-safe number; users override downward when they want to
// be conservative.
//
// Container is "fridge" / "pantry" / "freezer" — selects which set of fields
// to read. Defaults to fridge since that's where ~80% of items end up.
async function lookupShelfLife(name, category, container = "fridge") {
  // Tiny built-in fallback so we always have an answer.
  const fallback = {
    closedDays: EXPIRY_MAP[category] || 7,
    openedDays: OPENED_DAYS_MAP[category] || 7,
    source: "category_default",
    matchName: null,
  };
  const trimmed = (name || "").trim();
  if (trimmed.length < 2) return fallback;
  try {
    const { data, error } = await supabase.rpc("lookup_shelf_life", { query: trimmed });
    if (error || !Array.isArray(data) || data.length === 0) return fallback;
    const top = data[0];
    if ((top.score ?? 0) < 30) return fallback; // low-confidence — defer to category
    const containerKey =
      container === "freezer" ? "freezer" :
      container === "pantry"  ? "pantry"  :
                                "fridge";
    const closedMax = top[`${containerKey}_max_days`] ?? top[`${containerKey}_min_days`];
    const openedMax = top[`${containerKey}_open_max_days`] ?? top[`${containerKey}_open_min_days`];
    if (closedMax == null) {
      // No data for the requested container — try the other two before giving up.
      const fallbacksByContainer =
        container === "freezer" ? ["fridge_max_days", "pantry_max_days"] :
        container === "pantry"  ? ["fridge_max_days", "freezer_max_days"] :
                                  ["pantry_max_days", "freezer_max_days"];
      for (const k of fallbacksByContainer) {
        if (top[k] != null) {
          return {
            closedDays: Math.round(top[k]),
            openedDays: openedMax ? Math.round(openedMax) : (OPENED_DAYS_MAP[category] || 7),
            source: "foodkeeper_other_container",
            matchName: top.name,
          };
        }
      }
      return fallback;
    }
    return {
      closedDays: Math.round(closedMax),
      openedDays: openedMax ? Math.round(openedMax) : (OPENED_DAYS_MAP[category] || 7),
      source: "foodkeeper",
      matchName: top.name,
    };
  } catch (e) {
    return fallback;
  }
}

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

// v1.16 — smart default container for a parsed/typed item. Used by the
// BulkAddModal (receipt scan + sample + manual) to pre-fill each row's
// fridge/pantry/freezer assignment. Rules in priority order:
//   1. Name explicitly says "frozen" → freezer.
//   2. Produce that's typically pantry-stored (potato/onion/garlic/squash)
//      → pantry. Cooks complain when the app says their onions expire in
//      5 days; FoodKeeper pantry shelf life is weeks.
//   3. Dry Goods → pantry (canned/dried/boxed by definition).
//   4. Dairy / Protein / Produce / Beverages / Other → fridge (the safe
//      default; user can override per row).
function defaultContainerFor(name, category) {
  const n = (name || "").toLowerCase();
  if (n.includes("frozen") || n.includes("ice cream") || n.includes("ice pop") ||
      n.includes("popsicle") || n.includes("sorbet") || n.includes("frozen pizza")) {
    return "freezer";
  }
  if (category === "Produce" && (
      n.includes("potato") || n.includes("onion") || n.includes("garlic") ||
      n.includes("squash") || n.includes("yam") || n.includes("shallot"))) {
    return "pantry";
  }
  if (category === "Dry Goods") return "pantry";
  return "fridge";
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
  // v1.19 — upgrade emoji at OFF-import time so barcode-scanned items
  // arrive with a contextual emoji (🥩 for "Ground Beef 90/10") rather
  // than the category default (🍗 for all Protein).
  const trimmedName = fullName.trim();
  return { name: trimmedName, category, emoji: inferEmoji(trimmedName, EMOJI_MAP[category]), defaultExpiry: EXPIRY_MAP[category], code: barcode || p.code || null, nutritionGrade: p.nutrition_grades || null, nutrition: hasNutrition ? nutrition : null, ingredients: p.ingredients_text_en || p.ingredients_text || null };
}

// v1.14 — Open Food Facts lookups now route through lib/openFoodFacts.js,
// which adds: 4s timeout (barcode) / 6s timeout (search), User-Agent header
// per OFF's etiquette guidelines, empirically-tuned category patterns
// (Nutella → Dry Goods etc.), brand fallback heuristic, image_url capture,
// and a relevance guard on text search that drops the random-product
// false-positives we saw on the legacy direct call.
//
// Consumers expect the OLD `productFromOFF` shape (combined brand+name into
// `name`, `nutrition` object with serving + saturatedFat + fiber + sugars,
// `nutritionGrade`, `code`). The lib emits a richer shape (`brand`, `name`,
// `nutriments` object with fewer fields, `nutriScore`, `barcode`, plus new
// fields: `imageUrl`, `allergens`, `isOrganic`, `ecoScore`, `quantity`,
// `servingSize`, `source`). adaptOFFProduct bridges the two — old fields
// map back to their original names; new fields are appended for any
// consumer that wants to opt in (e.g. AddModal could surface `imageUrl`
// later without another refactor).
const _offLib = require("./lib/openFoodFacts.js");

function adaptOFFProduct(p) {
  if (!p) return null;
  const cat = p.category;
  // Old shape merged brand into name when name didn't already include it.
  // Preserve that behavior so existing AddModal copy + recently-used chips
  // render the same string for a given barcode.
  const fullName = p.brand && p.name && !p.name.toLowerCase().includes(p.brand.toLowerCase())
    ? `${p.brand} ${p.name}`
    : (p.name || "Unknown Product");
  // Build the OLD `nutrition` object shape from the lib's slimmer
  // `nutriments`. Lib doesn't expose saturatedFat / fiber / sugars per_100g
  // (they require fields the v2 endpoint omits), so those stay null. UI
  // already handles null gracefully (renders nothing).
  const n = p.nutriments || {};
  const hasNutrition = Object.values(n).some(v => v != null);
  const nutrition = hasNutrition
    ? {
        serving: p.servingSize || "100g",
        calories: n.calories_per_100g ?? null,
        fat: n.fat_g ?? null,
        saturatedFat: null,
        carbs: n.carbs_g ?? null,
        sugars: n.sugar_g ?? null,
        fiber: null,
        protein: n.protein_g ?? null,
        salt: n.salt_g ?? null,
      }
    : null;
  return {
    // ── Old-shape fields (existing consumers) ────────────────────────
    name: fullName.trim(),
    category: cat,
    emoji: p.emoji,
    defaultExpiry: EXPIRY_MAP[cat] || 7,
    code: p.barcode || null,
    nutritionGrade: p.nutriScore || null,
    nutrition,
    ingredients: p.ingredients || null,
    // ── Bonus fields from the new lib (opt-in for callers) ──────────
    brand: p.brand || null,
    imageUrl: p.imageUrl || null,
    allergens: p.allergens || [],
    isOrganic: !!p.isOrganic,
    ecoScore: p.ecoScore || null,
    quantity: p.quantity || null,
    source: p.source || null,
  };
}

async function lookupBarcode(barcode) {
  const product = await _offLib.lookupByBarcode(barcode);
  return adaptOFFProduct(product);
}

async function searchProducts(query) {
  const products = await _offLib.searchByText(query, { pageSize: 10 });
  return products.map(adaptOFFProduct).filter(Boolean);
}

// ─── Theme ────────────────────────────────────────────────────────────────────
const T = { bg: "#F7FAF7", surface: "#FFFFFF", card: "#FFFFFF", accent: "#16A34A", warn: "#EA580C", danger: "#DC2626", muted: "#9CA3AF", text: "#111827", textSoft: "#6B7280", border: "#E5E7EB" };
function daysUntil(dateStr) { return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000); }
function expiryColor(days) { return days <= 1 ? T.danger : days <= 3 ? T.warn : T.accent; }
function formatDate(dateStr) { return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function round1(n) { return Math.round(n * 10) / 10; }

// ─── Recipe share helpers ─────────────────────────────────────────────────────
// v1.22 #240 — Share has to work for two kinds of recipes:
//   1. Bank-backed (recipe_bank slug, stable public URL at /recipes/{slug})
//      → share the URL, recipient gets Universal Link → app or web preview.
//   2. Ephemeral (Haiku-generated for EatMeFirst, no recipe_bank row, id is
//      either a uuid or a YYYYMMDD-userid-N cache key) → no public URL exists,
//      so share the full recipe text instead. Recipient gets ingredients +
//      instructions inline.
//
// `isShareableRecipeId` recognizes the bank shape (lowercase letters/digits/
// hyphens, no leading date prefix, no uuid pattern). Anything else falls back
// to text-share. `formatRecipeAsShareText` builds the message body. The
// formatted text is also what bank-backed shares get as the body next to the
// url field on iOS (so the recipient sees more than just the title).
function isShareableRecipeId(id) {
  if (!id) return false;
  const s = String(id);
  // Daily-cache ids: YYYYMMDD-{userid12}-{position}
  if (/^\d{8}-/.test(s)) return false;
  // UUID v4 (saved ephemeral row ids)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return false;
  // Bank slugs look like "lemon-garlic-chicken" — letters/digits/hyphens only
  return /^[a-z0-9][a-z0-9-]*$/i.test(s);
}

function formatRecipeAsShareText(recipe) {
  if (!recipe) return "";
  const parts = [];
  parts.push(recipe.name || "Recipe");
  const meta = [recipe.time, recipe.difficulty].filter(Boolean).join(" · ");
  if (meta) parts.push(meta);
  if (recipe.description) parts.push("", recipe.description);
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  if (ingredients.length) {
    parts.push("", "INGREDIENTS");
    for (const ing of ingredients) {
      if (typeof ing === "string") {
        parts.push(`• ${ing}`);
      } else if (ing && typeof ing === "object") {
        const qty = [ing.amount, ing.unit].filter(Boolean).join(" ");
        const line = [qty, ing.name || ing.item].filter(Boolean).join(" ");
        if (line) parts.push(`• ${line}`);
      }
    }
  }
  const instructions = Array.isArray(recipe.instructions) ? recipe.instructions : [];
  if (instructions.length) {
    parts.push("", "INSTRUCTIONS");
    instructions.forEach((step, i) => { if (step) parts.push(`${i + 1}. ${step}`); });
  }
  if (recipe.tip) parts.push("", `Tip: ${recipe.tip}`);
  parts.push("", "Shared from ok2eat — https://ok2eat.com");
  return parts.join("\n");
}

// shareRecipe — single entry-point used by every recipe-share button on iOS+
// Android. Picks URL-share vs text-share based on whether the recipe has a
// resolvable public id. Pass `sourceRecipeId` when the recipe came from a
// saved row that points at a bank slug (user_recipes_saved.source_recipe_id)
// — that overrides the recipe.id check.
//
// Returns the Share.share result (Share.sharedAction / Share.dismissedAction)
// so callers can fire analytics on success.
async function shareRecipe(recipe, opts = {}) {
  if (!recipe) return null;
  const name = recipe.name || "Recipe";
  const text = formatRecipeAsShareText(recipe);
  const bankId = opts.sourceRecipeId || (isShareableRecipeId(recipe.id) ? recipe.id : null);
  if (bankId) {
    const url = `https://ok2eat.com/recipes/${encodeURIComponent(bankId)}?utm_source=share&utm_medium=mobile_app&utm_campaign=recipe_share`;
    // iOS: url goes in the dedicated field so iMessage renders ONE preview.
    // The message body still carries the full recipe text so AirDrop/Mail/etc.
    // include it. Android ignores the url field, so we append the URL to the
    // text body manually.
    return await Share.share(Platform.OS === "ios"
      ? { message: `${text}\n\n${url}`, url, title: name }
      : { message: `${text}\n\n${url}`, title: name });
  }
  // Ephemeral — no public URL exists. Pure text share.
  return await Share.share({ message: text, title: name });
}

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
      {/* v1.15 — KeyboardAvoidingView lifts the sheet above the numeric keyboard
          when autoFocus opens it. Without this, the Use/Use-it-all/Cancel buttons
          are hidden behind the keyboard and users can't see what to tap. */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
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
      </KeyboardAvoidingView>
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
    // v1.19 — persist the inferred (contextual) emoji on save. Older items
    // stored a category default; once the user edits anything, we upgrade
    // them to the smart emoji so the DB row matches what the UI shows.
    const trimmedName = name.trim();
    const updates = { name: trimmedName, category, emoji: inferEmoji(trimmedName, emojiMap[category] || item.emoji), quantity: safeQty, unit: (unit || "").trim() || null, expiry_date: expiryDate ? new Date(expiryDate).toISOString() : item.expiryDate };
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
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg, paddingTop: ANDROID_TOP_INSET }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.border }}>
          <TouchableOpacity onPress={onClose}><Text style={{ color: T.accent, fontSize: 15 }}>← Back</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => editing ? handleSave() : setEditing(true)}>
            <Text style={{ color: T.accent, fontSize: 15, fontWeight: "700" }}>{editing ? "Save" : "Edit"}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: "center", padding: 24, paddingBottom: 16 }}>
            <Text style={{ fontSize: 72 }}>{inferEmoji(name || item.name, emojiMap[category] || item.emoji)}</Text>
            {editing ? <TextInput style={[s.input, { textAlign: "center", fontSize: 18, fontWeight: "700", marginTop: 12, marginBottom: 0, width: "100%" }]} value={name} onChangeText={setName} /> : <Text style={[s.pageTitle, { textAlign: "center", marginTop: 12, fontSize: 22 }]}>{item.name}</Text>}
            <View style={[s.expiryBadge, { backgroundColor: color + "22", borderColor: color + "55", marginTop: 10 }]}>
              {/* v1.21 2026-05-15 — day-0 reads "Use today" instead of "Expired"; an item expiring today is still safe to cook tonight. Same split shipped in web helpers + EatMeFirst + Demo. */}
              <Text style={[s.expiryText, { color, fontSize: 13 }]}>{days < 0 ? "Expired" : days === 0 ? "Use today" : days === 1 ? "Expires tomorrow" : `Expires in ${days} days`}</Text>
            </View>
            {/* v1.16 — dual-date: when the user's expiry is conservative
                relative to USDA FoodKeeper's window, surface the gap. Only
                shown when usdaDate is later than expiryDate by at least 2
                days (avoids noise when they nearly agree). Validates Email 4
                tip 4's "the app shows both, so you stop trashing yogurt
                that's fine." */}
            {(() => {
              if (!item.expiryUsdaDate || !item.expiryDate) return null;
              const usdaMs = new Date(item.expiryUsdaDate).getTime();
              const expMs  = new Date(item.expiryDate).getTime();
              if (!Number.isFinite(usdaMs) || !Number.isFinite(expMs)) return null;
              const gapDays = Math.round((usdaMs - expMs) / 86400000);
              if (gapDays < 2) return null;
              const usdaTotal = Math.max(0, Math.round((usdaMs - Date.now()) / 86400000));
              return (
                <View style={{ marginTop: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "rgba(22,163,74,0.08)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(22,163,74,0.2)" }}>
                  <Text style={{ fontSize: 12, color: T.accent, fontWeight: "600", textAlign: "center" }}>
                    🌿 USDA shelf life: {usdaTotal} {usdaTotal === 1 ? "day" : "days"} ({gapDays}+ longer than your date)
                  </Text>
                </View>
              );
            })()}
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
      {/* v1.21 — Cancel pill (was a tiny ✕). Greg's Pixel 9 testing showed
          the old close button was easy to miss against busy camera feeds.
          Pill format is bigger, labelled, and offset by ANDROID_TOP_INSET
          so it doesn't sit under the status bar / camera punch-hole. */}
      <TouchableOpacity
        onPress={onClose}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={{ position: "absolute", top: 20 + ANDROID_TOP_INSET, right: 20, paddingHorizontal: 16, paddingVertical: 9, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 6 }}
      >
        <Text style={{ color: "#fff", fontSize: 16, lineHeight: 18, fontWeight: "700" }}>✕</Text>
        <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Cancel</Text>
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
  // v1.17 — UI states for the confirmation-resend flow.
  //  signedUpPending: after a successful signUp, switch to a "check your inbox"
  //    screen with a Resend button. This is the cohort that previously got
  //    stuck (1 user reported the email went to spam with no way to retry).
  //  needsConfirm: surfaced when Sign In fails with Supabase's "Email not
  //    confirmed" error. Inline Resend button appears in the error box.
  //  resendingConfirm: spinner state for the Resend tap.
  //  resendMsg: success/error toast under the button.
  const [signedUpPending, setSignedUpPending] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [resendingConfirm, setResendingConfirm] = useState(false);
  const [resendMsg, setResendMsg] = useState("");

  // v1.17 — Resend the Supabase Auth confirmation email for the typed address.
  // Idempotent on Supabase's side; safe to spam (Supabase rate-limits at 1/min).
  async function handleResendConfirm() {
    const addr = (email || "").trim();
    if (!addr) { setResendMsg("Enter your email address first."); return; }
    setResendingConfirm(true);
    setResendMsg("");
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: addr });
      if (error) throw error;
      track("auth_confirm_resend_requested", { method: "email" });
      setResendMsg("Sent! Check your inbox (and spam folder).");
    } catch (e) {
      setResendMsg(e?.message || "Couldn't resend. Try again in a minute.");
    }
    setResendingConfirm(false);
  }

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
    setLoading(true); setError(""); setNeedsConfirm(false); setResendMsg("");
    try {
      if (mode === "login") {
        const { error, data } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        if (data?.user) { identifyUser(data.user.id); track("user_signed_in", { method: "email" }); }
      } else {
        const { error, data } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (data?.user) { identifyUser(data.user.id); track("user_signed_up", { method: "email" }); }
        // v1.17 — was: Alert "Account created!" + setMode("login"). Replaced
        // with a dedicated "check your inbox" screen that surfaces a Resend
        // button. 63% of pre-v1.17 signups never confirmed (mostly emails
        // hitting spam with no retry affordance) — this is the fix for that.
        setSignedUpPending(true);
      }
    } catch (e) {
      const msg = e?.message || "Something went wrong. Please try again.";
      // v1.17 — surface the email-not-confirmed flow inline. Supabase returns
      // various error messages depending on auth settings; match loosely.
      const looksLikeNotConfirmed =
        /not confirmed|not verified|email link is invalid|confirm your email/i.test(msg);
      if (looksLikeNotConfirmed) {
        setNeedsConfirm(true);
        setError("Your email isn't confirmed yet. Check your inbox for a confirmation email.");
      } else {
        setError(msg);
      }
    }
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
          {signedUpPending ? (
            /* v1.17 — Post-signup confirmation screen. Replaces the previous
               Alert + bounce-to-login. Tells the user explicitly what to do
               next AND gives them a one-tap recovery if the email vanished
               into spam. */
            <View style={[s.card, { padding: 24, marginBottom: 16 }]}>
              <Text style={{ fontSize: 28, marginBottom: 12, textAlign: "center" }}>📬</Text>
              <Text style={{ fontSize: 20, fontWeight: "700", color: T.text, textAlign: "center", marginBottom: 8 }}>
                Check your email
              </Text>
              <Text style={{ fontSize: 14, color: T.textSoft, textAlign: "center", lineHeight: 20, marginBottom: 20 }}>
                We sent a confirmation link to{"\n"}
                <Text style={{ fontWeight: "700", color: T.text }}>{email.trim()}</Text>.{"\n"}
                Click it to finish signing up.
              </Text>
              <View style={{ backgroundColor: T.card, borderRadius: 10, padding: 12, marginBottom: 16 }}>
                <Text style={{ fontSize: 12, color: T.muted, lineHeight: 18, textAlign: "center" }}>
                  Not in your inbox? Check the spam folder — sometimes new accounts land there.
                </Text>
              </View>
              <TouchableOpacity
                style={[s.btnPrimary, resendingConfirm && { opacity: 0.6 }]}
                onPress={handleResendConfirm}
                disabled={resendingConfirm}
              >
                {resendingConfirm
                  ? <ActivityIndicator color="#FFFFFF" />
                  : <Text style={s.btnPrimaryText}>Resend confirmation</Text>}
              </TouchableOpacity>
              {resendMsg !== "" && (
                <Text style={{ fontSize: 12, color: T.textSoft, textAlign: "center", marginTop: 10 }}>{resendMsg}</Text>
              )}
              <TouchableOpacity
                style={{ marginTop: 14, alignItems: "center", paddingVertical: 10 }}
                onPress={() => { setSignedUpPending(false); setMode("login"); setPassword(""); setResendMsg(""); }}
              >
                <Text style={{ color: T.textSoft, fontSize: 14, fontWeight: "600" }}>Back to sign in</Text>
              </TouchableOpacity>
            </View>
          ) : (
          <View style={[s.card, { padding: 24, marginBottom: 16 }]}>
            <View style={[s.modeToggle, { marginBottom: 20, marginHorizontal: 0 }]}>
              <TouchableOpacity style={[s.modeBtn, mode === "login" && s.modeBtnActive]} onPress={() => { setMode("login"); setError(""); setNeedsConfirm(false); setResendMsg(""); }}>
                <Text style={[s.modeBtnText, mode === "login" && s.modeBtnTextActive]}>Sign In</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modeBtn, mode === "signup" && s.modeBtnActive]} onPress={() => { setMode("signup"); setError(""); setNeedsConfirm(false); setResendMsg(""); }}>
                <Text style={[s.modeBtnText, mode === "signup" && s.modeBtnTextActive]}>Create Account</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.inputLabel}>Email</Text>
            <TextInput style={s.input} placeholder="you@example.com" placeholderTextColor={T.muted} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
            <Text style={s.inputLabel}>Password</Text>
            <TextInput style={s.input} placeholder="••••••••" placeholderTextColor={T.muted} value={password} onChangeText={setPassword} secureTextEntry />
            {error !== "" && (
              <View style={[s.errorBox, { marginBottom: 12 }]}>
                <Text style={{ color: T.danger, fontSize: 13 }}>{error}</Text>
                {/* v1.17 — Inline "Resend confirmation" affordance when
                    Supabase Auth tells us the user's email isn't confirmed.
                    Same handler as the post-signup screen. */}
                {needsConfirm && (
                  <>
                    <TouchableOpacity
                      style={{ marginTop: 10, alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: T.danger }}
                      onPress={handleResendConfirm}
                      disabled={resendingConfirm}
                    >
                      {resendingConfirm
                        ? <ActivityIndicator color={T.danger} size="small" />
                        : <Text style={{ color: T.danger, fontSize: 12, fontWeight: "700" }}>Resend confirmation email</Text>}
                    </TouchableOpacity>
                    {resendMsg !== "" && (
                      <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 8 }}>{resendMsg}</Text>
                    )}
                  </>
                )}
              </View>
            )}
            <TouchableOpacity style={s.btnPrimary} onPress={handleAuth} disabled={loading}>
              {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.btnPrimaryText}>{mode === "login" ? "Sign In" : "Create Account"}</Text>}
            </TouchableOpacity>
          </View>
          )}
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

function FridgeScreen({ items, onDelete, onBulkDelete, onAdd, onUpdate, onUse, loading, householdName, onOpenManageInventory, onScanReceipt, onTrySample }) {
  const [filter, setFilter] = useState("All");
  const [selectedItem, setSelectedItem] = useState(null);
  const [useItem, setUseItem] = useState(null);
  const [activeSection, setActiveSection] = useState("fridge");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  // v1.0.10 — inventory search. Filters items in-place by case-insensitive
  // name substring across the active container.
  const [searchQuery, setSearchQuery] = useState("");

  // v1.22 #235 (sky21__) — Fridge sort. Default "added" matches the
  // previous behavior (newest first). Other options: "expiring" (soonest
  // first), "longest" (latest first), "az" (alphabetical). Persists per
  // session only; reset on app relaunch is fine.
  const [sortBy, setSortBy] = useState("added");

  // v1.15 — expiring_soon_viewed. Fires once per fridge load when items are
  // present and at least one is within 3 days of expiring. This is the moment
  // the value prop is delivered ("hey, your bell peppers are about to go bad")
  // — by tracking it we can correlate retention with whether users actually
  // hit that moment vs. bouncing on an empty fridge.
  const [expiringSeenForLoad, setExpiringSeenForLoad] = useState(false);
  useEffect(() => {
    if (loading || expiringSeenForLoad) return;
    if (items.length === 0) return;
    const expiringCount = items.filter(i => {
      const d = daysUntil(i.expiryDate);
      return d > 0 && d <= 3;
    }).length;
    const expiredCount = items.filter(i => daysUntil(i.expiryDate) <= 0).length;
    track("expiring_soon_viewed", {
      total_items: items.length,
      expiring_count: expiringCount,
      expired_count: expiredCount,
      has_actionable: expiringCount > 0 || expiredCount > 0,
    });
    setExpiringSeenForLoad(true);
  }, [loading, items.length, expiringSeenForLoad]);

  // v1.15 — search_used. Debounced fire on actual search activity (not every
  // keystroke). 600ms after the user stops typing AND the query has at least
  // 2 chars AND it produces a different filter than empty.
  const searchFireTimer = useRef(null);
  const lastSearchFired = useRef("");
  useEffect(() => {
    if (searchFireTimer.current) clearTimeout(searchFireTimer.current);
    const q = searchQuery.trim();
    if (q.length < 2 || q === lastSearchFired.current) return;
    searchFireTimer.current = setTimeout(() => {
      track("search_used", { query_length: q.length, container: activeSection });
      lastSearchFired.current = q;
    }, 600);
    return () => { if (searchFireTimer.current) clearTimeout(searchFireTimer.current); };
  }, [searchQuery, activeSection]);

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
  // v1.22 #235 — apply user-selected sort. Items array isn't huge so the
  // .slice() copy + sort is fine perf-wise (typical fridges: <50 items).
  const sorted = (() => {
    const arr = filtered.slice();
    if (sortBy === "expiring") {
      arr.sort((a, b) => daysUntil(a.expiryDate) - daysUntil(b.expiryDate));
    } else if (sortBy === "longest") {
      arr.sort((a, b) => daysUntil(b.expiryDate) - daysUntil(a.expiryDate));
    } else if (sortBy === "az") {
      arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }
    // "added" → leave alone (already in created_at DESC from the query)
    return arr;
  })();
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
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginTop: 4, marginBottom: 4 }}>
              <Text style={[s.sectionLabel, { paddingHorizontal: 0, marginTop: 0 }]}>{filter === "expiring" ? "// EXPIRING SOON" : filter === "expired" ? "// EXPIRED — REMOVE OR DISCARD" : "// CONTENTS · TAP TO VIEW DETAILS"}</Text>
              {/* v1.22 #235 — Sort dropdown. Compact chip row to the right
                  of the section label. Tap cycles through the 4 options
                  (added → expiring → longest → az → added). Visible label
                  shows the active sort. */}
              {filtered.length > 1 && (
                <TouchableOpacity
                  onPress={() => {
                    const order = ["added", "expiring", "longest", "az"];
                    const next = order[(order.indexOf(sortBy) + 1) % order.length];
                    setSortBy(next);
                    track("fridge_sort_changed", { from: sortBy, to: next });
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: T.bg, borderWidth: 1, borderColor: T.border }}
                >
                  <Ionicons name="swap-vertical" size={12} color={T.textSoft} />
                  <Text style={{ color: T.text, fontSize: 11, fontWeight: "600" }}>
                    {sortBy === "added" ? "Recently added" : sortBy === "expiring" ? "Expires soonest" : sortBy === "longest" ? "Expires latest" : "A→Z"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
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
                // v1.15 — receipt-scan-first empty state. Promotes the
                // marquee feature (receipt scan = killer demo, currently at
                // 4% adoption) above manual add. "Try a sample receipt" is
                // the no-friction path for users without a receipt to hand,
                // so they can see what the populated fridge looks like.
                <View style={{ alignItems: "center", paddingVertical: 32, paddingHorizontal: 20 }}>
                  <Text style={{ fontSize: 56 }}>🧊</Text>
                  <Text style={[s.bold, { fontSize: 20, marginTop: 12, textAlign: "center" }]}>Let's fill your fridge</Text>
                  <Text style={{ color: T.textSoft, fontSize: 14, marginTop: 6, textAlign: "center", maxWidth: 320, lineHeight: 20 }}>
                    Snap a grocery receipt and we'll auto-add every item with smart expiry dates. ~10 seconds, no typing.
                  </Text>
                  <TouchableOpacity
                    style={[s.btnPrimary, { marginTop: 22, width: "100%", maxWidth: 320 }]}
                    onPress={() => onScanReceipt && onScanReceipt()}
                    accessibilityLabel="Scan a grocery receipt"
                  >
                    <Text style={s.btnPrimaryText}>📷  Scan a grocery receipt</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ marginTop: 12, paddingVertical: 10, paddingHorizontal: 16 }}
                    onPress={() => onTrySample && onTrySample()}
                    accessibilityLabel="Try a sample receipt"
                  >
                    <Text style={{ color: T.accent, fontSize: 14, fontWeight: "600" }}>✨ Try a sample receipt →</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ marginTop: 16, paddingVertical: 8 }}
                    onPress={() => onAdd && onAdd(activeSection)}
                    accessibilityLabel="Add items manually"
                  >
                    <Text style={{ color: T.muted, fontSize: 13 }}>or add items manually →</Text>
                  </TouchableOpacity>
                </View>
              )
            )}
            {sorted.map(item => {
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
                      <Text style={{ fontSize: 32, width: 44, textAlign: "center" }}>{inferEmoji(item.name, item.emoji)}</Text>
                    )}
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      {/* v1.22 #237 (sky21__) — allow 2 lines on name so
                          brand-prefixed receipt-scan items become
                          distinguishable. "Black Swan RD Eat Healthy
                          Chicken Breast 250g" vs the 500g variant were
                          rendering identically when truncated to 1 line. */}
                      <Text style={s.itemName} numberOfLines={2}>{item.name}</Text>
                      <Text style={s.itemMeta}>{item.category} · {formatQty(item)}</Text>
                      {item.barcode && <Text style={[s.monoText, { color: T.muted, fontSize: 10, marginTop: 2 }]}>#{item.barcode}</Text>}
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 8 }}>
                      {/* v1.21 2026-05-15 — compact-badge variant. Day-0 collapses to "Today" since "Use today" is too wide for the row-trailing pill; "Expired" stays for truly past items. */}
                      <View style={[s.expiryBadge, { backgroundColor: color + "22", borderColor: color + "55" }]}><Text style={[s.expiryText, { color }]}>{days < 0 ? "Expired" : days === 0 ? "Today" : days === 1 ? "1 day" : `${days}d`}</Text></View>
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
        <TouchableOpacity
          key={i}
          style={[s.card, { margin: 16, marginBottom: 12, padding: 16 }]}
          onPress={() => {
            // v1.15 — recipe_tapped fires when user opens a specific recipe
            // (intent-of-cooking signal, distinct from recipe_generated which
            // is just "the AI returned options"). source=ai vs source=suggested
            // tells us whether the AI Generate flow or the static fallback list
            // is what users engage with.
            track("recipe_tapped", {
              source: recipes.length > 0 ? "ai" : "suggested",
              position: i,
              recipe_name: recipe.name,
            });
            setSelected(recipe);
          }}
        >
          <View style={{ flexDirection: "row", gap: 14 }}><View style={s.recipeEmojiBox}><Text style={{ fontSize: 28 }}>{recipe.emoji}</Text></View><View style={{ flex: 1 }}><Text style={[s.bold, { fontSize: 16 }]}>{recipe.name}</Text><Text style={{ color: T.textSoft, fontSize: 12, marginTop: 4 }}>⏱ {recipe.time}  ·  {recipe.difficulty}</Text><Text style={{ color: T.muted, fontSize: 12, marginTop: 6, lineHeight: 18 }} numberOfLines={2}>{recipe.description}</Text></View></View>
        </TouchableOpacity>
      ))}
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ─── Reminders Screen ─────────────────────────────────────────────────────────
// v1.16 — dietary + allergen + household-size constants kept in sync with
// the matching maps in supabase/functions/generate-recipes/index.ts. Change
// one, change the other.
const DIETARY_OPTIONS = [
  { id: "vegetarian",  label: "Vegetarian",  emoji: "🥗" },
  { id: "vegan",       label: "Vegan",       emoji: "🌱" },
  { id: "pescatarian", label: "Pescatarian", emoji: "🐟" },
  { id: "gluten_free", label: "Gluten-free", emoji: "🌾" },
  { id: "dairy_free",  label: "Dairy-free",  emoji: "🥛" },
  { id: "nut_free",    label: "Nut-free",    emoji: "🥜" },
  { id: "low_carb",    label: "Low-carb",    emoji: "🥩" },
  { id: "keto",        label: "Keto",        emoji: "🥑" },
];
const ALLERGEN_OPTIONS = [
  { id: "peanut",    label: "Peanut" },
  { id: "tree_nut",  label: "Tree nuts" },
  { id: "shellfish", label: "Shellfish" },
  { id: "fish",      label: "Fish" },
  { id: "egg",       label: "Egg" },
  { id: "milk",      label: "Milk" },
  { id: "soy",       label: "Soy" },
  { id: "wheat",     label: "Wheat" },
  { id: "sesame",    label: "Sesame" },
];

function RemindersScreen({ items, notificationsEnabled, onToggleNotifications, emailDigestEnabled, onToggleEmailDigest }) {
  const [dismissed, setDismissed] = useState([]);
  const [reorderItem, setReorderItem] = useState(null);
  // v1.16 Tier 2 — dietary prefs + household. Local state mirrors user_settings;
  // writes go through upsert on toggle/change. Optimistic — server failure
  // just gets logged, the next mount will resync.
  const [dietary, setDietary]           = useState([]);
  const [allergens, setAllergens]       = useState([]);
  const [householdSize, setHouseholdSize] = useState(1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from("user_settings")
          .select("dietary_restrictions, allergens, household_size")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cancelled || !data) return;
        if (Array.isArray(data.dietary_restrictions)) setDietary(data.dietary_restrictions);
        if (Array.isArray(data.allergens)) setAllergens(data.allergens);
        if (Number.isFinite(Number(data.household_size))) setHouseholdSize(Math.max(1, Number(data.household_size)));
      } catch (e) {
        console.warn("user_settings fetch failed:", e?.message || e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function persistProfile(patch) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("user_settings").upsert({
        user_id: user.id,
        dietary_restrictions: patch.dietary ?? dietary,
        allergens: patch.allergens ?? allergens,
        household_size: patch.householdSize ?? householdSize,
      });
      track("profile_updated", {
        dietary_count: (patch.dietary ?? dietary).length,
        allergen_count: (patch.allergens ?? allergens).length,
        household_size: patch.householdSize ?? householdSize,
      });
    } catch (e) {
      console.warn("user_settings upsert failed:", e?.message || e);
    }
  }

  function toggleDietary(id) {
    const next = dietary.includes(id) ? dietary.filter(d => d !== id) : [...dietary, id];
    setDietary(next);
    persistProfile({ dietary: next });
  }
  function toggleAllergen(id) {
    const next = allergens.includes(id) ? allergens.filter(a => a !== id) : [...allergens, id];
    setAllergens(next);
    persistProfile({ allergens: next });
  }
  function changeHouseholdSize(delta) {
    const next = Math.max(1, Math.min(20, householdSize + delta));
    if (next === householdSize) return;
    setHouseholdSize(next);
    persistProfile({ householdSize: next });
  }
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

      {/* v1.16 Tier 2 — Household size. Drives recipe portion scaling +
          waste-estimate copy. Single number, +/- stepper. Saves immediately. */}
      <View style={[s.card, { marginHorizontal: 16, padding: 16, marginBottom: 12 }]}>
        <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 6, paddingHorizontal: 0 }]}>HOUSEHOLD SIZE</Text>
        <Text style={{ color: T.textSoft, fontSize: 12, marginBottom: 12 }}>
          Recipes scale automatically. We'll also personalize your waste-savings number.
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <TouchableOpacity
            onPress={() => changeHouseholdSize(-1)}
            disabled={householdSize <= 1}
            style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: householdSize <= 1 ? T.border : "rgba(22,163,74,0.10)",
              borderWidth: 1, borderColor: householdSize <= 1 ? T.border : T.accent,
              alignItems: "center", justifyContent: "center",
              opacity: householdSize <= 1 ? 0.5 : 1,
            }}
            accessibilityLabel="Decrease household size"
          ><Text style={{ fontSize: 22, color: T.accent, fontWeight: "700" }}>−</Text></TouchableOpacity>
          <View style={{ alignItems: "center" }}>
            <Text style={{ fontSize: 36, fontWeight: "800", color: T.text }}>{householdSize}</Text>
            <Text style={{ fontSize: 12, color: T.textSoft }}>{householdSize === 1 ? "person" : "people"}</Text>
          </View>
          <TouchableOpacity
            onPress={() => changeHouseholdSize(1)}
            disabled={householdSize >= 20}
            style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: householdSize >= 20 ? T.border : "rgba(22,163,74,0.10)",
              borderWidth: 1, borderColor: householdSize >= 20 ? T.border : T.accent,
              alignItems: "center", justifyContent: "center",
              opacity: householdSize >= 20 ? 0.5 : 1,
            }}
            accessibilityLabel="Increase household size"
          ><Text style={{ fontSize: 22, color: T.accent, fontWeight: "700" }}>+</Text></TouchableOpacity>
        </View>
      </View>

      {/* v1.16 Tier 2 — Dietary preferences. Multi-select toggle chips.
          Each tap saves to user_settings + re-flows recipe-gen on next request. */}
      <View style={[s.card, { marginHorizontal: 16, padding: 16, marginBottom: 12 }]}>
        <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 6, paddingHorizontal: 0 }]}>DIETARY PREFERENCES</Text>
        <Text style={{ color: T.textSoft, fontSize: 12, marginBottom: 12 }}>
          Tap what applies. Recipes will respect these. {dietary.length === 0 ? "None selected." : `${dietary.length} active.`}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {DIETARY_OPTIONS.map(opt => {
            const active = dietary.includes(opt.id);
            return (
              <TouchableOpacity
                key={opt.id}
                onPress={() => toggleDietary(opt.id)}
                style={{
                  paddingVertical: 8, paddingHorizontal: 12,
                  borderRadius: 18, borderWidth: 1,
                  borderColor: active ? T.accent : T.border,
                  backgroundColor: active ? "rgba(22,163,74,0.10)" : T.card,
                }}
                accessibilityLabel={`${active ? "Remove" : "Add"} ${opt.label}`}
                accessibilityState={{ selected: active }}
              >
                <Text style={{ fontSize: 13, fontWeight: active ? "700" : "500", color: active ? T.accent : T.textSoft }}>
                  {opt.emoji} {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* v1.16 Tier 2 — Allergens. Same chip pattern but framed as safety-
          critical. Edge Function treats these as MUST-NOT-CONTAIN. */}
      <View style={[s.card, { marginHorizontal: 16, padding: 16, marginBottom: 12 }]}>
        <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 6, paddingHorizontal: 0 }]}>ALLERGIES</Text>
        <Text style={{ color: T.textSoft, fontSize: 12, marginBottom: 12 }}>
          Safety-critical — we'll always exclude these from recipe suggestions.
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {ALLERGEN_OPTIONS.map(opt => {
            const active = allergens.includes(opt.id);
            return (
              <TouchableOpacity
                key={opt.id}
                onPress={() => toggleAllergen(opt.id)}
                style={{
                  paddingVertical: 8, paddingHorizontal: 12,
                  borderRadius: 18, borderWidth: 1,
                  borderColor: active ? T.danger : T.border,
                  backgroundColor: active ? "rgba(220,38,38,0.10)" : T.card,
                }}
                accessibilityLabel={`${active ? "Remove" : "Add"} ${opt.label} allergy`}
                accessibilityState={{ selected: active }}
              >
                <Text style={{ fontSize: 13, fontWeight: active ? "700" : "500", color: active ? T.danger : T.textSoft }}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
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

// ─── Eat Me First Screen ─────────────────────────────────────────────────────
// v1.16 headline tab. Ranks fridge items by urgency (days-until-expiry plus a
// per-category spoil weighting), shows the top 12, and gives each row a one-
// tap "Get recipes" button that calls generate-recipes with that item leading
// + the 4 next-most-urgent items as context. The web mirror lives at
// web/src/screens/EatMeFirst.jsx — keep the urgency score in sync.
function urgencyScoreIOS(item) {
  const d = daysUntil(item.expiryDate);
  if (d <= 0) return -1000 + d;
  const spoil = {
    Produce: -0.5, Dairy: -0.4, Protein: -0.3, Bakery: -0.2,
    Frozen: 0.5, "Dry goods": 0.8, Beverages: 0.2,
  }[item.category] ?? 0;
  return d + spoil;
}
function urgencyBadgeIOS(days) {
  // v1.21 2026-05-15 — "Use today" for day-0 (still safe), "Expired" only
  // for truly past items. Same split as web helpers.expiryLabel +
  // EatMeFirst.urgencyBadge + Demo.urgencyBadge.
  if (days < 0)   return { text: "Expired",          color: T.danger, bg: "rgba(220,38,38,0.12)" };
  if (days === 0) return { text: "Use today",        color: T.danger, bg: "rgba(220,38,38,0.12)" };
  if (days === 1) return { text: "Expires tomorrow", color: T.danger, bg: "rgba(220,38,38,0.12)" };
  if (days <= 3)  return { text: `${days} days left`, color: T.warn,  bg: "rgba(234,88,12,0.12)" };
  if (days <= 7)  return { text: `${days} days left`, color: "#CA8A04", bg: "rgba(202,138,4,0.12)" };
  return            { text: `${days} days left`, color: T.accent, bg: "rgba(22,163,74,0.12)" };
}

// v1.19 — Local ingredient matcher used by Eat First's recipe detail view.
// Eat First recipes are AI-generated on the fly with no stable id, so the
// server-side match-recipe-inventory function (which keys on recipe_id)
// can't help. This local matcher does substring + token-overlap matching
// between the recipe ingredient string and the user's fridge item names —
// good enough for the "do I have this?" decision the user is making.
//
// Returns the matched fridge item or null. Order of strategies:
//   1. Direct substring (either way) — "salmon" ↔ "Salmon fillet"
//   2. Token overlap on words ≥ 3 chars — "ground beef" → tokens [ground, beef]
//      then any item whose name contains either token wins.
function _normalizeForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    // Strip parens content ("(fresh)", "(optional)")
    .replace(/\([^)]*\)/g, " ")
    // Strip common quantity prefixes if they slipped through
    .replace(/^\d+(\.\d+)?\s*(oz|lb|cup|cups|tsp|tbsp|g|kg|ml|l)\b/, "")
    // Collapse to alphanumeric+space
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Strip trailing 's' (cheap pluralization)
    .replace(/\b(\w+?)(s|es)\b/g, "$1");
}
const _MATCH_STOPWORDS = new Set([
  "and", "or", "of", "the", "for", "with", "to", "a", "an", "in", "on", "at",
  "fresh", "frozen", "dried", "chopped", "diced", "sliced", "minced", "grated",
  "shredded", "ground", "whole", "raw", "cooked", "large", "small", "medium",
  "extra", "virgin", "olive", "salt", "pepper", "taste", "optional",
]);
function localMatchIngredient(ingredientText, fridgeItems) {
  const ing = _normalizeForMatch(ingredientText);
  if (!ing) return null;
  // Pass 1: full-string substring either direction.
  for (const fi of fridgeItems || []) {
    const n = _normalizeForMatch(fi.name);
    if (!n) continue;
    if (n.includes(ing) || ing.includes(n)) return fi;
  }
  // Pass 2: meaningful-token overlap (skip 1-2 char + stopwords).
  const tokens = ing
    .split(/\s+/)
    .filter(t => t.length >= 3 && !_MATCH_STOPWORDS.has(t));
  if (tokens.length === 0) return null;
  for (const fi of fridgeItems || []) {
    const n = _normalizeForMatch(fi.name);
    if (!n) continue;
    if (tokens.some(t => n.includes(t))) return fi;
  }
  return null;
}

function EatMeFirstScreen({ items, householdId }) {
  const [recipeModal, setRecipeModal] = useState(null); // { leadItem, items, recipes, loading, error }
  // v1.19 — when the user taps into a recipe card the modal switches to a
  // detail view. selectedRecipeIdx = null → list view (cards). Integer →
  // show that recipe's full detail (instructions + inline match + add-to-
  // list). Cleared on modal-close, recipe re-load, or back-tap.
  const [selectedRecipeIdx, setSelectedRecipeIdx] = useState(null);
  // Per-ingredient toggle state for the detail view. Keys are "{recipeIdx}:{ingIdx}".
  // Value === true means "queue this for the shopping list."
  // Matched (in-stock) ingredients default to false (user has them).
  // Missing ingredients also default to false (opt-in via tap), mirroring
  // the v1.19 UX-pass-2 decision in Plan tab.
  const [ingToggles, setIngToggles] = useState({});
  // Shopping list picker state — loaded when entering detail view.
  const [userLists, setUserLists] = useState([]);
  const [targetListId, setTargetListId] = useState(null);
  const [newListName, setNewListName] = useState("");
  const [addingToList, setAddingToList] = useState(false);
  const [addToListError, setAddToListError] = useState(null);
  const [addToListSuccess, setAddToListSuccess] = useState(false);
  // v1.21 — Save heart on EatMeFirst recipes. These recipes are ephemeral
  // (Haiku-generated, no recipe_bank.id), so we save the full JSON into
  // user_recipes_saved.recipe_data with source_recipe_id=NULL. Map is keyed
  // by recipe index → user_recipes_saved.id (or null if unsaved). Reset on
  // every fresh fetch since the recipe set rotates.
  const [savedRecipeMap, setSavedRecipeMap] = useState({});
  const [savingRecipeIdx, setSavingRecipeIdx] = useState(null);

  const ranked = (items || [])
    .filter(i => daysUntil(i.expiryDate) <= 14)
    .sort((a, b) => urgencyScoreIOS(a) - urgencyScoreIOS(b))
    .slice(0, 12);

  const expiredCount = (items || []).filter(i => daysUntil(i.expiryDate) <= 0).length;
  const soonCount    = (items || []).filter(i => { const d = daysUntil(i.expiryDate); return d > 0 && d <= 3; }).length;

  // v1.16 — fire once per mount so we can measure post-launch adoption of
  // the new headline tab. Counts let us split engagement by "did the user
  // have anything actionable to see" vs. an empty/all-clear state.
  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) return;
    track("eat_me_first_viewed", {
      surface: "ios",
      total_items: (items || []).length,
      expired_count: expiredCount,
      expiring_soon_count: soonCount,
      has_actionable: expiredCount + soonCount > 0,
    });
    viewedRef.current = true;
  }, [items, expiredCount, soonCount]);

  async function fetchRecipes({ leadItem, contextItems }) {
    // v1.19 — reset detail mode whenever a fresh fetch kicks off, so a stale
    // selectedRecipeIdx from a previous modal opening can't point at nothing.
    setSelectedRecipeIdx(null);
    setIngToggles({});
    setAddToListError(null);
    setAddToListSuccess(false);
    setSavedRecipeMap({});
    setSavingRecipeIdx(null);
    setRecipeModal({ leadItem, items: contextItems, recipes: [], loading: true, error: null });
    track("eat_me_first_recipes_requested", {
      lead_item: leadItem?.name || null,
      context_count: contextItems.length,
      surface: leadItem ? "row" : "header_top5",
    });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Please sign in to generate recipes.");
      const names = [
        ...(leadItem ? [leadItem.name] : []),
        ...contextItems.map(i => i.name).filter(n => n && n !== leadItem?.name),
      ].slice(0, 8);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-recipes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ items: names }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setRecipeModal(m => m && { ...m, recipes: Array.isArray(data.recipes) ? data.recipes : [], loading: false });
    } catch (e) {
      setRecipeModal(m => m && { ...m, error: e?.message || "Couldn't generate recipes.", loading: false });
    }
  }

  function onUseLeading(item) {
    const context = ranked.filter(i => i.id !== item.id).slice(0, 4);
    fetchRecipes({ leadItem: item, contextItems: context });
  }
  function onUseTop5() {
    fetchRecipes({ leadItem: null, contextItems: ranked.slice(0, 5) });
  }

  // v1.19 — when a list-view card is tapped, switch the modal into detail
  // mode for that recipe. Loads the household's shopping lists in parallel
  // so the add-to-list picker has options ready. Default-selects the most
  // recently created list to match the Plan tab's behavior.
  async function openRecipeDetail(idx) {
    const recipe = recipeModal?.recipes?.[idx];
    if (!recipe) return;
    setSelectedRecipeIdx(idx);
    setIngToggles({});
    setNewListName(recipe.name || "");
    setAddToListError(null);
    setAddToListSuccess(false);
    track("eat_me_first_recipe_opened", {
      recipe_name: recipe.name,
      ingredient_count: Array.isArray(recipe.ingredients) ? recipe.ingredients.length : 0,
    });
    if (!householdId) { setUserLists([]); setTargetListId(null); return; }
    try {
      const { data, error } = await supabase
        .from("shopping_lists")
        .select("id, name")
        .eq("household_id", householdId)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const lists = data || [];
      setUserLists(lists);
      setTargetListId(lists.length > 0 ? lists[0].id : null);
    } catch (e) {
      console.warn("[eat-first] list load failed:", e?.message || e);
      setUserLists([]);
      setTargetListId(null);
    }
  }

  function closeRecipeDetail() {
    setSelectedRecipeIdx(null);
    setIngToggles({});
    setAddToListError(null);
    setAddToListSuccess(false);
  }

  // Bulk-tick every missing ingredient. Matched (in-stock) ones stay false.
  function checkAllMissing(matches) {
    const next = { ...ingToggles };
    matches.forEach((m, j) => {
      if (!m.matched) next[`${selectedRecipeIdx}:${j}`] = true;
    });
    setIngToggles(next);
  }

  // v1.21 — Toggle save heart on an EatMeFirst recipe. These recipes have
  // no recipe_bank.id (Haiku-generated on the fly), so we persist the full
  // recipe JSON into user_recipes_saved.recipe_data with source_recipe_id=NULL.
  // The same row id is used to unsave later. Mirrors the deep-link save flow
  // in App.js around line 8588.
  async function toggleSaveRecipe(idx) {
    if (savingRecipeIdx !== null) return;
    const r = recipeModal?.recipes?.[idx];
    if (!r) return;
    setSavingRecipeIdx(idx);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in to save recipes.");
      const existingId = savedRecipeMap[idx];
      if (existingId) {
        const { error } = await supabase
          .from("user_recipes_saved")
          .delete()
          .eq("id", existingId);
        if (error) throw error;
        setSavedRecipeMap(prev => { const n = { ...prev }; delete n[idx]; return n; });
        track("recipe_unsaved", { source: "eat_me_first", name: r.name });
      } else {
        const { data, error } = await supabase
          .from("user_recipes_saved")
          .insert({
            user_id: user.id,
            source_recipe_id: null,
            recipe_data: r,
          })
          .select("id")
          .single();
        if (error) throw error;
        if (data?.id) setSavedRecipeMap(prev => ({ ...prev, [idx]: data.id }));
        track("recipe_saved", { source: "eat_me_first", name: r.name });
      }
    } catch (e) {
      console.warn("[eat_me_first] toggleSaveRecipe failed:", e?.message || e);
    } finally {
      setSavingRecipeIdx(null);
    }
  }

  async function addQueuedToList(recipe, matches) {
    if (addingToList) return;
    setAddingToList(true);
    setAddToListError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in to add to a shopping list.");
      if (!householdId) throw new Error("No household — pull to refresh and try again.");
      // Resolve target list: existing or create-new.
      let listId = targetListId;
      if (!listId) {
        const name = (newListName || recipe.name || "Shopping list").trim() || "Shopping list";
        const { data: created, error: cErr } = await supabase
          .from("shopping_lists")
          .insert({ household_id: householdId, name, created_by: user.id })
          .select("id")
          .single();
        if (cErr) throw cErr;
        listId = created.id;
      }
      // Build rows for every queued ingredient. Ingredients are ephemeral —
      // there's no fridge_item_id to link, so we pass the name + amount
      // through as the row's display text. Position increments after the
      // current max so we append rather than reorder.
      const queued = matches
        .map((m, j) => ({ m, j }))
        .filter(({ j }) => ingToggles[`${selectedRecipeIdx}:${j}`]);
      if (queued.length === 0) {
        setAddingToList(false);
        setAddToListError("Tap an ingredient to queue it first.");
        return;
      }
      // Find next position in the list (use length + 1 as a simple
      // starting point — accurate enough for append semantics).
      const { count } = await supabase
        .from("shopping_list_items")
        .select("id", { count: "exact", head: true })
        .eq("list_id", listId);
      const startPos = (count || 0) + 1;
      const rows = queued.map(({ m, j }, k) => {
        const ing = recipe.ingredients[j];
        const itemName = typeof ing === "object" ? (ing.item || "Ingredient") : String(ing);
        const amount = typeof ing === "object" ? (ing.amount || null) : null;
        return {
          list_id: listId,
          name: amount ? `${itemName} — ${amount}` : itemName,
          quantity: 1,
          position: startPos + k,
          added_by: user.id,
          checked: false,
        };
      });
      const { error: insErr } = await supabase.from("shopping_list_items").insert(rows);
      if (insErr) throw insErr;
      track("eat_me_first_added_to_list", {
        recipe_name: recipe.name,
        item_count: rows.length,
        list_was_new: !targetListId,
      });
      setAddToListSuccess(true);
      // Auto-close detail view after a brief beat so the user sees the
      // confirmation, then lands back on the recipe list.
      setTimeout(() => { closeRecipeDetail(); }, 1200);
    } catch (e) {
      setAddToListError(e?.message || "Couldn't add to list.");
    } finally {
      setAddingToList(false);
    }
  }

  return (
    <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}>
        <View>
          <Text style={s.pageTitle}>Eat me first</Text>
          <Text style={s.pageSubtitle}>
            {ranked.length === 0
              ? "Nothing in your fridge is close to spoiling — nice."
              : `${ranked.length} ${ranked.length === 1 ? "item" : "items"} ranked by urgency` +
                (expiredCount + soonCount > 0 ? ` · ${expiredCount} expired · ${soonCount} expiring within 3 days` : "")}
          </Text>
        </View>
      </View>

      {ranked.length >= 3 && (
        <View style={[s.card, { margin: 16, padding: 14, marginBottom: 12, borderColor: "rgba(22,163,74,0.3)", backgroundColor: "rgba(22,163,74,0.05)" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text style={{ fontSize: 28 }}>🍳</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.bold}>Cook with your top 5 expiring items</Text>
              <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>3 recipes that use as many as possible.</Text>
            </View>
            <TouchableOpacity onPress={onUseTop5} style={{ backgroundColor: T.accent, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 }}>
              <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700" }}>Suggest</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {ranked.length === 0 && (
        <View style={[s.card, { margin: 16, padding: 32, alignItems: "center" }]}>
          <Text style={{ fontSize: 44, marginBottom: 10 }}>✨</Text>
          <Text style={s.bold}>All clear</Text>
          <Text style={{ color: T.textSoft, fontSize: 13, marginTop: 4, textAlign: "center" }}>
            Nothing in your fridge is close to spoiling.
          </Text>
        </View>
      )}

      {ranked.map((item, idx) => {
        const d = daysUntil(item.expiryDate);
        const badge = urgencyBadgeIOS(d);
        return (
          <View key={item.id} style={[s.fridgeItem, { marginHorizontal: 16, marginBottom: 8 }]}>
            <Text style={{ width: 22, textAlign: "center", color: T.textSoft, fontSize: 12, fontWeight: "700" }}>{idx + 1}</Text>
            <View style={[s.reminderIcon, { backgroundColor: "rgba(22,163,74,0.08)", marginLeft: 6 }]}>
              <Text style={{ fontSize: 20 }}>{inferEmoji(item.name, item.emoji)}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 10, marginRight: 8 }}>
              <Text style={s.bold} numberOfLines={1}>{item.name}</Text>
              <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>{item.category}</Text>
            </View>
            {/* v1.18 — stack urgency pill above "Get recipes" so longer item
                names like "Baby spinach" or "Plain Greek yogurt" don't get
                truncated. Both controls right-aligned in a small column. */}
            <View style={{ alignItems: "flex-end", justifyContent: "center" }}>
              <View style={{ backgroundColor: badge.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 6 }}>
                <Text style={{ color: badge.color, fontSize: 10, fontWeight: "700" }}>{badge.text}</Text>
              </View>
              <TouchableOpacity onPress={() => onUseLeading(item)} style={{ backgroundColor: "rgba(22,163,74,0.1)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 }}>
                <Text style={{ color: T.accent, fontSize: 11, fontWeight: "700" }}>Get recipes</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      <View style={{ height: 32 }} />

      {/* Recipe modal — v1.19 two-mode redesign:
          • List mode (selectedRecipeIdx === null): collapsed cards showing
            emoji + name + time/difficulty + description + ingredient list
            only. No instructions on this screen so all 3 recipes fit and
            don't get clipped by the modal height. Cards are tappable.
          • Detail mode: full recipe with inline match (have/queued) +
            instructions + tip + "Add ingredients to shopping list" flow
            (mirrors Plan tab's InventoryMatchSheet, but uses a local
            matcher since these recipes are ephemeral with no recipe_id).

          The outer sheet wrapper uses { flex: 1, justifyContent: flex-end }
          backdrop + height-capped inner. Inner uses height (not maxHeight)
          via flexShrink + flexGrow on the ScrollView so content scrolls
          reliably even when 3 full recipes push past the 85% cap. */}
      <Modal visible={!!recipeModal} transparent animationType="slide" onRequestClose={() => setRecipeModal(null)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setRecipeModal(null)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => { /* swallow taps inside the sheet so they don't dismiss */ }}
            style={{ backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, height: "85%", overflow: "hidden" }}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", paddingTop: 20, paddingHorizontal: 20, paddingBottom: 6 }}>
              {/* Back button when in detail mode. Replaces nothing in list
                  mode (no spacer needed — title flex-1's). */}
              {selectedRecipeIdx !== null && (
                <TouchableOpacity
                  onPress={closeRecipeDetail}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityLabel="Back to recipes"
                  style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: T.bg, alignItems: "center", justifyContent: "center", marginRight: 10 }}
                >
                  <Ionicons name="chevron-back" size={20} color={T.text} />
                </TouchableOpacity>
              )}
              <View style={{ flex: 1 }}>
                <Text style={[s.pageTitle, { fontSize: 18, paddingHorizontal: 0, paddingTop: 0 }]}>
                  {selectedRecipeIdx !== null
                    ? (recipeModal?.recipes?.[selectedRecipeIdx]?.name || "Recipe")
                    : recipeModal?.leadItem
                      ? `Recipes using ${recipeModal.leadItem.name}`
                      : "Recipes for your top expiring items"}
                </Text>
                {selectedRecipeIdx === null && (
                  <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 4 }}>
                    Using: {[recipeModal?.leadItem?.name, ...(recipeModal?.items || []).map(i => i.name)].filter(Boolean).join(", ")}
                  </Text>
                )}
                {selectedRecipeIdx !== null && (() => {
                  const r = recipeModal?.recipes?.[selectedRecipeIdx];
                  if (!r) return null;
                  return (
                    <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 4 }}>
                      {[r.time, r.difficulty].filter(Boolean).join(" · ")}
                    </Text>
                  );
                })()}
              </View>
              {/* v1.22 #240 — Share button on EatMeFirst recipe detail. These
                  recipes are Haiku-generated and have no public URL, so the
                  shareRecipe helper falls back to text-share (full ingredients
                  + instructions in the message body). Sits left of the heart
                  per the same convention as the deep-link + saved sheets. */}
              {selectedRecipeIdx !== null && (() => {
                const r = recipeModal?.recipes?.[selectedRecipeIdx];
                if (!r) return null;
                return (
                  <TouchableOpacity
                    onPress={async () => {
                      try {
                        const result = await shareRecipe(r);
                        if (result?.action === Share.sharedAction) {
                          track("recipe_shared", { name: r.name, source: "eat_me_first_detail" });
                        }
                      } catch (e) {
                        console.warn("share eatmefirst recipe:", e?.message);
                      }
                    }}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityLabel="Share recipe"
                    style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: T.bg, alignItems: "center", justifyContent: "center", marginLeft: 8 }}
                  >
                    <Ionicons name="share-outline" size={20} color={T.text} />
                  </TouchableOpacity>
                );
              })()}
              {/* v1.21 — Save heart appears in detail view only. EatMeFirst
                  recipes are ephemeral, but user_recipes_saved.recipe_data
                  can store the full JSON, letting users keep one they like
                  even after the modal rotates. */}
              {selectedRecipeIdx !== null && (
                <TouchableOpacity
                  onPress={() => toggleSaveRecipe(selectedRecipeIdx)}
                  disabled={savingRecipeIdx !== null}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityLabel={savedRecipeMap[selectedRecipeIdx] ? "Remove from saved" : "Save recipe"}
                  style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: T.bg, alignItems: "center", justifyContent: "center", marginLeft: 8, opacity: savingRecipeIdx === selectedRecipeIdx ? 0.5 : 1 }}
                >
                  <Ionicons
                    name={savedRecipeMap[selectedRecipeIdx] ? "heart" : "heart-outline"}
                    size={20}
                    color={savedRecipeMap[selectedRecipeIdx] ? T.danger : T.text}
                  />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => setRecipeModal(null)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel="Close recipes"
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: T.bg, alignItems: "center", justifyContent: "center", marginLeft: 8 }}
              >
                <Ionicons name="close" size={20} color={T.text} />
              </TouchableOpacity>
            </View>

            {/* flexShrink: 1 + flexGrow: 1 lets the ScrollView consume the
                remaining height inside the 85% sheet and scroll its content
                instead of expanding the parent. Greg's screenshot showed
                the 2nd/3rd recipes getting clipped — that was a missing
                flex bound on this ScrollView. */}
            <ScrollView
              style={{ flexShrink: 1, flexGrow: 1 }}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
              showsVerticalScrollIndicator={true}
            >
              <View style={{ height: 8 }} />

              {recipeModal?.loading && (
                <View style={{ paddingVertical: 30, alignItems: "center" }}>
                  <ActivityIndicator color={T.accent} />
                  <Text style={{ color: T.textSoft, fontSize: 13, marginTop: 10 }}>Generating recipes…</Text>
                </View>
              )}
              {recipeModal?.error && (
                <View style={{ backgroundColor: "rgba(220,38,38,0.08)", borderColor: "rgba(220,38,38,0.3)", borderWidth: 1, borderRadius: 10, padding: 12 }}>
                  <Text style={{ color: T.danger, fontSize: 13 }}>{recipeModal.error}</Text>
                </View>
              )}

              {/* LIST VIEW — collapsed cards. Each is a TouchableOpacity that
                  opens the detail view. No instructions on this screen. */}
              {selectedRecipeIdx === null && (recipeModal?.recipes || []).map((r, i) => (
                <TouchableOpacity
                  key={i}
                  activeOpacity={0.7}
                  onPress={() => openRecipeDetail(i)}
                  style={[s.card, { padding: 14, marginBottom: 10 }]}
                >
                  <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
                    <Text style={{ fontSize: 26 }}>{r.emoji || "🍽️"}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.bold, { fontSize: 15 }]}>{r.name}</Text>
                      <Text style={{ color: T.textSoft, fontSize: 11, marginTop: 2 }}>
                        {[r.time, r.difficulty].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                    {/* v1.21 — Save heart on list cards too. Mirrors the
                        detail-view header so users can save a recipe at a
                        glance without drilling in. stopPropagation prevents
                        the card's own onPress from firing. */}
                    <TouchableOpacity
                      onPress={(e) => { e.stopPropagation?.(); toggleSaveRecipe(i); }}
                      disabled={savingRecipeIdx !== null}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityLabel={savedRecipeMap[i] ? "Remove from saved" : "Save recipe"}
                      style={{ padding: 4, opacity: savingRecipeIdx === i ? 0.5 : 1 }}
                    >
                      <Ionicons
                        name={savedRecipeMap[i] ? "heart" : "heart-outline"}
                        size={20}
                        color={savedRecipeMap[i] ? T.danger : T.muted}
                      />
                    </TouchableOpacity>
                  </View>
                  {r.description && <Text style={{ color: T.textSoft, fontSize: 13, lineHeight: 19, marginBottom: 8 }}>{r.description}</Text>}
                  {Array.isArray(r.ingredients) && r.ingredients.length > 0 && (
                    <View>
                      <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 4, paddingHorizontal: 0, fontSize: 10 }]}>INGREDIENTS</Text>
                      {r.ingredients.map((ing, j) => (
                        <Text key={j} style={{ color: T.text, fontSize: 13, lineHeight: 20 }} numberOfLines={1}>
                          • {typeof ing === "object" ? ing.item : ing}{(typeof ing === "object" && ing?.amount) ? ` — ${ing.amount}` : ""}
                        </Text>
                      ))}
                    </View>
                  )}
                  {/* v1.21 — Discoverability CTA replacing the tiny `›`
                      chevron. Greg's Android testing surfaced that users
                      didn't realize each card was tappable. The pill makes
                      the affordance explicit and previews what's inside. */}
                  <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: T.border, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <Text style={{ color: T.accent, fontSize: 13, fontWeight: "700" }}>View recipe & add to shopping list</Text>
                    <Ionicons name="arrow-forward" size={14} color={T.accent} />
                  </View>
                </TouchableOpacity>
              ))}

              {/* DETAIL VIEW — full recipe with inline match + add-to-list. */}
              {selectedRecipeIdx !== null && (() => {
                const r = recipeModal?.recipes?.[selectedRecipeIdx];
                if (!r) return null;
                const ingredients = Array.isArray(r.ingredients) ? r.ingredients : [];
                // Build per-ingredient match against the user's fridge.
                const matches = ingredients.map(ing => {
                  const text = typeof ing === "object" ? (ing.item || "") : String(ing);
                  const matched = localMatchIngredient(text, items || []);
                  return { text, amount: typeof ing === "object" ? (ing.amount || null) : null, matched };
                });
                const queuedCount = matches.filter((m, j) => ingToggles[`${selectedRecipeIdx}:${j}`]).length;
                const missingCount = matches.filter(m => !m.matched).length;
                return (
                  <View>
                    {r.description && (
                      <Text style={{ color: T.textSoft, fontSize: 14, lineHeight: 20, marginBottom: 14 }}>{r.description}</Text>
                    )}

                    {/* INGREDIENTS section with inline match + tap-to-queue */}
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 0, paddingHorizontal: 0, fontSize: 11 }]}>INGREDIENTS</Text>
                      {missingCount > 0 && (
                        <TouchableOpacity onPress={() => checkAllMissing(matches)}>
                          <Text style={{ color: T.accent, fontSize: 12, fontWeight: "700" }}>
                            + ADD ALL {missingCount} MISSING
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {matches.map((m, j) => {
                      const key = `${selectedRecipeIdx}:${j}`;
                      const queued = !!ingToggles[key];
                      const isHave = !!m.matched;
                      // v1.21 (Greg fix 2026-05-16) — matched items are
                      // now toggleable. Users might want to buy MORE of an
                      // item they already have (running low). 4 visual
                      // states:
                      //   have:           green tint + ✓, "In stock"
                      //   have-and-queued: green tint + ✓+, "In stock — also added to list"
                      //   queued (missing): green tint + +, "Queued for shopping list"
                      //   skip (missing):   neutral, "Tap to add"
                      const bgColor = (isHave || queued)
                        ? "rgba(22,163,74,0.08)"
                        : T.bg;
                      const borderColor = (isHave || queued) ? "rgba(22,163,74,0.35)" : T.border;
                      const onTap = () => {
                        setIngToggles(prev => ({ ...prev, [key]: !prev[key] }));
                      };
                      return (
                        <TouchableOpacity
                          key={j}
                          activeOpacity={0.7}
                          onPress={onTap}
                          style={{ backgroundColor: bgColor, borderWidth: 1, borderColor, borderRadius: 10, padding: 10, marginBottom: 6, flexDirection: "row", alignItems: "center", gap: 10 }}
                        >
                          {/* Icon: pure-have = checkmark, pure-queued = +,
                              have-and-queued = checkmark with a small +
                              overlay (rendered as a stacked badge so users
                              know it's BOTH). */}
                          <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: (isHave || queued) ? T.accent : "transparent", borderWidth: (isHave || queued) ? 0 : 1.5, borderColor: T.muted, position: "relative" }}>
                            {isHave
                              ? <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                              : queued
                                ? <Ionicons name="add" size={16} color="#FFFFFF" />
                                : null}
                            {isHave && queued && (
                              <View style={{ position: "absolute", top: -3, right: -3, width: 12, height: 12, borderRadius: 6, backgroundColor: T.warn, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: T.surface }}>
                                <Ionicons name="add" size={8} color="#FFFFFF" />
                              </View>
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: T.text, fontSize: 13, fontWeight: "600" }}>
                              {m.text}{m.amount ? ` — ${m.amount}` : ""}
                            </Text>
                            <Text style={{ color: T.textSoft, fontSize: 11, marginTop: 2 }}>
                              {isHave && queued
                                ? `In stock — also queued for list (need more)`
                                : isHave
                                  ? `In stock — you have ${m.matched.name} · tap to add extra`
                                  : queued
                                    ? "Queued for shopping list"
                                    : "Tap to add to shopping list"}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}

                    {/* Add-to-list controls — only if there's anything queued
                        or the user could queue (any missing). */}
                    {missingCount > 0 && (
                      <View style={{ marginTop: 10, marginBottom: 12 }}>
                        <Text style={[s.sectionLabel, { marginTop: 4, marginBottom: 8, paddingHorizontal: 0, fontSize: 11 }]}>ADD TO</Text>
                        {/* List picker chips. */}
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                          {userLists.map(l => {
                            const sel = targetListId === l.id;
                            return (
                              <TouchableOpacity
                                key={l.id}
                                onPress={() => setTargetListId(l.id)}
                                style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: sel ? T.accent : T.bg, borderWidth: 1, borderColor: sel ? T.accent : T.border }}
                              >
                                <Text style={{ color: sel ? "#FFFFFF" : T.text, fontSize: 12, fontWeight: "600" }}>{l.name}</Text>
                              </TouchableOpacity>
                            );
                          })}
                          <TouchableOpacity
                            onPress={() => setTargetListId(null)}
                            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: targetListId === null ? T.accent : T.bg, borderWidth: 1, borderColor: targetListId === null ? T.accent : T.border }}
                          >
                            <Text style={{ color: targetListId === null ? "#FFFFFF" : T.text, fontSize: 12, fontWeight: "600" }}>+ New list</Text>
                          </TouchableOpacity>
                        </View>
                        {targetListId === null && (
                          <TextInput
                            value={newListName}
                            onChangeText={setNewListName}
                            placeholder="List name"
                            placeholderTextColor={T.muted}
                            style={[s.input, { marginBottom: 8 }]}
                          />
                        )}
                        <TouchableOpacity
                          disabled={addingToList || queuedCount === 0}
                          onPress={() => addQueuedToList(r, matches)}
                          style={[s.btnPrimary, { opacity: (addingToList || queuedCount === 0) ? 0.5 : 1 }]}
                        >
                          <Text style={s.btnPrimaryText}>
                            {addingToList ? "Adding…" : queuedCount > 0 ? `Add ${queuedCount} to ${targetListId === null ? "new list" : "list"}` : "Tap an ingredient to queue"}
                          </Text>
                        </TouchableOpacity>
                        {addToListError && (
                          <Text style={{ color: T.danger, fontSize: 12, marginTop: 8 }}>{addToListError}</Text>
                        )}
                        {addToListSuccess && (
                          <Text style={{ color: T.accent, fontSize: 12, marginTop: 8, fontWeight: "700" }}>✓ Added to your shopping list</Text>
                        )}
                      </View>
                    )}

                    {/* INSTRUCTIONS */}
                    {Array.isArray(r.instructions) && r.instructions.length > 0 && (
                      <View style={{ marginTop: 6 }}>
                        <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 6, paddingHorizontal: 0, fontSize: 11 }]}>INSTRUCTIONS</Text>
                        {r.instructions.map((step, j) => (
                          <Text key={j} style={{ color: T.text, fontSize: 14, lineHeight: 22, marginBottom: 4 }}>{j + 1}. {step}</Text>
                        ))}
                      </View>
                    )}
                    {r.tip && (
                      <View style={{ marginTop: 10, backgroundColor: "rgba(22,163,74,0.06)", borderRadius: 10, padding: 10 }}>
                        <Text style={{ color: T.accent, fontSize: 13, fontStyle: "italic" }}>💡 {r.tip}</Text>
                      </View>
                    )}
                  </View>
                );
              })()}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

// ─── Dashboard Screen ────────────────────────────────────────────────────────
// v1.16 strategic-reposition supporting tab. Single-glance impact view from
// money_saved_events. Cold-start framing uses USDA aspirational average so
// the empty state still communicates value. Mirrors web/src/screens/Dashboard.jsx.
const _AVG_HOUSEHOLD_WASTE_YEAR = 1866;
const _CO2_KG_PER_DOLLAR_RESCUED = 1.4;
const _POUNDS_PER_DOLLAR_RESCUED = 0.5;
function _fmt$(cents) {
  const d = (cents || 0) / 100;
  return d >= 100 ? `$${Math.round(d).toLocaleString()}` : `$${d.toFixed(2)}`;
}
function _fmtN(n) { return Math.round(n).toLocaleString(); }

function DashboardScreen({ items, onNavigateToEatMeFirst }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [lifetimeCents, setLifetimeCents] = useState(0);
  const [weekCents, setWeekCents] = useState(0);
  const [lifetimeCount, setLifetimeCount] = useState(0);
  const [weekCount, setWeekCount] = useState(0);
  const [topCategories, setTopCategories] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const weekAgoIso = weekAgo.toISOString();
        const { data: events, error } = await supabase
          .from("money_saved_events")
          .select("value_cents, category, saved_at")
          .order("saved_at", { ascending: false });
        if (error) throw error;
        if (cancelled) return;
        let lifeC = 0, weekC = 0, lifeN = 0, weekN = 0;
        const byCat = new Map();
        for (const e of events || []) {
          lifeC += e.value_cents || 0;
          lifeN += 1;
          if (e.saved_at && e.saved_at >= weekAgoIso) {
            weekC += e.value_cents || 0;
            weekN += 1;
          }
          const c = e.category || "Other";
          byCat.set(c, (byCat.get(c) || 0) + (e.value_cents || 0));
        }
        setLifetimeCents(lifeC);
        setWeekCents(weekC);
        setLifetimeCount(lifeN);
        setWeekCount(weekN);
        setTopCategories(
          Array.from(byCat.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([category, cents]) => ({ category, cents }))
        );
      } catch (e) {
        if (!cancelled) setErr(e?.message || "Couldn't load dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const lifetimeDollars = (lifetimeCents || 0) / 100;
  const lbsRescued = lifetimeDollars * _POUNDS_PER_DOLLAR_RESCUED;
  const co2Kg = lifetimeDollars * _CO2_KG_PER_DOLLAR_RESCUED;
  const isColdStart = lifetimeCents === 0;
  const atRisk = (items || []).filter(i => daysUntil(i.expiryDate) <= 3);

  // v1.16 — fire once after the money_saved_events query lands. Bucketed
  // lifetime so we don't leak per-user spend in event properties; is_cold_start
  // lets us split first-impression engagement from returning-user engagement.
  const viewedRef = useRef(false);
  useEffect(() => {
    if (loading || viewedRef.current) return;
    const bucket =
      lifetimeDollars === 0   ? "0"      :
      lifetimeDollars <= 10   ? "1-10"   :
      lifetimeDollars <= 50   ? "11-50"  :
      lifetimeDollars <= 200  ? "51-200" :
                                "200+";
    track("dashboard_viewed", {
      surface: "ios",
      is_cold_start: isColdStart,
      lifetime_bucket: bucket,
      lifetime_count: lifetimeCount,
      at_risk_count: atRisk.length,
    });
    viewedRef.current = true;
  }, [loading, lifetimeDollars, lifetimeCount, atRisk.length, isColdStart]);

  return (
    <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}>
        <View>
          <Text style={s.pageTitle}>Your impact</Text>
          <Text style={s.pageSubtitle}>
            {loading ? "Loading…" :
             isColdStart
               ? `Avg US household wastes $${_AVG_HOUSEHOLD_WASTE_YEAR.toLocaleString()}/yr. Yours so far: $0.`
               : `${lifetimeCount} ${lifetimeCount === 1 ? "item" : "items"} rescued — keep it up.`}
          </Text>
        </View>
      </View>

      {err && (
        <View style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: "rgba(220,38,38,0.08)", borderColor: "rgba(220,38,38,0.3)", borderWidth: 1, borderRadius: 10, padding: 10 }}>
          <Text style={{ color: T.danger, fontSize: 13 }}>{err}</Text>
        </View>
      )}

      {/* Hero */}
      <View style={[s.card, { margin: 16, padding: 18, marginBottom: 12, borderColor: "rgba(22,163,74,0.3)", backgroundColor: "rgba(22,163,74,0.06)" }]}>
        <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 4, paddingHorizontal: 0 }]}>// LIFETIME MONEY SAVED</Text>
        <Text style={{ color: T.accent, fontSize: 40, fontWeight: "800" }}>{_fmt$(lifetimeCents)}</Text>
        <Text style={{ color: T.textSoft, fontSize: 13, marginTop: 4 }}>
          {isColdStart ? "Mark items as \"used\" before they expire to start counting." : `${_fmt$(weekCents)} saved in the last 7 days`}
        </Text>
      </View>

      {/* 2x2 stats */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 8 }}>
        <View style={[s.card, { width: "47%", margin: 8, padding: 14 }]}>
          <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 4, paddingHorizontal: 0, fontSize: 9 }]}>// THIS WEEK</Text>
          <Text style={{ color: T.accent, fontSize: 22, fontWeight: "800" }}>{_fmt$(weekCents)}</Text>
          <Text style={{ color: T.textSoft, fontSize: 11, marginTop: 4 }}>{weekCount} {weekCount === 1 ? "item" : "items"} rescued</Text>
        </View>
        <View style={[s.card, { width: "47%", margin: 8, padding: 14 }]}>
          <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 4, paddingHorizontal: 0, fontSize: 9 }]}>// POUNDS RESCUED</Text>
          <Text style={{ color: T.text, fontSize: 22, fontWeight: "800" }}>{_fmtN(lbsRescued)}</Text>
          <Text style={{ color: T.textSoft, fontSize: 11, marginTop: 4 }}>Lifetime, estimated</Text>
        </View>
        <View style={[s.card, { width: "47%", margin: 8, padding: 14 }]}>
          <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 4, paddingHorizontal: 0, fontSize: 9 }]}>// CO₂ AVOIDED</Text>
          <Text style={{ color: T.text, fontSize: 22, fontWeight: "800" }}>{_fmtN(co2Kg)} kg</Text>
          <Text style={{ color: T.textSoft, fontSize: 11, marginTop: 4 }}>Lifetime, estimated</Text>
        </View>
        {/* v1.22 (sky21__ feedback, #234) — AT RISK NOW tile is now
            tappable when atRisk > 0. Wraps in TouchableOpacity that calls
            onNavigateToEatMeFirst → setTab("eatMeFirst"). When 0 items at
            risk, stays a plain View (nothing to navigate to). */}
        {atRisk.length > 0 ? (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => {
              track("dashboard_at_risk_tapped", { count: atRisk.length, surface: "tile" });
              onNavigateToEatMeFirst?.();
            }}
            style={[s.card, { width: "47%", margin: 8, padding: 14, borderColor: "rgba(234,88,12,0.3)", borderWidth: 1 }]}
          >
            <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 4, paddingHorizontal: 0, fontSize: 9 }]}>// AT RISK NOW</Text>
            <Text style={{ color: T.warn, fontSize: 22, fontWeight: "800" }}>{atRisk.length}</Text>
            <Text style={{ color: T.accent, fontSize: 11, marginTop: 4, fontWeight: "600" }}>
              Tap to use them first ›
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={[s.card, { width: "47%", margin: 8, padding: 14 }]}>
            <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 4, paddingHorizontal: 0, fontSize: 9 }]}>// AT RISK NOW</Text>
            <Text style={{ color: T.text, fontSize: 22, fontWeight: "800" }}>0</Text>
            <Text style={{ color: T.textSoft, fontSize: 11, marginTop: 4 }}>Nothing expiring soon</Text>
          </View>
        )}
      </View>

      {/* v1.22 #234 — Banner CTA matching web Dashboard.jsx pattern.
          Only shown when there are at-risk items. The entire card is
          tappable (not just the inline link), per sky21__ feedback. */}
      {atRisk.length > 0 && onNavigateToEatMeFirst && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            track("dashboard_at_risk_tapped", { count: atRisk.length, surface: "banner" });
            onNavigateToEatMeFirst();
          }}
          style={{ marginHorizontal: 16, marginTop: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "rgba(234,88,12,0.3)", backgroundColor: "rgba(234,88,12,0.06)", flexDirection: "row", alignItems: "center", gap: 12 }}
        >
          <Text style={{ fontSize: 22 }}>⏳</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.bold, { fontSize: 14 }]}>
              {atRisk.length} {atRisk.length === 1 ? "item is" : "items are"} expiring in the next 3 days
            </Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>
              Tap to open <Text style={{ color: T.accent, fontWeight: "700" }}>Eat Me First</Text> and see what to use.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={T.muted} />
        </TouchableOpacity>
      )}

      {topCategories.length > 0 && (
        <View style={[s.card, { margin: 16, padding: 14 }]}>
          <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 10, paddingHorizontal: 0 }]}>// TOP RESCUED CATEGORIES</Text>
          {topCategories.map(row => {
            const pct = lifetimeCents > 0 ? Math.round((row.cents / lifetimeCents) * 100) : 0;
            return (
              <View key={row.category} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                  <Text style={{ color: T.text, fontSize: 13, fontWeight: "600" }}>{row.category}</Text>
                  <Text style={{ color: T.textSoft, fontSize: 12 }}>{_fmt$(row.cents)} · {pct}%</Text>
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: T.bg, overflow: "hidden" }}>
                  <View style={{ width: `${Math.max(pct, 2)}%`, height: "100%", backgroundColor: T.accent }} />
                </View>
              </View>
            );
          })}
        </View>
      )}

      <Text style={{ color: T.muted, fontSize: 10, paddingHorizontal: 16, marginTop: 8, marginBottom: 24 }}>
        Estimates use USDA food-waste averages — ~$4/lb basket value, 5.6kg CO₂ per kg of food wasted (Project Drawdown).
      </Text>
    </ScrollView>
  );
}

// ─── Settings Screen ─────────────────────────────────────────────────────────
// v1.16 destination for everything that used to live in the Alerts/Reminders
// tab + the global app-bar Share + Logout buttons. Mirrors
// web/src/screens/Settings.jsx — same sections, same upsert pattern, same
// user_settings round-tripping.
const _DIETARY_OPTIONS = [
  { id: "vegetarian",  label: "Vegetarian",  emoji: "🥗" },
  { id: "vegan",       label: "Vegan",       emoji: "🌱" },
  { id: "pescatarian", label: "Pescatarian", emoji: "🐟" },
  { id: "gluten_free", label: "Gluten-free", emoji: "🌾" },
  { id: "dairy_free",  label: "Dairy-free",  emoji: "🥛" },
  { id: "nut_free",    label: "Nut-free",    emoji: "🥜" },
  { id: "low_carb",    label: "Low-carb",    emoji: "🥩" },
  { id: "keto",        label: "Keto",        emoji: "🥑" },
];
const _ALLERGEN_OPTIONS = [
  { id: "peanut",    label: "Peanut" },
  { id: "tree_nut",  label: "Tree nuts" },
  { id: "shellfish", label: "Shellfish" },
  { id: "fish",      label: "Fish" },
  { id: "egg",       label: "Egg" },
  { id: "milk",      label: "Milk" },
  { id: "soy",       label: "Soy" },
  { id: "wheat",     label: "Wheat" },
  { id: "sesame",    label: "Sesame" },
];

// v1.18 — Smart Cook Night setting row. Self-contained (reads + writes
// its own state from user_settings) so it doesn't change SettingsScreen's
// prop signature. Two controls: an on/off Switch and an hour picker that
// only shows when enabled. Hour picker uses the existing UnitPicker
// pattern (chips for the common hours, "Other..." for anything else).
function CookNightSettingRow() {
  const [enabled, setEnabled] = useState(true);
  const [hour, setHour] = useState(18);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase
          .from("user_settings")
          .select("cook_night_enabled, cook_night_hour")
          .eq("user_id", session.user.id)
          .maybeSingle();
        if (cancelled) return;
        if (data) {
          setEnabled(data.cook_night_enabled !== false);
          setHour(Number.isFinite(Number(data.cook_night_hour)) ? Number(data.cook_night_hour) : 18);
        }
      } catch (e) {
        // user_settings might not have the columns yet on older deploys —
        // surface as defaults rather than blocking the settings screen.
        console.warn("cook night settings load:", e?.message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function saveEnabled(next) {
    setEnabled(next);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await supabase
        .from("user_settings")
        .update({ cook_night_enabled: next, updated_at: new Date().toISOString() })
        .eq("user_id", session.user.id);
      track("cook_night_toggled", { enabled: next });
    } catch (e) {
      console.warn("cook night save:", e?.message);
    }
  }

  async function saveHour(next) {
    const clamped = Math.max(0, Math.min(23, next));
    setHour(clamped);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await supabase
        .from("user_settings")
        .update({ cook_night_hour: clamped, updated_at: new Date().toISOString() })
        .eq("user_id", session.user.id);
      track("cook_night_hour_set", { hour: clamped });
    } catch (e) {
      console.warn("cook night hour save:", e?.message);
    }
  }

  const hourLabel = (h) => {
    const period = h >= 12 ? "PM" : "AM";
    const display = h === 0 ? 12 : (h > 12 ? h - 12 : h);
    return `${display} ${period}`;
  };

  // Hour quick-pick chips — the realistic dinner window for most US households.
  const hourOptions = [16, 17, 18, 19, 20];

  if (!loaded) return null;

  return (
    <View style={{ paddingTop: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: T.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: enabled ? 12 : 0 }}>
        <View style={[s.reminderIcon, { backgroundColor: "rgba(22,163,74,0.1)" }]}><Text style={{ fontSize: 20 }}>🍳</Text></View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.bold}>Smart Cook Night</Text>
          <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>
            A dinner-time push: "Make X tonight using what you have."
          </Text>
        </View>
        <Switch value={enabled} onValueChange={saveEnabled} trackColor={{ false: T.border, true: T.accent }} />
      </View>
      {enabled && (
        <View>
          <Text style={{ fontSize: 12, color: T.textSoft, marginBottom: 6 }}>
            Sends at <Text style={{ color: T.text, fontWeight: "700" }}>{hourLabel(hour)}</Text> local time.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {hourOptions.map(h => {
              const active = h === hour;
              return (
                <TouchableOpacity
                  key={h}
                  onPress={() => saveHour(h)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
                    backgroundColor: active ? T.accent : T.bg,
                    borderWidth: 1, borderColor: active ? T.accent : T.border,
                  }}
                >
                  <Text style={{ color: active ? "#fff" : T.text, fontSize: 12, fontWeight: "700" }}>
                    {hourLabel(h)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

function SettingsScreen({ notificationsEnabled, onToggleNotifications, emailDigestEnabled, onToggleEmailDigest, onOpenShare, userEmail }) {
  const [dietary, setDietary]             = useState([]);
  const [allergens, setAllergens]         = useState([]);
  const [householdSize, setHouseholdSize] = useState(1);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // v1.16 — fire once when the profile data lands, including counts so we
  // can split engagement by "did the user fill in their dietary/allergen
  // settings" without needing per-user joins in PostHog.
  const viewedRef = useRef(false);
  useEffect(() => {
    if (!profileLoaded || viewedRef.current) return;
    track("settings_viewed", {
      surface: "ios",
      dietary_count: dietary.length,
      allergen_count: allergens.length,
      household_size: householdSize,
      push_enabled: !!notificationsEnabled,
      digest_enabled: !!emailDigestEnabled,
    });
    viewedRef.current = true;
  }, [profileLoaded, dietary.length, allergens.length, householdSize, notificationsEnabled, emailDigestEnabled]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from("user_settings")
          .select("dietary_restrictions, allergens, household_size")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cancelled || !data) { setProfileLoaded(true); return; }
        if (Array.isArray(data.dietary_restrictions)) setDietary(data.dietary_restrictions);
        if (Array.isArray(data.allergens)) setAllergens(data.allergens);
        if (Number.isFinite(Number(data.household_size))) setHouseholdSize(Math.max(1, Number(data.household_size)));
      } catch (e) {
        console.warn("user_settings fetch failed:", e?.message || e);
      } finally {
        if (!cancelled) setProfileLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function persistProfile(patch) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("user_settings").upsert({
        user_id: user.id,
        dietary_restrictions: patch.dietary ?? dietary,
        allergens: patch.allergens ?? allergens,
        household_size: patch.householdSize ?? householdSize,
      });
      track("profile_updated", {
        surface: "ios_settings",
        dietary_count: (patch.dietary ?? dietary).length,
        allergen_count: (patch.allergens ?? allergens).length,
        household_size: patch.householdSize ?? householdSize,
      });
    } catch (e) {
      console.warn("user_settings upsert failed:", e?.message || e);
    }
  }
  function toggleDietary(id) {
    const next = dietary.includes(id) ? dietary.filter(d => d !== id) : [...dietary, id];
    setDietary(next);
    persistProfile({ dietary: next });
  }
  function toggleAllergen(id) {
    const next = allergens.includes(id) ? allergens.filter(a => a !== id) : [...allergens, id];
    setAllergens(next);
    persistProfile({ allergens: next });
  }
  function changeHouseholdSize(delta) {
    const next = Math.max(1, Math.min(20, householdSize + delta));
    if (next === householdSize) return;
    setHouseholdSize(next);
    persistProfile({ householdSize: next });
  }

  return (
    <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}>
        <View>
          <Text style={s.pageTitle}>Settings</Text>
          <Text style={s.pageSubtitle}>Recipe preferences, notifications, household, account.</Text>
        </View>
      </View>

      {/* Household size + share */}
      <Text style={s.sectionLabel}>// HOUSEHOLD</Text>
      <View style={[s.card, { margin: 16, padding: 14, marginBottom: 8 }]}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={[s.reminderIcon, { backgroundColor: "rgba(22,163,74,0.1)" }]}><Text style={{ fontSize: 20 }}>👥</Text></View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.bold}>Household size</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Recipes will be scaled for this many people.</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TouchableOpacity onPress={() => changeHouseholdSize(-1)} disabled={householdSize <= 1} style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: T.border, backgroundColor: T.bg, alignItems: "center", justifyContent: "center", opacity: householdSize <= 1 ? 0.4 : 1 }}>
              <Text style={{ color: T.text, fontWeight: "700", fontSize: 18 }}>−</Text>
            </TouchableOpacity>
            <Text style={{ width: 24, textAlign: "center", color: T.text, fontWeight: "700" }}>{householdSize}</Text>
            <TouchableOpacity onPress={() => changeHouseholdSize(1)} disabled={householdSize >= 20} style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: T.border, backgroundColor: T.bg, alignItems: "center", justifyContent: "center", opacity: householdSize >= 20 ? 0.4 : 1 }}>
              <Text style={{ color: T.text, fontWeight: "700", fontSize: 18 }}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      <View style={[s.card, { margin: 16, padding: 14, marginTop: 0, marginBottom: 8 }]}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={[s.reminderIcon, { backgroundColor: "rgba(22,163,74,0.1)" }]}><Text style={{ fontSize: 20 }}>🔗</Text></View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.bold}>Share fridge with household</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Invite a partner or roommate.</Text>
          </View>
          <TouchableOpacity onPress={onOpenShare} style={{ backgroundColor: T.accent, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 }}>
            <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700" }}>Share</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Dietary */}
      <Text style={s.sectionLabel}>// DIETARY PREFERENCES</Text>
      <View style={[s.card, { margin: 16, padding: 14, marginBottom: 8 }]}>
        <Text style={{ color: T.textSoft, fontSize: 12, marginBottom: 10 }}>Recipe suggestions will respect these. Tap to toggle.</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {_DIETARY_OPTIONS.map(opt => {
            const active = dietary.includes(opt.id);
            return (
              <TouchableOpacity
                key={opt.id}
                onPress={() => toggleDietary(opt.id)}
                style={{
                  paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1,
                  borderColor: active ? T.accent : T.border,
                  backgroundColor: active ? T.accent : T.bg,
                  flexDirection: "row", alignItems: "center", gap: 6,
                }}
              >
                <Text style={{ fontSize: 13 }}>{opt.emoji}</Text>
                <Text style={{ color: active ? "#FFFFFF" : T.text, fontSize: 12, fontWeight: "600" }}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Allergens */}
      <Text style={s.sectionLabel}>// ALLERGIES</Text>
      <View style={[s.card, { margin: 16, padding: 14, marginBottom: 8 }]}>
        <Text style={{ color: T.textSoft, fontSize: 12, marginBottom: 10 }}>Recipes will never include these ingredients.</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {_ALLERGEN_OPTIONS.map(opt => {
            const active = allergens.includes(opt.id);
            return (
              <TouchableOpacity
                key={opt.id}
                onPress={() => toggleAllergen(opt.id)}
                style={{
                  paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1,
                  borderColor: active ? T.danger : T.border,
                  backgroundColor: active ? T.danger : T.bg,
                }}
              >
                <Text style={{ color: active ? "#FFFFFF" : T.text, fontSize: 12, fontWeight: "600" }}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Notifications */}
      <Text style={s.sectionLabel}>// NOTIFICATIONS</Text>
      <View style={[s.card, { margin: 16, padding: 14, marginBottom: 8 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <View style={[s.reminderIcon, { backgroundColor: "rgba(22,163,74,0.1)" }]}><Text style={{ fontSize: 20 }}>🔔</Text></View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.bold}>Push notifications</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>The day before something expires.</Text>
          </View>
          <Switch value={notificationsEnabled} onValueChange={onToggleNotifications} trackColor={{ false: T.border, true: T.accent }} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <View style={[s.reminderIcon, { backgroundColor: "rgba(22,163,74,0.1)" }]}><Text style={{ fontSize: 20 }}>✉️</Text></View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.bold}>Daily email digest</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Once-a-day summary, sent to {userEmail || "your email"}.</Text>
          </View>
          <Switch value={emailDigestEnabled} onValueChange={onToggleEmailDigest} trackColor={{ false: T.border, true: T.accent }} />
        </View>
        <CookNightSettingRow />
      </View>

      {/* Account */}
      <Text style={s.sectionLabel}>// ACCOUNT</Text>
      <View style={[s.card, { margin: 16, padding: 14, marginBottom: 24 }]}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={[s.reminderIcon, { backgroundColor: "rgba(22,163,74,0.1)" }]}><Text style={{ fontSize: 20 }}>👤</Text></View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.bold}>{userEmail || "Signed in"}</Text>
            <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Signed in</Text>
          </View>
          <TouchableOpacity
            onPress={() => supabase.auth.signOut()}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface }}
          >
            <Text style={{ color: T.danger, fontSize: 12, fontWeight: "700" }}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>
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

// v1.15 — sample-receipt rows used by the empty-state "Try a sample receipt"
// CTA. Realistic grocery trip with mixed expiry timelines so the user sees
// the value moment (some items will expire soon, sortable, recipe-relevant).
// Computed at modal-open time so the dates are always relative-to-now.
function buildSampleRows() {
  const today = Date.now();
  const inDays = (d) => {
    const dt = new Date(today + d * 86400000);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  };
  // v1.16 — sample rows include container assignments so users see what a
  // mixed-container receipt looks like (most items → fridge, bread → pantry).
  return [
    { id: Date.now() + 1, name: "Whole milk",     quantity: "1",   unit: "gallon", expiry: inDays(7),  container: "fridge" },
    { id: Date.now() + 2, name: "Baby spinach",   quantity: "1",   unit: "bag",    expiry: inDays(4),  container: "fridge" },
    { id: Date.now() + 3, name: "Bell peppers",   quantity: "3",   unit: "",       expiry: inDays(6),  container: "fridge" },
    { id: Date.now() + 4, name: "Eggs",           quantity: "1",   unit: "dozen",  expiry: inDays(21), container: "fridge" },
    { id: Date.now() + 5, name: "Greek yogurt",   quantity: "32",  unit: "oz",     expiry: inDays(14), container: "fridge" },
    { id: Date.now() + 6, name: "Sourdough bread", quantity: "1",  unit: "loaf",   expiry: inDays(5),  container: "pantry" },
  ];
}

function BulkAddModal({ visible, onClose, onAddItems, section, presetMode, onPresetConsumed }) {
  // v1.16 — each row carries its own `container` so a single receipt can split
  // across fridge/pantry/freezer. Empty rows inherit the active fridge tab's
  // section as the default; typed/scanned items get smart defaults via
  // defaultContainerFor(name, category) once a name is entered (see updateRow
  // and applyReceiptItems below).
  const emptyRow = () => ({ id: Date.now() + Math.random(), name: "", quantity: "1", unit: "", expiry: "", container: section || "fridge" });
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  // v1.15 — sample-receipt banner. Shown when the modal opens with
  // presetMode="sample" (from the empty-state "Try a sample receipt" CTA).
  // Tells the user the data isn't real yet and they should edit or commit it.
  const [isSample, setIsSample] = useState(false);
  // v1.15 hotfix — capture the presetMode AT MODAL OPEN, not on every change.
  // Without this ref, the parent calling onPresetConsumed→setBulkAddPresetMode(null)
  // re-fires the visible/presetMode useEffect with presetMode=null, which
  // wipes the sample rows back to 3 empty rows. The ref pins the mode for
  // the lifetime of this modal session.
  const presetForThisOpenRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      presetForThisOpenRef.current = null;
      return;
    }
    // Only initialize once per open. If the parent has already cleared
    // presetMode (via onPresetConsumed), presetForThisOpenRef holds the
    // original value so subsequent useEffect runs become no-ops.
    if (presetForThisOpenRef.current !== null) return;
    presetForThisOpenRef.current = presetMode || "manual";

    if (presetMode === "sample") {
      // Skip the empty-row default — we want the user to land in a populated
      // state that demonstrates what a real receipt scan produces.
      setRows(buildSampleRows());
      setIsSample(true);
      track("sample_receipt_shown");
      if (onPresetConsumed) onPresetConsumed();
    } else {
      setRows([emptyRow(), emptyRow(), emptyRow()]);
      setIsSample(false);
    }
  }, [visible, presetMode]);

  // Auto-launch the camera or library picker when the parent hands us
  // presetMode="scan-camera" / "scan-library". Same single-fire ref pattern
  // as the row-init effect above so onPresetConsumed clearing presetMode
  // doesn't trigger a re-fire.
  const presetScanFiredRef = useRef(false);
  useEffect(() => {
    if (!visible) {
      presetScanFiredRef.current = false;
      return;
    }
    if (presetScanFiredRef.current) return;
    if (presetMode === "scan-camera" || presetMode === "scan-library") {
      presetScanFiredRef.current = true;
      const src = presetMode === "scan-camera" ? "camera" : "library";
      // Defer one tick so the modal mount is fully settled before we
      // present another modal (the OS image picker).
      setTimeout(() => { handleScanReceipt(src); }, 80);
      if (onPresetConsumed) onPresetConsumed();
    }
  }, [visible, presetMode]);

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
          // v1.16 — pre-assign container based on category + name keywords so
          // a single receipt parsed scan auto-splits across fridge/pantry/
          // freezer. User can override per-row before committing.
          container: defaultContainerFor(item.name, cat),
          // v1.16 — capture the FoodKeeper-derived expiry from the scan-receipt
          // Edge Function as the USDA snapshot. The user can later shorten the
          // visible expiry to match their carton's printed date; this stays as
          // the "USDA says yours is conservative" reference.
          usdaDays: days,
        };
      });
    if (newRows.length > 0) setRows(newRows);
  }

  async function handleScanReceipt(source) {
    // v1.15 — track every entry into the scan flow so we have a denominator
    // for permission denial and OCR failure. Source distinguishes which CTA
    // surface launched it.
    track("receipt_scan_started", { source });
    try {
      let result;
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          // v1.15 — split denial into "first denial" (canAskAgain=true,
          // user can retry without going to Settings) vs "permanent
          // denial" (canAskAgain=false, must be unblocked in Settings).
          // PostHog will tell us how many users hit each gate.
          const permanent = perm.canAskAgain === false;
          track("camera_permission_denied", { permanent, surface: "receipt_camera" });
          Alert.alert(
            permanent ? "Camera access blocked" : "Camera access needed",
            permanent
              ? "ok2eat needs your camera to read grocery receipts. Open Settings to allow it — takes 5 seconds."
              : "Tap Allow on the next prompt and we'll read the items off your receipt automatically.",
            permanent
              ? [
                  { text: "Not now", style: "cancel" },
                  { text: "Open Settings", onPress: () => Linking.openSettings() },
                ]
              : [{ text: "OK" }]
          );
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
          const permanent = perm.canAskAgain === false;
          track("photo_library_permission_denied", { permanent, surface: "receipt_library" });
          Alert.alert(
            permanent ? "Photo access blocked" : "Photo access needed",
            permanent
              ? "ok2eat needs access to your photos so you can pick a saved receipt to scan. Open Settings to allow it."
              : "Tap Allow on the next prompt and we'll read the items off your saved receipt photo.",
            permanent
              ? [
                  { text: "Not now", style: "cancel" },
                  { text: "Open Settings", onPress: () => Linking.openSettings() },
                ]
              : [{ text: "OK" }]
          );
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.7,
          base64: true,
        });
      }
      if (result.canceled || !result.assets?.[0]?.base64) {
        // v1.15 — explicit cancel telemetry so we can see how often users
        // start the scan flow and bail out before snapping/picking a photo.
        track("receipt_scan_cancelled", { source });
        return;
      }

      setScanning(true);
      const parsed = await parseReceiptImage(result.assets[0].base64);
      if (Array.isArray(parsed) && parsed.length > 0) {
        applyReceiptItems(parsed);
        track("receipt_scanned", { source, item_count: parsed.length });
      } else {
        track("receipt_scan_no_items", { source });
        Alert.alert("No items found", "Couldn't extract food items from this image. Try a clearer photo.");
      }
    } catch (e) {
      track("receipt_scan_failed", { source });
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
      // v1.16 — prefer the per-row container (set by smart-default in
      // applyReceiptItems / emptyRow, or by user pill tap) over the modal-
      // level section prop. Falls back to section, then "fridge" for safety.
      const rowContainer = r.container || section || "fridge";
      // v1.16 — USDA-suggested date for the dual-date display. Receipt-scan
      // rows carry `usdaDays` from the FoodKeeper-backed Edge Function;
      // manual rows don't (yet). NULL → ItemDetailModal hides the secondary.
      const expiryUsdaDate = (typeof r.usdaDays === "number" && r.usdaDays > 0)
        ? new Date(Date.now() + r.usdaDays * 86400000).toISOString().slice(0, 10)
        : null;
      const itemName = r.name.trim();
      return {
        name: itemName,
        category: cat,
        emoji: inferEmoji(itemName, EMOJI_MAP[cat]),
        quantity,
        unit: (r.unit || "").trim() || null,
        expiryDate: expiry,
        section: rowContainer,
        isOpened: false,
        openedAt: null,
        expiryOpenedDays: packaged ? (OPENED_DAYS_MAP[cat] || 7) : null,
        expiryUnopened: packaged ? expiry.slice(0, 10) : null,
        expiryUsdaDate,
      };
    });
    await onAddItems(items);
    setAdding(false);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg, paddingTop: ANDROID_TOP_INSET }}>
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

            {isSample && (
              <View style={{ backgroundColor: "rgba(245,158,11,0.10)", borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: "rgba(245,158,11,0.30)" }}>
                <Text style={{ color: "#B45309", fontSize: 13, fontWeight: "700" }}>🥑 Sample receipt</Text>
                <Text style={{ color: "#92400E", fontSize: 13, marginTop: 4, lineHeight: 18 }}>This is what a real grocery scan looks like. Edit anything you want, then tap <Text style={{ fontWeight: "700" }}>Add all 6 items</Text> below to fill your fridge — or scan an actual receipt above.</Text>
              </View>
            )}

            <View style={{ backgroundColor: "rgba(22,163,74,0.08)", borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: "rgba(22,163,74,0.2)" }}>
              <Text style={{ color: T.accent, fontSize: 13, fontWeight: "600" }}>Scan a receipt to auto-fill, or type your grocery items below — category and expiry are auto-filled based on the item name.</Text>
            </View>

            {rows.map((row, index) => {
              const cat = row.name.trim() ? guessCategory(row.name) : null;
              const rowContainer = row.container || section || "fridge";
              return (
                <View key={row.id} style={[s.card, { padding: 14, marginBottom: 10 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: 20 }}>{cat ? inferEmoji(row.name, EMOJI_MAP[cat]) : "📝"}</Text>
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
                    onChangeText={v => {
                      // v1.16 — when user types/edits the name, re-evaluate the
                      // smart container default IF the row hasn't been manually
                      // overridden yet. We approximate "not manually overridden"
                      // by checking that current container matches the previous
                      // smart default for the previous name. Conservative: if
                      // the user has typed AND the container matches a smart
                      // default for the OLD name, update it. Otherwise leave
                      // their explicit choice alone.
                      const prevCat = row.name.trim() ? guessCategory(row.name) : null;
                      const prevDefault = defaultContainerFor(row.name, prevCat);
                      const newCat = v.trim() ? guessCategory(v) : null;
                      const newDefault = defaultContainerFor(v, newCat);
                      updateRow(row.id, "name", v);
                      if (row.container === prevDefault && newDefault !== prevDefault) {
                        updateRow(row.id, "container", newDefault);
                      }
                    }}
                  />

                  {/* v1.16 — per-row container picker. Three equal pills.
                      Tapping commits the choice and locks it (no further
                      smart-default overrides on name edit). */}
                  <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
                    {[
                      { id: "fridge",  label: "🧊 Fridge"  },
                      { id: "pantry",  label: "🥫 Pantry"  },
                      { id: "freezer", label: "❄️ Freezer" },
                    ].map(opt => {
                      const selected = rowContainer === opt.id;
                      return (
                        <TouchableOpacity
                          key={opt.id}
                          onPress={() => updateRow(row.id, "container", opt.id)}
                          style={{
                            flex: 1,
                            paddingVertical: 8,
                            paddingHorizontal: 4,
                            borderRadius: 10,
                            borderWidth: 1,
                            borderColor: selected ? T.accent : T.border,
                            backgroundColor: selected ? "rgba(22,163,74,0.10)" : "transparent",
                            alignItems: "center",
                          }}
                          accessibilityLabel={`Set container to ${opt.id}`}
                          accessibilityState={{ selected }}
                        >
                          <Text style={{
                            fontSize: 13,
                            fontWeight: selected ? "700" : "500",
                            color: selected ? T.accent : T.textSoft,
                          }}>{opt.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
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
                    {/* v1.16 bug fix — was hardcoded "to Fridge" but in v1.16
                        each row has its own per-row container picker
                        (Fridge/Pantry/Freezer). Dropping the destination
                        from the button — the row pills are the source of
                        truth for where each item lands. */}
                    {validRows.length === 0
                      ? "Enter items above"
                      : `✅  Add ${validRows.length} Item${validRows.length !== 1 ? "s" : ""}`}
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
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg, paddingTop: ANDROID_TOP_INSET }}>
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
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg, paddingTop: ANDROID_TOP_INSET }}>
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
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg, paddingTop: ANDROID_TOP_INSET }}>
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
  // v1.21 — Receipt-source chooser. Greg's Pixel 9 testing surfaced that
  // tapping "Scan Receipt" jumped straight to the system camera with no
  // way to upload a saved photo. The new flow: tap → small chooser sheet
  // (Take Photo / Upload from Photos / Cancel) → onScanReceipt(source).
  const [showReceiptChooser, setShowReceiptChooser] = useState(false);
  const [initialQty, setInitialQty] = useState("");
  const [initialUnit, setInitialUnit] = useState("");
  // v1.17 — container is selectable from inside AddModal (was previously
  // locked to whatever section the modal opened from). Mirrors BulkAddModal's
  // per-row container chips. Default to the section the user is on; fall
  // back to "fridge".
  const [container, setContainer] = useState(
    ["fridge", "pantry", "freezer"].includes(section) ? section : "fridge"
  );
  // v1.0.9 — expiration is now editable in the form. closedDays = days from
  // today the item lasts UNOPENED (or just "lasts" for fresh items).
  // openedDays = how many days after opening the item is still good. Both
  // default from category maps; user can override.
  const [closedDays, setClosedDays] = useState(EXPIRY_MAP["Other"] || 7);
  const [openedDays, setOpenedDays] = useState(OPENED_DAYS_MAP["Other"] || 7);
  // v1.16 — remembers the most recent FoodKeeper-hit `closedDays` so we can
  // store the USDA-suggested date alongside the (possibly user-shortened)
  // expiry_date. NULL when there's no FoodKeeper match for this item.
  const [usdaSourceDays, setUsdaSourceDays] = useState(null);
  // v1.16 Phase 1 — type-ahead search results from the local product catalog.
  // Calls public.search_products(query) RPC. Debounced 300ms client-side.
  // suppressSearch flips to true when user picks a result, so re-renders
  // from setName() don't immediately re-fire the search.
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [suppressSearch, setSuppressSearch] = useState(false);
  const categories = ["Dairy", "Protein", "Produce", "Dry Goods", "Beverages", "Other"];
  const emojiMap = { Dairy: "🥛", Protein: "🍗", Produce: "🥬", "Dry Goods": "🥣", Beverages: "🍶", Other: "📦" };

  // Reset all fields when the modal opens. Avoids stale state from a prior add.
  useEffect(() => {
    if (visible) {
      setName(""); setCategory("Other"); setInitialQty(""); setInitialUnit("");
      // v1.17 — reset container to the section the modal opened from. If the
      // section isn't a known container, default to fridge.
      setContainer(
        ["fridge", "pantry", "freezer"].includes(section) ? section : "fridge"
      );
      setClosedDays(EXPIRY_MAP["Other"] || 7);
      setOpenedDays(OPENED_DAYS_MAP["Other"] || 7);
      setUsdaSourceDays(null);
      setSearchResults([]); setSearching(false); setSuppressSearch(false);
    }
  }, [visible, section]);

  // v1.16 Phase 1 — debounced type-ahead. Watches `name`. Skips if user just
  // picked a result (suppressSearch is true for one tick). Skips queries
  // shorter than 2 chars to avoid noisy returns.
  useEffect(() => {
    if (!visible) return;
    if (suppressSearch) { setSuppressSearch(false); return; }
    const trimmed = (name || "").trim();
    if (trimmed.length < 2) { setSearchResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        // v1.19 — cap at 4 results. More than that overruns the visible card,
        // pushes the rest of the form below the keyboard, and adds choice
        // overhead. 4 is enough to find the right brand 95% of the time.
        const { data, error } = await supabase.rpc("search_products", {
          query: trimmed,
          result_limit: 4,
        });
        if (cancelled) return;
        setSearchResults(error ? [] : (data || []));
      } catch (e) {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [name, visible]);

  // v1.16 Phase 1 — picking a search result populates the form. Sets name,
  // category, emoji from the catalog row. Suppresses the next search-fire
  // so we don't immediately re-query for the just-picked name.
  // v1.16 Phase 2 — also calls lookupShelfLife() so the days auto-fill from
  // FoodKeeper data instead of the flat category default.
  async function handlePickResult(result) {
    const cat = (result.category && categories.includes(result.category)) ? result.category : "Other";
    setSuppressSearch(true);
    setName(result.name || "");
    setCategory(cat);
    setSearchResults([]);
    track("addmodal_search_result_picked", {
      source: result.source,
      has_image: !!result.image_url,
      has_brand: !!result.brand,
    });
    // Set category default immediately, then await the FoodKeeper lookup.
    // This way the form is responsive (no flicker waiting for RPC).
    setClosedDays(EXPIRY_MAP[cat] || 7);
    setOpenedDays(OPENED_DAYS_MAP[cat] || 7);
    // v1.17 — look up against the user-selected container so freezer items
    // don't get pantry-window shelf life.
    const sl = await lookupShelfLife(result.name || "", cat, container);
    if (sl.source !== "category_default") {
      setClosedDays(sl.closedDays);
      setOpenedDays(sl.openedDays);
      setUsdaSourceDays(sl.closedDays); // v1.16 — capture USDA-source for dual-date display
      track("shelf_life_lookup_hit", {
        query: (result.name || "").slice(0, 40),
        match: (sl.matchName || "").slice(0, 40),
        days: sl.closedDays,
      });
    } else {
      setUsdaSourceDays(null);
    }
  }

  // When the user picks a different category, snap the day defaults to that
  // category's typical shelf life so they don't have to remember it. Then,
  // if there's a name, kick off a FoodKeeper lookup with the new container
  // / category combo to refine the default.
  async function handleCategoryChange(c) {
    setCategory(c);
    setClosedDays(EXPIRY_MAP[c] || 7);
    setOpenedDays(OPENED_DAYS_MAP[c] || 7);
    setUsdaSourceDays(null); // reset; lookup below may re-populate
    if ((name || "").trim().length >= 2) {
      // v1.17 — pass selected container so shelf-life matches user's choice.
      const sl = await lookupShelfLife(name.trim(), c, container);
      if (sl.source !== "category_default") {
        setClosedDays(sl.closedDays);
        setOpenedDays(sl.openedDays);
        setUsdaSourceDays(sl.closedDays);
      }
    }
  }

  // v1.16 Phase 2 — debounced FoodKeeper lookup on name changes. Runs in
  // parallel with the existing type-ahead but doesn't wait for the user to
  // pick a result. As soon as the typed name has a confident FoodKeeper
  // match, we update the day defaults so the user sees an accurate number
  // by the time they get to the days field. 600ms debounce is gentler than
  // the 300ms search debounce — avoids RPC churn on every keystroke.
  useEffect(() => {
    if (!visible) return;
    if (suppressSearch) return; // we just set the name from a picked result; lookup ran there
    const trimmed = (name || "").trim();
    if (trimmed.length < 3) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      // v1.17 — debounced FoodKeeper lookup now respects the container chip.
      // Re-runs if the user switches Fridge/Pantry/Freezer mid-form.
      const sl = await lookupShelfLife(trimmed, category, container);
      if (cancelled) return;
      if (sl.source !== "category_default") {
        setClosedDays(sl.closedDays);
        setOpenedDays(sl.openedDays);
        setUsdaSourceDays(sl.closedDays);
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(t); };
  }, [name, category, container, visible]);

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

    // v1.16 — if we got a FoodKeeper hit on this item, snapshot the
    // USDA-suggested date so ItemDetailModal can surface the dual-date
    // "USDA says yours is conservative" moment. NULL when no FoodKeeper match.
    const expiryUsdaDate = usdaSourceDays
      ? new Date(Date.now() + usdaSourceDays * 86400000).toISOString().slice(0, 10)
      : null;

    onAdd({
      name: name.trim(),
      category,
      emoji: emojiMap[category],
      quantity,
      unit,
      expiryDate: expiryDateIso,
      // v1.17 — use the user-selected container (chip picker) instead of the
      // section the modal was opened from. Lets you add a freezer item from
      // the Fridge tab without re-navigating first.
      section: container,
      container,
      isOpened: false,
      openedAt: null,
      expiryOpenedDays: packaged ? openedDays : null,
      expiryUnopened: packaged ? expiryDateIso.slice(0, 10) : null,
      expiryUsdaDate,
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
            {/* v1.15 hotfix — explicit Cancel button. The sheet handle and
                tap-outside both still work, but neither is discoverable
                enough as a back affordance (tester feedback after the v1.15
                build smoke-test). Title + Cancel laid out as a header row. */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <Text style={[s.bold, { fontSize: 20 }]}>Add Item</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={{ color: T.accent, fontSize: 15, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
            </View>

            {/* v1.17 — Three prominent peer tiles for the fast-paths.
                "Multi-add" was previously a low-emphasis text link below the
                form; testers reported they didn't find it. Promoted to peer
                of Scan Barcode + Scan Receipt for discoverability. The text
                link at the bottom of the modal was removed. */}
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: "rgba(22,163,74,0.08)", borderWidth: 1, borderColor: "rgba(22,163,74,0.25)", borderRadius: 14, padding: 12, alignItems: "center", gap: 4 }}
                onPress={() => { onClose(); setTimeout(() => onGoToScan && onGoToScan(), 350); }}
                accessibilityLabel="Scan barcode"
              >
                <Text style={{ fontSize: 26 }}>📷</Text>
                <Text style={[s.bold, { fontSize: 12, textAlign: "center" }]}>Scan Barcode</Text>
                <Text style={{ color: T.textSoft, fontSize: 10, textAlign: "center" }}>One product</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: "rgba(22,163,74,0.08)", borderWidth: 1, borderColor: "rgba(22,163,74,0.25)", borderRadius: 14, padding: 12, alignItems: "center", gap: 4 }}
                onPress={() => setShowReceiptChooser(true)}
                accessibilityLabel="Scan or upload receipt"
              >
                <Text style={{ fontSize: 26 }}>🧾</Text>
                <Text style={[s.bold, { fontSize: 12, textAlign: "center" }]}>Scan/Upload Receipt</Text>
                <Text style={{ color: T.textSoft, fontSize: 10, textAlign: "center" }}>Whole grocery run</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: "rgba(22,163,74,0.08)", borderWidth: 1, borderColor: "rgba(22,163,74,0.25)", borderRadius: 14, padding: 12, alignItems: "center", gap: 4 }}
                onPress={() => { onClose(); setTimeout(() => onBulkAdd && onBulkAdd(), 350); }}
                accessibilityLabel="Add multiple items"
              >
                <Text style={{ fontSize: 26 }}>📝</Text>
                <Text style={[s.bold, { fontSize: 12, textAlign: "center" }]}>Add a List</Text>
                <Text style={{ color: T.textSoft, fontSize: 10, textAlign: "center" }}>Several at once</Text>
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

            {/* v1.17 — Container picker. Mirrors BulkAddModal's per-row chips.
                Defaults to the section the modal opened from (e.g. opening
                Add from the Freezer tab pre-selects Freezer), but the user
                can override. The selection drives the FoodKeeper shelf-life
                window used to compute closedDays / openedDays. */}
            <Text style={s.inputLabel}>Container</Text>
            <View style={{ flexDirection: "row", gap: 6, marginBottom: 14 }}>
              {[
                { id: "fridge",  label: "🧊 Fridge"  },
                { id: "pantry",  label: "🥫 Pantry"  },
                { id: "freezer", label: "❄️ Freezer" },
              ].map(opt => {
                const selected = container === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    onPress={() => setContainer(opt.id)}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      paddingHorizontal: 4,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: selected ? T.accent : T.border,
                      backgroundColor: selected ? "rgba(22,163,74,0.10)" : "transparent",
                      alignItems: "center",
                    }}
                    accessibilityLabel={`Set container to ${opt.id}`}
                    accessibilityState={{ selected }}
                  >
                    <Text style={{
                      fontSize: 14,
                      fontWeight: selected ? "700" : "500",
                      color: selected ? T.accent : T.textSoft,
                    }}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={s.inputLabel}>Item name *</Text>
            <TextInput style={s.input} placeholder="e.g. Almond Butter" placeholderTextColor={T.muted} value={name} onChangeText={setName} />

            {/* v1.16 Phase 1 — type-ahead results from local product catalog.
                Renders below the name input when ≥2 chars typed. Tapping a
                result populates name/category/emoji and clears the dropdown. */}
            {(searching || searchResults.length > 0) && (
              <View style={{ marginTop: -10, marginBottom: 12, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 10, overflow: "hidden" }}>
                {searching && searchResults.length === 0 && (
                  <View style={{ padding: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator size="small" color={T.muted} />
                    <Text style={{ fontSize: 12, color: T.textSoft }}>Searching products…</Text>
                  </View>
                )}
                {searchResults.map((r, idx) => (
                  <TouchableOpacity
                    key={r.id || `${r.source}-${idx}`}
                    onPress={() => handlePickResult(r)}
                    style={{ flexDirection: "row", alignItems: "center", padding: 10, gap: 10, borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: T.border }}
                    accessibilityLabel={`Pick ${r.name}`}
                  >
                    {r.image_url ? (
                      <Image
                        source={{ uri: r.image_url }}
                        style={{ width: 36, height: 36, borderRadius: 6, backgroundColor: T.bg }}
                      />
                    ) : (
                      <View style={{ width: 36, height: 36, borderRadius: 6, backgroundColor: T.bg, alignItems: "center", justifyContent: "center" }}>
                        {/* v1.16 Phase 1 — image_url + emoji not stored to save space.
                            Compute emoji client-side from the category. Falls back to
                            generic 📦 for "Other" or unknown categories. */}
                        <Text style={{ fontSize: 20 }}>{r.emoji || emojiMap[r.category] || "📦"}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: T.text }} numberOfLines={1}>
                        {r.name}
                      </Text>
                      <Text style={{ fontSize: 11, color: T.textSoft, marginTop: 2 }} numberOfLines={1}>
                        {[r.brand, r.category].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                    <Ionicons name="add-circle" size={20} color={T.accent} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

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

            {/* v1.17 — Button label tracks the in-modal container chip (was
                section prop in v1.16; broken when user changed the picker
                mid-form). */}
            <TouchableOpacity style={s.btnPrimary} onPress={handleAdd}>
              <Text style={s.btnPrimaryText}>
                Add to {container.charAt(0).toUpperCase() + container.slice(1)}
              </Text>
            </TouchableOpacity>
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
            {/* v1.17 — removed the low-emphasis "Add a list of items
                manually" link here. The "Add a List" tile in the top row
                now surfaces the multi-add screen at peer-level with Scan
                Barcode + Scan Receipt. */}
            <View style={{ height: 16 }} />
          </ScrollView>
        </TouchableOpacity>

        {/* v1.21 — Receipt-source chooser overlay. Sits ABOVE the AddModal
            scroll content (siblings inside the same Modal) so we avoid the
            nested-Modal flicker on Android. Tapping the backdrop or Cancel
            dismisses; the two action buttons close AddModal and dispatch
            to onScanReceipt with the chosen source ('camera' | 'library'). */}
        {showReceiptChooser && (
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setShowReceiptChooser(false)}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => { /* swallow taps inside the sheet */ }}
              style={{ backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 }}
            >
              <View style={{ alignItems: "center", marginBottom: 14 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.border }} />
              </View>
              <Text style={[s.bold, { fontSize: 18, marginBottom: 4 }]}>Add a receipt</Text>
              <Text style={{ color: T.textSoft, fontSize: 13, marginBottom: 18 }}>
                Take a fresh photo of your grocery receipt, or pick a saved one from your photos.
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowReceiptChooser(false);
                  onClose();
                  setTimeout(() => onScanReceipt && onScanReceipt("camera"), 350);
                }}
                style={{ backgroundColor: "rgba(22,163,74,0.08)", borderWidth: 1, borderColor: "rgba(22,163,74,0.3)", borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 10 }}
              >
                <Text style={{ fontSize: 28 }}>📷</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[s.bold, { fontSize: 15 }]}>Take Photo</Text>
                  <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Open the camera</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={T.muted} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setShowReceiptChooser(false);
                  onClose();
                  setTimeout(() => onScanReceipt && onScanReceipt("library"), 350);
                }}
                style={{ backgroundColor: "rgba(22,163,74,0.08)", borderWidth: 1, borderColor: "rgba(22,163,74,0.3)", borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 }}
              >
                <Text style={{ fontSize: 28 }}>🖼️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[s.bold, { fontSize: 15 }]}>Upload from Photos</Text>
                  <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 2 }}>Pick a saved receipt photo</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={T.muted} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowReceiptChooser(false)}
                style={{ alignItems: "center", paddingVertical: 12 }}
              >
                <Text style={{ color: T.textSoft, fontSize: 14, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
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

// ─── Plan Screen (v1.0.8, revised v1.18) ─────────────────────────────────────
// Two sections now (the external-link Recipe Ideas was removed in v1.18 —
// recipe generation is native via Eat Me First + daily digest):
//   1. Shopping lists — household-shared, supports multiple named lists,
//      member-initial badges, recently-added quick-add chips, past-lists
//      revival. Order-N-items retailer picker at the bottom.
//   2. Saved Recipes — v1.18. User_recipes_saved rows the user heart-toggled
//      from the deep-link recipe sheet. Tap a card to re-open the recipe.
function PlanScreen({ items, householdId, onOpenRecipeId, onOpenSavedRecipe, listsRefreshKey, targetListId, onTargetListConsumed }) {
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

  // v1.21 #215 — Share toast. Shown for ~2.5s after the share sheet
  // either succeeded or was canceled. Sits at the top of the Plan tab.
  const [shareToast, setShareToast] = useState(null);   // string | null

  // v1.18 — Saved Recipes section. Pulls user_recipes_saved rows (the user's
  // own heart-toggled recipes from the deep-link recipe sheet) and surfaces
  // them under Past Lists in the list-picker view. Tapping a saved-recipe
  // card opens a detail sheet identical in shape to the deep-link modal.
  const [savedRecipes, setSavedRecipes] = useState([]);           // [{id, recipe_data, saved_at}]
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [savedExpanded, setSavedExpanded] = useState(true);       // open-by-default; users actively saved these
  const [openSavedRecipe, setOpenSavedRecipe] = useState(null);   // the recipe object currently shown in detail sheet

  // v1.19 — Recipes section. NEW primary surface for recipe discovery in the
  // Plan tab. Three sub-tabs backed by the recipe-browse Edge Function:
  //   • tonight — personalized picks ranked by user's fridge overlap;
  //               prepends today's morning-digest picks if present.
  //   • browse  — full bank catalog, optionally filtered by meal_type.
  //   • search  — full-text search against bank (name + description).
  // Each card taps through to the existing deep-link RecipeSheet modal,
  // which now handles both bank-slug and daily-cache id shapes.
  const [recipesTab, setRecipesTab] = useState("tonight");        // "tonight" | "browse" | "search"
  const [tonightRecipes, setTonightRecipes] = useState([]);       // [RecipeCard, ...]
  const [browseRecipes, setBrowseRecipes] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  // Filter chip for the Browse tab. Single-select for v1.19; dietary tags
  // come in a follow-up if users ask. null = no filter.
  const [browseMealType, setBrowseMealType] = useState(null);     // null | "breakfast" | "lunch" | "dinner" | "snack" | "dessert"
  // v1.19 — cuisine-first flow per Greg's UX feedback. Tonight + All-Recipes
  // ask "what are you craving" first, then filter results to that cuisine.
  // Reduces the "30 recipes scrolling" feel and turns the experience into
  // a guided pick. null = haven't chosen yet (show the picker).
  const [tonightCuisine, setTonightCuisine] = useState(null);
  const [browseCuisine, setBrowseCuisine] = useState(null);
  // List of cuisines to surface in pickers. Ordered roughly by bank size
  // (largest cuisines first) so the most varied options are most visible.
  const CUISINE_PICKER_OPTIONS = [
    { key: "italian",        emoji: "🍝", label: "Italian" },
    { key: "mexican",        emoji: "🌮", label: "Mexican" },
    { key: "chinese",        emoji: "🥡", label: "Chinese" },
    { key: "japanese",       emoji: "🍣", label: "Japanese" },
    { key: "thai",           emoji: "🌶️", label: "Thai" },
    { key: "indian",         emoji: "🍛", label: "Indian" },
    { key: "korean",         emoji: "🍱", label: "Korean" },
    { key: "vietnamese",     emoji: "🍜", label: "Vietnamese" },
    { key: "mediterranean",  emoji: "🫒", label: "Mediterranean" },
    { key: "middle_eastern", emoji: "🧆", label: "Middle Eastern" },
    { key: "french",         emoji: "🥐", label: "French" },
    { key: "american",       emoji: "🍔", label: "American" },
  ];

  // Load household lists + members in parallel.
  async function loadLists() {
    if (!householdId) { setLists([]); setLoadingLists(false); return; }
    try {
      // v1.21 #215 — pull share_token + is_public_shareable so the in-app
      // Share button can reuse an existing token instead of regenerating
      // one per tap (regenerating would invalidate previously-shared links).
      const { data, error } = await supabase
        .from("shopping_lists")
        .select("id, name, archived_at, created_by, created_at, share_token, is_public_shareable")
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

  // v1.18 — saved recipes loader. RLS scopes to auth.uid() automatically.
  // Newest saves first, capped at 50 — anyone with 50+ saved recipes is in
  // power-user territory and a future "search saved" UI can be added later.
  async function loadSavedRecipes() {
    setLoadingSaved(true);
    try {
      const { data, error } = await supabase
        .from("user_recipes_saved")
        .select("id, recipe_data, saved_at, source_recipe_id")
        .order("saved_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setSavedRecipes(data || []);
    } catch (e) {
      console.warn("[plan] loadSavedRecipes failed:", e?.message || e);
      setSavedRecipes([]);
    } finally {
      setLoadingSaved(false);
    }
  }

  async function removeSavedRecipe(id) {
    try {
      const { error } = await supabase.from("user_recipes_saved").delete().eq("id", id);
      if (error) throw error;
      setSavedRecipes(prev => prev.filter(r => r.id !== id));
      track("recipe_unsaved", { source: "plan_tab" });
    } catch (e) {
      console.warn("[plan] removeSavedRecipe failed:", e?.message || e);
    }
  }

  // v1.21 #215 — Share the active shopping list publicly. Mirrors
  // web/src/screens/Plan.jsx shareActiveList(). First share generates a
  // UUID `share_token` + flips `is_public_shareable=true` on the
  // shopping_lists row; subsequent shares of the same list reuse the
  // token so the link stays stable for recipients. The token grants
  // read-only access via the `get-shared-list` Edge Function — anyone
  // with the link can view, only household members can edit.
  //
  // Math.random-based UUID v4 instead of `crypto.randomUUID()` because
  // Hermes (React Native's JS engine) doesn't ship the WebCrypto global
  // by default. Collision risk is negligible for a per-list token, and
  // the DB's UNIQUE index would catch any anyway.
  function generateUuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  async function shareActiveList() {
    const list = lists.find(l => l.id === activeListId);
    if (!list) return;
    let token = list.share_token;
    if (!token || !list.is_public_shareable) {
      token = generateUuid();
      try {
        const { error } = await supabase
          .from("shopping_lists")
          .update({
            share_token: token,
            is_public_shareable: true,
            share_token_created_at: new Date().toISOString(),
          })
          .eq("id", list.id);
        if (error) throw error;
        // Update local cache so subsequent shares reuse the token.
        setLists(prev => prev.map(l =>
          l.id === list.id
            ? { ...l, share_token: token, is_public_shareable: true }
            : l));
        track("shopping_list_share_link_generated", { list_id: list.id });
      } catch (e) {
        console.warn("[plan] shareActiveList token-gen failed:", e?.message || e);
        setShareToast("Couldn't generate link. Try again.");
        setTimeout(() => setShareToast(null), 2500);
        return;
      }
    }
    const url = `https://ok2eat.com/lists?t=${token}`;
    try {
      // v1.22 #232 — Platform-aware share to fix iMessage duplicate
      // link preview. iOS attaches `url` as a separate URL preview, so
      // having the same URL ALSO in `message` produces TWO previews.
      // Android ignores the `url` field entirely, so the URL has to be
      // in message to render at all.
      const result = await Share.share(Platform.OS === "ios"
        ? { message: `Shopping list: ${list.name}`, url, title: list.name }
        : { message: `Shopping list: ${list.name}\n${url}`, title: list.name }
      );
      if (result.action === Share.sharedAction) {
        track("shopping_list_shared", { list_id: list.id, activity: result.activityType || null });
        setShareToast("Link shared");
      } else {
        setShareToast("Link copied — paste anywhere");
      }
      setTimeout(() => setShareToast(null), 2500);
    } catch (e) {
      console.warn("[plan] Share.share failed:", e?.message || e);
      setShareToast("Couldn't open share sheet.");
      setTimeout(() => setShareToast(null), 2500);
    }
  }

  // v1.19 — recipe-browse Edge Function call. Pulls cards for the current
  // Recipes sub-tab. We use supabase.functions.invoke so the auth header is
  // attached automatically (the Tonight tab needs JWT to score the user's
  // fridge; Browse + Search work anon but invoke handles auth consistently).
  //
  // Returns nothing — sets state directly. Silent-fails on error: the section
  // shows an empty state and tap-to-retry, rather than blocking the rest of
  // the Plan tab.
  async function loadRecipesForTab(tab, opts = {}) {
    // The "saved" tab is purely client-side — no Edge Function call.
    if (tab === "saved") return;

    setLoadingRecipes(true);
    try {
      // "all" tab maps to either the search or browse Edge Function path.
      // Search if there's a non-empty query, else browse with optional
      // meal_type filter. Limit 50 (max) so client-side cuisine filter
      // has enough candidates after the server-side ranking.
      let body = { limit: 50 };
      if (tab === "tonight") {
        body.tab = "tonight";
      } else if (tab === "all") {
        const q = (opts.q ?? searchQuery ?? "").trim();
        if (q) {
          body.tab = "search";
          body.q = q;
          body.meal_type = opts.meal_type ?? browseMealType ?? undefined;
        } else {
          body.tab = "browse";
          body.meal_type = opts.meal_type ?? browseMealType ?? undefined;
        }
      }
      const { data, error } = await supabase.functions.invoke("recipe-browse", { body });
      if (error) throw error;
      const recipes = Array.isArray(data?.recipes) ? data.recipes : [];
      if (tab === "tonight") setTonightRecipes(recipes);
      else if (tab === "all") setBrowseRecipes(recipes);
      track("recipe_browse_tab_view", {
        tab,
        result_count: recipes.length,
        meal_type: body.meal_type || null,
        q_present: !!body.q,
      });
    } catch (e) {
      console.warn(`[plan] loadRecipesForTab(${tab}) failed:`, e?.message || e);
    } finally {
      setLoadingRecipes(false);
    }
  }

  useEffect(() => { loadLists(); loadMembers(); loadRecentShoppingNames(); loadArchivedLists(); loadSavedRecipes(); /* eslint-disable-line */ }, [householdId, listsRefreshKey]);

  // v1.19 — when App signals a target list (e.g. after the recipe → new-list
  // flow), switch our active view to it so the user lands on the items they
  // just added. The signal is consumed (parent clears it) so we don't loop.
  useEffect(() => {
    if (targetListId) {
      setActiveListId(targetListId);
      if (onTargetListConsumed) onTargetListConsumed();
    }
  }, [targetListId]);  // eslint-disable-line
  useEffect(() => { if (activeListId) loadItems(activeListId); else setList([]); /* eslint-disable-line */ }, [activeListId]);

  // v1.19 — Recipes section auto-load. Tonight loads once when the user lands
  // on the Plan tab (and again if the user reopens the picker after household
  // changes, hence the householdId dependency). Browse + Search load on tab
  // switch / filter change / query change — handled in separate effects below.
  useEffect(() => { loadRecipesForTab("tonight"); /* eslint-disable-line */ }, [householdId]);
  // "all" tab: combined browse + search behavior. Fires on tab switch, on
  // meal-type filter change, and on debounced query change (300ms).
  useEffect(() => {
    if (recipesTab !== "all") return;
    const t = setTimeout(() => loadRecipesForTab("all"), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [recipesTab, browseMealType, searchQuery]);

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

  // v1.18 — notify other household members when this user edits a shared
  // list. Fires the send-shopping-list-notify Edge Function. Fire-and-forget:
  // we don't await + we swallow errors. The notification is non-critical;
  // missing one is fine. The function itself short-circuits when there are
  // no other members or no push tokens.
  async function notifyHousehold(action, opts = {}) {
    if (!activeListId) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      // Use the global fetch — keep this off the critical path. ~50ms.
      fetch(`${SUPABASE_URL}/functions/v1/send-shopping-list-notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          list_id: activeListId,
          action,
          item_name: opts.item_name,
          item_count: opts.item_count,
        }),
      }).catch(() => { /* swallow */ });
    } catch (e) { /* never block the user on a notification */ }
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
      // v1.18 — push other household members.
      notifyHousehold("added", { item_name: trimmed });
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
      // v1.18 — push other household members. One notification per bulk-add
      // batch (not per item) so we don't spam the household with 12 pushes
      // when someone pastes a Costco list.
      notifyHousehold("bulk_added", { item_count: cleaned.length });
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

  // v1.18 — removed the external-link RECIPE IDEAS section (AllRecipes /
  // NYT Cooking / Epicurious search cards). Recipes are now generated
  // natively via the v1.16 Eat Me First tab + v1.18 daily-digest flow, so
  // sending users out of the app to ad-heavy recipe sites was a regression.
  // The Plan tab is now purely shopping-list-focused, plus the v1.18
  // Saved Recipes section further down.

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
          <Text style={s.pageSubtitle}>Recipes · shopping lists · saved</Text>
        </View>
      </View>

      {/* v1.19 — Recipes section. Primary surface for recipe discovery.
          Three sub-tabs: Tonight (personalized via fridge), Browse (full
          bank by meal type), Search (text query against name+description).
          Each card opens the existing deep-link RecipeSheet modal. Shown
          at the TOP of Plan, above shopping lists, regardless of whether
          the user is in picker or in-list mode — recipes are the headline. */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 8, marginTop: 8 }}>
        <Text style={[s.sectionLabel, { paddingHorizontal: 0, marginBottom: 0 }]}>// RECIPES</Text>
      </View>
      {/* Sub-tab pills — v1.19 final tab structure:
            Tonight  → personalized by fridge overlap
            All      → catalog with search input + meal-type filter chips
            Saved    → user_recipes_saved (was a standalone section before)
          (Browse and Search merged into "All" because they're really one
           surface — type to filter, leave empty to browse everything.) */}
      <View style={{ flexDirection: "row", paddingHorizontal: 16, marginBottom: 10, gap: 8 }}>
        {[
          { key: "tonight", label: "Tonight" },
          { key: "all",     label: "All Recipes" },
          { key: "saved",   label: "Saved" },
        ].map(t => {
          const active = recipesTab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setRecipesTab(t.key)}
              style={{
                paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16,
                backgroundColor: active ? T.accent : "rgba(0,0,0,0.04)",
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "700", color: active ? "#fff" : T.text }}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* "All Recipes" tab gets both a search input AND meal-type filter chips. */}
      {recipesTab === "all" && (
        <>
          <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by name — try 'lasagna' or 'thai'"
              placeholderTextColor={T.muted}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                borderWidth: 1, borderColor: "rgba(0,0,0,0.10)",
                borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
                fontSize: 14, color: T.text, backgroundColor: T.surface,
              }}
            />
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16, marginBottom: 10, gap: 6 }}>
            {[null, "breakfast", "lunch", "dinner", "snack", "dessert"].map(mt => {
              const active = browseMealType === mt;
              const label = mt === null ? "All" : mt.charAt(0).toUpperCase() + mt.slice(1);
              return (
                <TouchableOpacity
                  key={mt || "all"}
                  onPress={() => setBrowseMealType(mt)}
                  style={{
                    paddingHorizontal: 11, paddingVertical: 5, borderRadius: 12,
                    borderWidth: 1, borderColor: active ? T.accent : "rgba(0,0,0,0.10)",
                    backgroundColor: active ? "rgba(22,163,74,0.10)" : "transparent",
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: "600", color: active ? T.accent : T.textSoft }}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {/* v1.19 — cuisine-first gate. Both Tonight and All Recipes start with
          a "what are you craving?" picker. Once a cuisine is selected, we
          filter the loaded recipes client-side and show the cards. Saved
          tab bypasses this entirely. */}
      {recipesTab === "tonight" && !tonightCuisine && (
        <View style={{ paddingHorizontal: 16, marginBottom: 18 }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: T.text, marginBottom: 12 }}>
            What are you craving?
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {CUISINE_PICKER_OPTIONS.map(c => (
              <TouchableOpacity
                key={c.key}
                onPress={() => setTonightCuisine(c.key)}
                style={[s.card, { padding: 12, flexDirection: "row", alignItems: "center", gap: 8, flexBasis: "47%", flexGrow: 1 }]}
              >
                <Text style={{ fontSize: 22 }}>{c.emoji}</Text>
                <Text style={[s.bold, { fontSize: 14, color: T.text }]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ color: T.textSoft, fontSize: 11, marginTop: 12, textAlign: "center" }}>
            Pick a cuisine to see recipes that use what's in your fridge.
          </Text>
        </View>
      )}

      {recipesTab === "all" && !browseCuisine && (
        <View style={{ paddingHorizontal: 16, marginBottom: 18 }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: T.text, marginBottom: 12 }}>
            Pick a cuisine
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {CUISINE_PICKER_OPTIONS.map(c => (
              <TouchableOpacity
                key={c.key}
                onPress={() => setBrowseCuisine(c.key)}
                style={[s.card, { padding: 12, flexDirection: "row", alignItems: "center", gap: 8, flexBasis: "47%", flexGrow: 1 }]}
              >
                <Text style={{ fontSize: 22 }}>{c.emoji}</Text>
                <Text style={[s.bold, { fontSize: 14, color: T.text }]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* "Change cuisine" pill when a cuisine is locked in */}
      {((recipesTab === "tonight" && tonightCuisine) || (recipesTab === "all" && browseCuisine)) && (
        <View style={{ paddingHorizontal: 16, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TouchableOpacity
            onPress={() => {
              if (recipesTab === "tonight") setTonightCuisine(null);
              else setBrowseCuisine(null);
            }}
            style={{
              flexDirection: "row", alignItems: "center", gap: 6,
              paddingHorizontal: 11, paddingVertical: 6, borderRadius: 14,
              backgroundColor: "rgba(22,163,74,0.10)",
            }}
          >
            <Ionicons name="arrow-back" size={14} color={T.accent} />
            <Text style={{ fontSize: 12, fontWeight: "700", color: T.accent }}>
              {CUISINE_PICKER_OPTIONS.find(c => c.key === (recipesTab === "tonight" ? tonightCuisine : browseCuisine))?.emoji} {CUISINE_PICKER_OPTIONS.find(c => c.key === (recipesTab === "tonight" ? tonightCuisine : browseCuisine))?.label}
            </Text>
          </TouchableOpacity>
          <Text style={{ color: T.textSoft, fontSize: 11 }}>· tap to change</Text>
        </View>
      )}

      {/* Recipe cards. "saved" tab renders user_recipes_saved rows directly;
          other tabs render results from recipe-browse. Tonight and All only
          render when a cuisine has been selected. */}
      {recipesTab === "saved" ? (
        <View style={{ paddingHorizontal: 16, marginBottom: 18 }}>
          {loadingSaved && savedRecipes.length === 0 ? (
            <View style={[s.card, { padding: 14 }]}>
              <Text style={{ fontSize: 13, color: T.textSoft }}>Loading saved recipes…</Text>
            </View>
          ) : savedRecipes.length === 0 ? (
            <View style={[s.card, { padding: 14, alignItems: "center" }]}>
              <Text style={{ fontSize: 13, color: T.textSoft, textAlign: "center" }}>
                No saved recipes yet. Tap the heart on any recipe to save it here.
              </Text>
            </View>
          ) : (
            savedRecipes.map(sr => {
              const r = sr.recipe_data || {};
              const meta = [r.time, r.difficulty].filter(Boolean).join(" · ");
              return (
                <TouchableOpacity
                  key={sr.id}
                  onPress={() => {
                    track("saved_recipe_opened", { name: r.name, source: "saved_tab" });
                    // Open in the unified deepLinkRecipe sheet via the
                    // App-level setter (PlanScreen doesn't have direct
                    // access to deepLinkRecipe state).
                    if (onOpenSavedRecipe) onOpenSavedRecipe(r, sr.id);
                  }}
                  style={[s.card, { padding: 12, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 }]}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: "rgba(22,163,74,0.08)", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 24 }}>{r.emoji || "🍽️"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.bold, { fontSize: 14, color: T.text }]} numberOfLines={1}>{r.name || "Untitled recipe"}</Text>
                    <Text style={{ color: T.textSoft, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                      {meta || "Saved recipe"}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => Alert.alert(
                      "Remove this recipe?",
                      `"${r.name || "Untitled recipe"}" will be removed from your saved recipes.`,
                      [
                        { text: "Cancel", style: "cancel" },
                        { text: "Remove", style: "destructive", onPress: () => removeSavedRecipe(sr.id) },
                      ]
                    )}
                    hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                    style={{ paddingHorizontal: 6 }}
                  >
                    <Ionicons name="heart" size={20} color={T.danger} />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      ) : ((recipesTab === "tonight" && !tonightCuisine) || (recipesTab === "all" && !browseCuisine)) ? null : (() => {
        // Filter the loaded list by the locked-in cuisine. Tonight already
        // ranks by fridge overlap; we just keep the cuisine matches.
        const activeCuisine = recipesTab === "tonight" ? tonightCuisine : browseCuisine;
        const baseList = recipesTab === "tonight" ? tonightRecipes : browseRecipes;
        const currentList = activeCuisine
          ? baseList.filter(rc => rc.cuisine === activeCuisine)
          : baseList;
        if (loadingRecipes && currentList.length === 0) {
          return (
            <View style={{ paddingHorizontal: 16, marginBottom: 18 }}>
              <View style={[s.card, { padding: 14 }]}>
                <Text style={{ fontSize: 13, color: T.textSoft }}>Loading recipes…</Text>
              </View>
            </View>
          );
        }
        if (currentList.length === 0) {
          const emptyMsg =
            recipesTab === "tonight" ? "Add items to your fridge to get personalized picks." :
            (searchQuery.trim() ? `No matches for "${searchQuery.trim()}"` :
             browseMealType ? "No recipes match this filter." : "No recipes found.");
          return (
            <View style={{ paddingHorizontal: 16, marginBottom: 18 }}>
              <View style={[s.card, { padding: 14, alignItems: "center" }]}>
                <Text style={{ fontSize: 13, color: T.textSoft, textAlign: "center" }}>{emptyMsg}</Text>
              </View>
            </View>
          );
        }
        return (
          <View style={{ paddingHorizontal: 16, marginBottom: 18 }}>
            {currentList.map(rc => {
              const overlap = typeof rc.fridge_overlap_count === "number" ? rc.fridge_overlap_count : null;
              const timeLabel = rc.time_minutes != null ? `${rc.time_minutes} min` : "";
              const meta = [timeLabel, rc.difficulty].filter(Boolean).join(" · ");
              return (
                <TouchableOpacity
                  key={`${rc.source}-${rc.id}`}
                  onPress={() => {
                    track("recipe_pick", { source: rc.source, recipe_id: rc.id, tab: recipesTab, position: currentList.indexOf(rc) });
                    if (onOpenRecipeId) onOpenRecipeId(rc.id);
                  }}
                  style={[s.card, { padding: 12, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 }]}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: "rgba(22,163,74,0.08)", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 24 }}>{rc.emoji || "🍽️"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.bold, { fontSize: 14, color: T.text }]} numberOfLines={1}>{rc.name}</Text>
                    <Text style={{ color: T.textSoft, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                      {meta || rc.cuisine || "Recipe"}
                    </Text>
                  </View>
                  {overlap != null && overlap > 0 && (
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: "rgba(22,163,74,0.12)" }}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: T.accent }}>
                        USES {overlap}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })()}

      {/* v1.19 — Saved Recipes are now rendered inside the Recipes section
          as a sub-tab (Tonight / All Recipes / Saved), so no standalone
          section needed here. */}

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

            {/* v1.18 Saved Recipes moved out of picker view — see below. */}
          </View>

          {/* v1.18 — Saved-recipe detail sheet. Same visual language as the
              deep-link recipe modal at the App root: full ingredients + numbered
              instructions + chef tip. Opens when the user taps a saved-recipe
              card above. */}
          <Modal
            visible={!!openSavedRecipe}
            transparent
            animationType="slide"
            onRequestClose={() => setOpenSavedRecipe(null)}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setOpenSavedRecipe(null)}
              style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}
            >
              <TouchableOpacity
                activeOpacity={1}
                onPress={() => { /* swallow */ }}
                style={{ backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "85%" }}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", paddingTop: 20, paddingHorizontal: 20, paddingBottom: 6 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.pageTitle, { fontSize: 18, paddingHorizontal: 0, paddingTop: 0 }]}>
                      {openSavedRecipe?.name || "Saved recipe"}
                    </Text>
                    {openSavedRecipe && (
                      <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 4 }}>
                        {[openSavedRecipe.time, openSavedRecipe.difficulty].filter(Boolean).join(" · ")}
                      </Text>
                    )}
                  </View>
                  {/* v1.22 #240 — Share button on the saved-recipe sheet.
                      shareRecipe helper picks URL-share (bank-backed recipes
                      with source_recipe_id or a slug-shaped id) vs text-share
                      (Haiku-generated ephemeral saves that have no public
                      URL). Previously this was hidden whenever the id wasn't
                      a bank slug — meant users could never share a saved AI
                      recipe. */}
                  {openSavedRecipe && (
                    <TouchableOpacity
                      onPress={async () => {
                        try {
                          const result = await shareRecipe(openSavedRecipe, {
                            sourceRecipeId: openSavedRecipe.source_recipe_id,
                          });
                          if (result?.action === Share.sharedAction) {
                            track("recipe_shared", {
                              name: openSavedRecipe.name,
                              recipe_id: openSavedRecipe.source_recipe_id || openSavedRecipe.id || null,
                              source: "saved_sheet",
                              has_url: !!(openSavedRecipe.source_recipe_id || isShareableRecipeId(openSavedRecipe.id)),
                            });
                          }
                        } catch (e) {
                          console.warn("share saved recipe:", e?.message);
                        }
                      }}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      accessibilityLabel="Share recipe"
                      style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: T.bg, alignItems: "center", justifyContent: "center", marginLeft: 12 }}
                    >
                      <Ionicons name="share-outline" size={20} color={T.text} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => setOpenSavedRecipe(null)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityLabel="Close recipe"
                    style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: T.bg, alignItems: "center", justifyContent: "center", marginLeft: 8 }}
                  >
                    <Ionicons name="close" size={20} color={T.text} />
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                  <View style={{ height: 8 }} />
                  {openSavedRecipe && (
                    <View style={[s.card, { padding: 14, marginBottom: 10 }]}>
                      <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
                        <Text style={{ fontSize: 28 }}>{openSavedRecipe.emoji || "🍽️"}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.bold, { fontSize: 16 }]}>{openSavedRecipe.name}</Text>
                          {!!(openSavedRecipe.uses_items?.length) && (
                            <Text style={{ color: T.accent, fontSize: 12, marginTop: 4 }}>
                              Uses: {openSavedRecipe.uses_items.slice(0, 6).join(", ")}
                            </Text>
                          )}
                        </View>
                      </View>
                      {openSavedRecipe.description && (
                        <Text style={{ color: T.textSoft, fontSize: 13, lineHeight: 19, marginBottom: 10 }}>{openSavedRecipe.description}</Text>
                      )}
                      {Array.isArray(openSavedRecipe.ingredients) && openSavedRecipe.ingredients.length > 0 && (
                        <View style={{ marginBottom: 10 }}>
                          <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 4, paddingHorizontal: 0, fontSize: 10 }]}>INGREDIENTS</Text>
                          {openSavedRecipe.ingredients.map((ing, j) => (
                            <Text key={j} style={{ color: T.text, fontSize: 13, lineHeight: 20 }}>
                              • {typeof ing === "object" ? ing.item : ing}{ing?.amount ? ` — ${ing.amount}` : ""}
                            </Text>
                          ))}
                        </View>
                      )}
                      {Array.isArray(openSavedRecipe.instructions) && openSavedRecipe.instructions.length > 0 && (
                        <View style={{ marginBottom: 10 }}>
                          <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 4, paddingHorizontal: 0, fontSize: 10 }]}>INSTRUCTIONS</Text>
                          {openSavedRecipe.instructions.map((step, j) => (
                            <Text key={j} style={{ color: T.text, fontSize: 13, lineHeight: 20 }}>{j + 1}. {step}</Text>
                          ))}
                        </View>
                      )}
                      {openSavedRecipe.tip && (
                        <Text style={{ color: T.accent, fontSize: 12, marginTop: 4, fontStyle: "italic" }}>💡 {openSavedRecipe.tip}</Text>
                      )}
                    </View>
                  )}
                  <TouchableOpacity
                    onPress={() => setOpenSavedRecipe(null)}
                    style={[s.btnPrimary, { marginTop: 4, marginBottom: 16 }]}
                  >
                    <Text style={s.btnPrimaryText}>Close</Text>
                  </TouchableOpacity>
                </ScrollView>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
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
            {/* v1.21 #215 — Share button next to the list name. Solid-green
                pill (matches the web Plan tab styling) so it reads as the
                primary action on this row vs. the lower-weight text links
                on the right. Mirrors web Plan.jsx layout per Greg's spec. */}
            {activeList && (
              <TouchableOpacity
                onPress={shareActiveList}
                style={{ backgroundColor: T.accent, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 4 }}
                accessibilityLabel="Share this shopping list"
              >
                <Ionicons name="share-outline" size={12} color="#FFFFFF" />
                <Text style={{ fontSize: 11, color: "#FFFFFF", fontWeight: "700" }}>Share</Text>
              </TouchableOpacity>
            )}
            {list.some(i => i.checked) && (
              <TouchableOpacity onPress={clearChecked}>
                <Text style={{ fontSize: 12, color: T.accent, fontWeight: "600" }}>Clear checked</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => { setNewListName(""); setShowCreateList(true); }}>
              <Text style={{ fontSize: 12, color: T.accent, fontWeight: "600" }}>+ New list</Text>
            </TouchableOpacity>
          </View>

          {/* v1.21 #215 — toast for share status (link copied / shared /
              error). 2.5s auto-dismiss. Floats above the list with a
              fade-friendly absolute-y so it doesn't push content. */}
          {shareToast && (
            <View style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: T.text, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 }}>
              <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "600", textAlign: "center" }}>{shareToast}</Text>
            </View>
          )}

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
        {/* v1.15 — KeyboardAvoidingView so the autofocus keyboard doesn't
            cover the Create-list button. Same pattern as UseItemModal. */}
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
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
        </KeyboardAvoidingView>
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
    if (visible) {
      setPage(0);
      // v1.15 — tour_started gives us the denominator for tour_completed.
      // Previously we only knew completion count (1/30d); now we'll know how
      // many people actually saw the tour modal at all.
      track("tour_started");
    }
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
    // v1.15 — split signal: completed=true means the user reached the last
    // card and tapped "Get started"; completed=false means they hit Skip
    // earlier. last_page tells us where they bailed when they did.
    track("tour_completed", {
      last_page: page,
      completed: page === cards.length - 1,
    });
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
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg, paddingTop: ANDROID_TOP_INSET }}>
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
  // v1.15 — preset mode for BulkAddModal so the empty-state Fridge CTAs can
  // open the modal directly into a populated state. Values:
  //   "scan-camera"  → modal mounts and immediately fires the camera
  //   "scan-library" → modal mounts and immediately opens the library picker
  //   "sample"       → modal mounts pre-filled with a realistic grocery list
  //   null           → normal manual-entry mode
  // Set by FridgeScreen empty-state CTAs (and the Add modal's scan tile).
  // Cleared via onPresetConsumed once the modal handles it, so reopening
  // doesn't re-trigger.
  const [bulkAddPresetMode, setBulkAddPresetMode] = useState(null);
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

  // v1.18 — deep-linked recipe state. Set by the Universal Link handler
  // when a /recipes/:id URL arrives. The fetch effect below pulls the
  // recipe object from daily_recipe_cache and stashes it in
  // `deepLinkRecipe` (or `deepLinkRecipeError` if not found / RLS denied).
  // The top-level modal renders whenever `deepLinkRecipe` is non-null.
  const [pendingRecipeId, setPendingRecipeId] = useState(null);
  const [deepLinkRecipe, setDeepLinkRecipe] = useState(null);
  const [deepLinkRecipeError, setDeepLinkRecipeError] = useState(null);
  const [deepLinkRecipeLoading, setDeepLinkRecipeLoading] = useState(false);
  // v1.18 — heart-toggle state for the deep-link recipe sheet. We refresh
  // savedId whenever a new recipe is opened so the icon reflects the
  // user_recipes_saved row id (or null when unsaved).
  const [deepLinkRecipeSavedId, setDeepLinkRecipeSavedId] = useState(null);
  const [deepLinkRecipeSaving, setDeepLinkRecipeSaving] = useState(false);

  // v1.19 — InventoryMatchSheet state. Opens when the user taps "Make this"
  // on a recipe. Calls match-recipe-inventory (Claude-judged), shows a
  // confirmation sheet with matched + missing ingredients, lets the user
  // toggle rows, picks a target shopping list, and bulk-inserts missing
  // items on confirm. See §3d–§3e of docs/v1_19_recipe_browser_spec.md.
  const [matchSheetRecipe, setMatchSheetRecipe] = useState(null);          // { id, name, ... }
  const [matchSheetResult, setMatchSheetResult] = useState(null);          // server response
  const [matchSheetLoading, setMatchSheetLoading] = useState(false);
  const [matchSheetError, setMatchSheetError] = useState(null);
  // Per-row checkbox state. Keys: `matched-{i}` (default true, uncheck if user
  // says "I actually don't have it" → moves to missing), `missing-{i}` (default
  // true, uncheck to skip adding that item to the list).
  const [matchSheetToggles, setMatchSheetToggles] = useState({});
  // Target shopping list. Default to most-recent-active list; user can pick a
  // different one OR create a new one named after the recipe.
  const [matchSheetTargetListId, setMatchSheetTargetListId] = useState(null);
  const [matchSheetUserLists, setMatchSheetUserLists] = useState([]);      // [{id, name}, ...]
  const [matchSheetAdding, setMatchSheetAdding] = useState(false);
  // v1.19 UX pass 4 — editable new-list name. When the user picks "+ New"
  // we pre-fill this with the recipe name and show an inline TextInput so
  // they can rename before committing. Used only when matchSheetTargetListId
  // is null (= "create new list").
  const [matchSheetNewListName, setMatchSheetNewListName] = useState("");
  // v1.19 — bump to trigger PlanScreen's loadLists/loadSavedRecipes refetch
  // after App-level mutations (creating a new shopping list, saving a
  // recipe, etc.). Increment-only; PlanScreen useEffect deps on this.
  const [planListsRefreshKey, setPlanListsRefreshKey] = useState(0);
  // v1.19 — when set to a non-null value, tells PlanScreen to switch its
  // active list view to that id (used after the recipe → new-list flow
  // so the user lands on the list they just created with their items).
  const [planTargetListId, setPlanTargetListId] = useState(null);
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

  // v1.17 — combined deep-link + Universal Link handler.
  //
  // What it does:
  //   1. Parses the URL path and routes to the right v1.16 tab (or modal).
  //   2. Keeps the v1.15 UTM telemetry (digest_email_opened, link_followed).
  //   3. Fires a new `deep_link_opened` event for every routed URL so we can
  //      measure routing usage independent of UTM presence.
  //
  // Supported URL shapes (handle both Universal Links and ok2eat:// scheme):
  //   https://app.ok2eat.com/fridge        → Fridge tab
  //   https://app.ok2eat.com/eat-me-first  → Eat Me First tab (v1.16 headline)
  //   https://app.ok2eat.com/plan          → Plan tab
  //   https://app.ok2eat.com/dashboard     → Dashboard tab
  //   https://app.ok2eat.com/settings      → Settings tab
  //   https://app.ok2eat.com/scan          → Scan camera flow
  //   https://app.ok2eat.com/add           → Add-item modal
  //   https://app.ok2eat.com/alerts        → Eat Me First (v1.15 back-compat)
  //   https://app.ok2eat.com/how-to        → Settings (v1.15 back-compat)
  //   https://ok2eat.com/open              → no-op (existing digest button)
  //   ok2eat://settings, ok2eat://profile/edit, etc. — same path map
  //
  // AASA file lives at https://app.ok2eat.com/.well-known/apple-app-site-association
  // (served from web/public/.well-known/). The marketing site's AASA at
  // ok2eat.com still claims only /open* — by design, so marketing-site links
  // don't accidentally hijack browser navigation.
  useEffect(() => {
    const PATH_TO_TAB = {
      "/fridge":       "fridge",
      "/eat-me-first": "eatMeFirst",
      "/eat-first":    "eatMeFirst",
      "/plan":         "plan",
      "/dashboard":    "dashboard",
      "/settings":     "settings",
      "/profile":      "settings",       // ok2eat://profile/edit lands here
      "/profile/edit": "settings",
      "/scan":         "scan",
      "/alerts":       "eatMeFirst",     // v1.15 back-compat
      "/how-to":       "settings",       // v1.15 back-compat
    };

    const handleUrl = (url) => {
      if (!url || typeof url !== "string") return;
      try {
        // Parse the path. Two URL flavors to handle:
        //   1. Universal Links: https://[app.]ok2eat.com/<path>?utm…
        //   2. Custom scheme:    ok2eat://<path>
        //
        // For the custom scheme, everything after "ok2eat://" is treated as
        // path — there's no real "host" concept since we don't need to
        // distinguish ok2eat://settings from ok2eat://app/settings. Both
        // map cleanly to the path map.
        let path = "/";
        if (url.startsWith("ok2eat://")) {
          let rest = url.slice("ok2eat://".length).split(/[?#]/)[0];
          path = "/" + rest.replace(/^\/+/, "");
        } else {
          const m = url.match(/^https?:\/\/[^/]+(\/[^?#]*)?/);
          if (m && m[1]) path = m[1];
        }
        // Strip trailing slash (but keep "/" as-is)
        if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

        // Route. Anything not in the map (incl. /open and /) is a no-op —
        // just opening the app is enough.
        const tab = PATH_TO_TAB[path];
        if (tab) {
          setTab(tab);
        } else if (path === "/add" || path === "/add-item") {
          setShowAdd(true);
        } else if (path.startsWith("/recipes/")) {
          // v1.18 — /recipes/{cache_id} surfaces the daily-recipe-cache row
          // for the tapped recipe (the morning email's "Open in ok2eat →"
          // links land here). The fetch effect below pulls the recipe and
          // pops the top-level deep-link recipe modal. Land them on Eat Me
          // First so the tab context behind the modal makes sense if they
          // dismiss it.
          const recipeId = decodeURIComponent(path.slice("/recipes/".length));
          if (recipeId && recipeId.length > 0 && recipeId.length < 100) {
            setTab("eatMeFirst");
            setPendingRecipeId(recipeId);
          }
        }

        // UTM telemetry — kept identical to v1.15 behaviour.
        const qIdx = url.indexOf("?");
        if (qIdx >= 0) {
          const params = {};
          for (const part of url.slice(qIdx + 1).split("&")) {
            const [k, v] = part.split("=").map(decodeURIComponent);
            if (k) params[k] = v ?? "";
          }
          if (params.utm_source === "email_digest") {
            track("digest_email_opened", {
              campaign: params.utm_campaign || "daily_digest",
              medium: params.utm_medium || "email",
            });
          }
          if (params.utm_source) {
            track("link_followed", {
              source: params.utm_source,
              medium: params.utm_medium || "",
              campaign: params.utm_campaign || "",
              path,
            });
          }
        }

        // v1.17 — always fire deep_link_opened so routing usage shows up in
        // PostHog whether or not the link carried UTM params.
        track("deep_link_opened", {
          path,
          scheme: url.startsWith("ok2eat://") ? "custom" : "universal",
          routed_to: tab || (path === "/add" || path === "/add-item" ? "add_modal" : null),
        });
      } catch (e) { /* analytics never crashes the app */ }
    };

    Linking.getInitialURL().then(handleUrl).catch(() => { /* noop */ });
    const sub = Linking.addEventListener("url", (event) => handleUrl(event?.url));
    return () => sub.remove();
  }, []);

  // v1.18 — fetch the deep-linked recipe from daily_recipe_cache.
  //
  // The cache row primary key is (user_id, for_date), and each row contains
  // a recipes JSONB array of up to 3 entries with stable ids. The recipe id
  // is shaped "YYYYMMDD-{userid12}-{position}" — we extract the for_date
  // and position from the id, query the row, and pluck the matching entry.
  //
  // RLS protects against cross-user reads, so even if a link is shared,
  // only the original recipient sees the recipe content. A non-owner just
  // sees deepLinkRecipeError set and a friendly "couldn't load" message.
  useEffect(() => {
    if (!pendingRecipeId) return;
    if (!user) {
      // Not signed in yet — wait for auth to resolve, then retry by leaving
      // pendingRecipeId set. Auth listener above triggers a re-render once
      // user is populated.
      return;
    }
    let cancelled = false;
    const idToFetch = pendingRecipeId;

    (async () => {
      setDeepLinkRecipeLoading(true);
      setDeepLinkRecipeError(null);
      setDeepLinkRecipe(null);
      try {
        // Two id shapes:
        //   - Daily-cache: "YYYYMMDD-{userid12}-{position}" — generated server-side
        //     by the morning digest; per-user, expires when the cache rolls.
        //   - Bank slug:   "chicken-parmesan" etc. — v1.19 recipe_bank rows. Public-
        //     read, persistent. Universal Link to ok2eat.com/recipes/<slug>.
        //
        // We detect by trying the date-prefixed shape first; anything that doesn't
        // match falls through to a bank-slug lookup.
        let recipe = null;
        let source = null;          // "daily_cache" | "bank" — for analytics
        let forDateForAnalytics = null;
        let positionForAnalytics = null;

        const dateMatch = idToFetch.match(/^(\d{8})-([a-f0-9]{12})-(\d+)$/i);
        if (dateMatch) {
          // Daily-cache shape. Parse + verify position bounds.
          const dateRaw = dateMatch[1];
          const position = parseInt(dateMatch[3], 10);
          if (!Number.isFinite(position) || position < 0 || position > 9) {
            throw new Error("Invalid recipe link.");
          }
          const forDate = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;

          const { data, error } = await supabase
            .from("daily_recipe_cache")
            .select("recipes")
            .eq("user_id", user.id)
            .eq("for_date", forDate)
            .maybeSingle();

          if (cancelled) return;
          if (error) throw error;
          if (!data || !Array.isArray(data.recipes)) {
            throw new Error("This recipe isn't available anymore.");
          }
          const hit = data.recipes[position];
          if (!hit) {
            throw new Error("This recipe isn't available anymore.");
          }
          recipe = hit;
          source = "daily_cache";
          forDateForAnalytics = forDate;
          positionForAnalytics = position;
        } else {
          // Bank-slug shape. recipe_bank RLS is public-read so any signed-in
          // user can fetch any slug. We normalize to the same DailyRecipe-ish
          // shape the modal expects: { id, name, emoji, time, difficulty,
          // description, ingredients, instructions, tip, uses_items }.
          const { data, error } = await supabase
            .from("recipe_bank")
            .select("slug, name, emoji, time_minutes, difficulty, description, ingredients, instructions, tip, meal_type, cuisine, dietary_tags")
            .eq("slug", idToFetch)
            .maybeSingle();

          if (cancelled) return;
          if (error) throw error;
          if (!data) {
            throw new Error("This recipe isn't available anymore.");
          }
          recipe = {
            id: data.slug,
            name: data.name,
            emoji: data.emoji || "🍳",
            time: data.time_minutes != null ? `${data.time_minutes} min` : "",
            difficulty: data.difficulty || "",
            description: data.description || "",
            ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
            instructions: Array.isArray(data.instructions) ? data.instructions : [],
            tip: data.tip || "",
            uses_items: [],                 // bank rows aren't tied to a fridge; populated by match flow when present
            meal_type: data.meal_type,
            cuisine: data.cuisine,
            dietary_tags: data.dietary_tags || [],
          };
          source = "bank";
        }

        setDeepLinkRecipe(recipe);
        track("deep_link_recipe_opened", {
          recipe_id: idToFetch,
          source,
          for_date: forDateForAnalytics,
          position: positionForAnalytics,
        });

        // v1.18 — check whether this recipe is already saved so the
        // heart icon reflects state correctly when the modal opens.
        // Cheap query: scoped to this user + this recipe name. Profile
        // match by lowered name (mirror of the SQL expression index).
        try {
          const { data: existing } = await supabase
            .from("user_recipes_saved")
            .select("id")
            .eq("user_id", user.id)
            .filter("recipe_data->>name", "ilike", recipe.name)
            .maybeSingle();
          if (!cancelled) setDeepLinkRecipeSavedId(existing?.id || null);
        } catch (e) {
          // Non-fatal — heart just defaults to "not saved".
          if (!cancelled) setDeepLinkRecipeSavedId(null);
        }
      } catch (e) {
        if (cancelled) return;
        setDeepLinkRecipeError(e?.message || "Couldn't load that recipe.");
        track("deep_link_recipe_failed", {
          recipe_id: idToFetch,
          reason: String(e?.message || e).slice(0, 100),
        });
      } finally {
        if (!cancelled) {
          setDeepLinkRecipeLoading(false);
          setPendingRecipeId(null);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [pendingRecipeId, user]);

  // v1.19 — auto-fire the match-recipe-inventory call whenever the recipe
  // sheet shows a recipe with ingredients. Renders match status inline in
  // the ingredient list (✓ have / + add). Clearing the sheet clears the
  // match state too.
  useEffect(() => {
    if (deepLinkRecipe && Array.isArray(deepLinkRecipe.ingredients) && deepLinkRecipe.ingredients.length > 0) {
      openMatchSheet(deepLinkRecipe);
    } else {
      // Sheet closed or no ingredients — wipe state so a re-open is fresh.
      setMatchSheetRecipe(null);
      setMatchSheetResult(null);
      setMatchSheetToggles({});
      setMatchSheetError(null);
    }
    // eslint-disable-next-line
  }, [deepLinkRecipe]);

  // v1.19 — InventoryMatchSheet helpers. openMatchSheet kicks off the
  // match-recipe-inventory call + loads the user's shopping lists for the
  // target picker. addMissingToList commits the user's selections into
  // shopping_list_items.

  async function openMatchSheet(recipe) {
    if (!recipe || !recipe.id) return;
    setMatchSheetRecipe(recipe);
    setMatchSheetResult(null);
    setMatchSheetError(null);
    setMatchSheetToggles({});
    setMatchSheetTargetListId(null);
    // Default the new-list name to the recipe name. User can edit before
    // tapping Add. If they pick an existing list (sets targetListId !== null),
    // this state is ignored.
    setMatchSheetNewListName(recipe.name || "");
    setMatchSheetLoading(true);
    track("recipe_make_tapped", { recipe_id: recipe.id, name: recipe.name });

    // Kick off both in parallel: lists (for the picker) + match (for the rows).
    (async () => {
      try {
        const { data, error } = await supabase
          .from("shopping_lists")
          .select("id, name")
          .eq("household_id", householdId)
          .is("archived_at", null)
          .order("created_at", { ascending: false });
        if (error) throw error;
        const lists = data || [];
        setMatchSheetUserLists(lists);
        // Default the target to the newest active list (matches the user's
        // last-modified mental model). If they have none, picker stays empty
        // and the "Add" button will use the "+ New list" affordance.
        if (lists.length > 0) setMatchSheetTargetListId(lists[0].id);
      } catch (e) {
        console.warn("[match] list load failed:", e?.message || e);
        setMatchSheetUserLists([]);
      }
    })();

    try {
      const { data, error } = await supabase.functions.invoke("match-recipe-inventory", {
        body: { recipe_id: recipe.id },
      });
      if (error) throw error;
      setMatchSheetResult(data);
      // Default toggles: matched rows checked (user "has" them — uncheck to
      // flip to "actually I don't have it"). Missing rows DEFAULT UNCHECKED —
      // user explicitly opts each one in via tap, or hits "Add all" to bulk
      // queue them. Positive-action default keeps the user in the driver's
      // seat rather than auto-loading their cart.
      const toggles = {};
      (data?.matched || []).forEach((_, i) => { toggles[`matched-${i}`] = true; });
      // Intentionally NOT pre-checking missing rows.
      setMatchSheetToggles(toggles);
      track("inventory_match_result", {
        recipe_id: recipe.id,
        matched_count: data?.matched?.length || 0,
        missing_count: data?.missing?.length || 0,
        cached: !!data?.cached,
      });
    } catch (e) {
      setMatchSheetError(e?.message || "Couldn't run the match. Try again in a moment.");
    } finally {
      setMatchSheetLoading(false);
    }
  }

  async function addMissingToList() {
    if (!matchSheetResult || !matchSheetRecipe) return;
    setMatchSheetAdding(true);
    try {
      // Determine target list — either the user's pick, or freshly created.
      let listId = matchSheetTargetListId;
      const { data: { user: u } } = await supabase.auth.getUser();
      let createdNewList = false;
      if (!listId) {
        // Create a new list using the (possibly user-edited) name. Trim
        // and fall back if blank.
        const newName = (matchSheetNewListName || matchSheetRecipe.name || "Shopping list").trim() || "Shopping list";
        const { data: newList, error: createErr } = await supabase
          .from("shopping_lists")
          .insert({ household_id: householdId, name: newName, created_by: u?.id || null })
          .select("id")
          .single();
        if (createErr) throw createErr;
        listId = newList.id;
        createdNewList = true;
      }

      // Build the items to add: checked missing rows + UNchecked matched rows
      // (an unchecked match means the user said "I actually don't have it").
      const itemsToAdd = [];
      (matchSheetResult.missing || []).forEach((m, i) => {
        if (matchSheetToggles[`missing-${i}`]) {
          itemsToAdd.push({ name: m.ingredient });
        }
      });
      (matchSheetResult.matched || []).forEach((m, i) => {
        if (!matchSheetToggles[`matched-${i}`]) {
          itemsToAdd.push({ name: m.ingredient });
        }
      });

      if (itemsToAdd.length === 0) {
        Alert.alert("Nothing to add", "Check at least one item to add to your shopping list.");
        return;
      }

      const rows = itemsToAdd.map(it => ({
        household_id: householdId,
        list_id: listId,
        name: it.name,
        created_by: u?.id || null,
      }));
      const { error: insertErr } = await supabase.from("shopping_list_items").insert(rows);
      if (insertErr) throw insertErr;

      track("shopping_list_generated", {
        recipe_id: matchSheetRecipe.id,
        target_list_id: listId,
        item_count: rows.length,
        had_target_list: !!matchSheetTargetListId,
      });

      // Bump the refresh key so PlanScreen reloads its shopping_lists
      // (otherwise a newly created list won't show up in the picker).
      setPlanListsRefreshKey(k => k + 1);

      // Navigate PlanScreen to the target list so the user sees the items
      // they just added. Critical UX: without this, single-list users would
      // stay on their previous list view and not see the new one with the
      // ingredients they just queued — leading to "list not created" confusion.
      setPlanTargetListId(listId);

      // Close the recipe sheet and toast.
      const targetName =
        (matchSheetUserLists.find(l => l.id === listId) || {}).name ||
        (createdNewList ? (matchSheetNewListName || matchSheetRecipe.name || "new list").trim() : "your list");
      setDeepLinkRecipe(null);
      setDeepLinkRecipeError(null);
      setDeepLinkRecipeSavedId(null);
      showToast(`✓ Added ${rows.length} ${rows.length === 1 ? "item" : "items"} to ${targetName}`);
    } catch (e) {
      console.warn("[match] add failed:", e?.message || e);
      Alert.alert("Couldn't add items", e?.message || "Try again in a moment.");
    } finally {
      setMatchSheetAdding(false);
    }
  }

  // Check for App Store update once per session, deferred slightly so it
  // doesn't compete with auth/load on cold start. Soft prompt: user can
  // dismiss and we re-check on the next launch.
  //
  // v1.22 #241 — Three guards against the repeated-popup bug Greg hit:
  //   1. __DEV__ skip — dev clients always run an old "Expo Go-like" version
  //      string, so the prompt nags every Metro reload.
  //   2. Session-scoped flag (`updatePromptCheckedRef`) — Fast Refresh /
  //      auth state changes don't trigger a re-mount of <App/>, but if the
  //      effect ever does re-run it shouldn't re-fire the modal.
  //   3. AsyncStorage `app_update_dismissed_version` — once the user taps
  //      "Maybe later" we remember the version they dismissed and suppress
  //      until a NEWER one ships. They still get prompted for the next
  //      release.
  useEffect(() => {
    if (__DEV__) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const dismissed = await AsyncStorage.getItem("app_update_dismissed_version");
        if (cancelled) return;
        const resp = await fetch(ITUNES_LOOKUP_URL);
        const data = await resp.json();
        if (cancelled) return;
        if (!data?.results?.length) return;
        const latest = data.results[0].version;
        // Skip if local already >= remote.
        if (compareVersions(APP_VERSION, latest) >= 0) return;
        // Skip if the user already dismissed THIS latest version.
        if (dismissed && compareVersions(dismissed, latest) >= 0) return;
        setUpdateInfo({
          current: APP_VERSION,
          latest,
          url: data.results[0].trackViewUrl || APP_STORE_URL,
        });
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
        // v1.14 — once iOS denies, requestPermissionsAsync() can't re-prompt.
        // Deep-link to Settings so the user has a one-tap path to fix it.
        Alert.alert(
          "Permission Required",
          "Please enable notifications for ok2eat in Settings to use this feature.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ]
        );
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
      const nextItems = [rowToItem(saved), ...items];
      setItems(nextItems);
      showToast(`✅ ${data.name} added!`);
      track("item_added_manual", { category: data.category });
      // v1.15 — D1 retention nudge after add. No-ops if already scheduled
      // today or if notif permission not granted.
      scheduleD1RetentionNudge(nextItems, { trackFn: track, daysUntilFn: daysUntil });
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
      const nextItems = [...saved, ...items];
      setItems(nextItems);
      track("item_added_bulk", { count: saved.length, failed });
      // v1.15 — D1 retention nudge after bulk add. Same idempotency guard
      // as handleAddManual; the lower of (this call, manual call today)
      // wins per AsyncStorage flag.
      scheduleD1RetentionNudge(nextItems, { trackFn: track, daysUntilFn: daysUntil });
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

  // v1.16 nav consolidation: Fridge / Eat Me First / Plan / Dashboard /
  // Settings. Reminders' urgency lists became the Eat Me First tab; its
  // profile + digest toggles moved into Settings. How-to retired — the
  // v1.15 first-run tour covers it. Share + Logout moved off the app-bar
  // into Settings → Household + Account sections.
  const navItems = [
    { id: "fridge",      label: "Fridge" },
    { id: "eatMeFirst",  label: "Eat First" },
    { id: "plan",        label: "Plan" },
    { id: "dashboard",   label: "Dashboard" },
    { id: "settings",    label: "Settings" },
  ];

  return (
    // v1.0.10 — root is a plain View now, with the SafeAreaView nested
    // *inside* it. The navBar (below) is rendered as a sibling of
    // SafeAreaView, so it extends past the home-indicator inset and sits
    // flush with the bottom of the screen, Messages-app style. The nav's
    // own paddingBottom keeps labels above the actual home indicator.
    <View style={s.root}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF", paddingTop: ANDROID_TOP_INSET, paddingBottom: 0 }}>
      <StatusBar barStyle="dark-content" backgroundColor={T.bg} translucent={false} />
      <View style={s.appBar}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={s.appLogo}><Text style={{ fontSize: 14 }}>🧊</Text></View>
          <Text style={s.appName}>ok2eat</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {/* v1.16 — Share + Logout moved into the Settings tab (Household +
              Account sections). The app-bar now stays clean for the brand
              mark only, which keeps the 5-tab nav from feeling crowded. */}
        </View>
      </View>
      <View style={{ flex: 1 }}>
        {tab === "fridge" && <FridgeScreen
          items={items}
          onDelete={handleDelete}
          onBulkDelete={handleBulkDelete}
          onAdd={(section) => { setAddSection(section || "fridge"); setShowAdd(true); }}
          onUpdate={handleUpdate}
          onUse={handleUse}
          loading={loading}
          householdName={householdName}
          onOpenManageInventory={() => setShowManageInventory(true)}
          // v1.15 — empty-state CTAs that open the BulkAddModal in a preset
          // mode. "scan" jumps straight into the camera so receipt-scan is a
          // single tap from the empty fridge (vs. AddModal → scan-tile, the
          // current 2-tap path that's seeing 4% adoption per PostHog).
          // "sample" loads a realistic populated state so the user sees the
          // value of receipt scan before ever needing a real receipt.
          // v1.21 — accepts "camera" | "library" so the empty-state CTA on
          // FridgeScreen can match the AddModal chooser's UX. Defaults to
          // camera when no source is provided (legacy callers).
          onScanReceipt={(src) => { setBulkAddPresetMode(src === "library" ? "scan-library" : "scan-camera"); setShowBulkAdd(true); }}
          onTrySample={() => { track("sample_receipt_tapped"); setBulkAddPresetMode("sample"); setShowBulkAdd(true); }}
        />}
        {tab === "scan" && <ScanScreen onScanned={handleScanned} />}
        {tab === "plan" && (
          <PlanScreen
            items={items}
            householdId={householdId}
            onOpenRecipeId={setPendingRecipeId}
            onOpenSavedRecipe={(recipeData, savedId) => {
              setDeepLinkRecipe(recipeData);
              setDeepLinkRecipeSavedId(savedId);
            }}
            listsRefreshKey={planListsRefreshKey}
            targetListId={planTargetListId}
            onTargetListConsumed={() => setPlanTargetListId(null)}
          />
        )}
        {/* v1.16 Tier 3 — new headline tabs. */}
        {tab === "eatMeFirst" && <EatMeFirstScreen items={items} householdId={householdId} />}
        {tab === "dashboard"  && <DashboardScreen  items={items} onNavigateToEatMeFirst={() => setTab("eatMeFirst")} />}
        {tab === "settings"   && (
          <SettingsScreen
            notificationsEnabled={notificationsEnabled}
            onToggleNotifications={toggleNotifications}
            emailDigestEnabled={emailDigestEnabled}
            onToggleEmailDigest={toggleEmailDigest}
            onOpenShare={() => setTab("share")}
            userEmail={user?.email}
          />
        )}
        {/* v1.15 → v1.16 back-compat: anyone still on the old tab IDs
            (e.g. coming back from a deep-link or AsyncStorage value)
            falls through to the new home. */}
        {tab === "reminders" && <EatMeFirstScreen items={items} />}
        {tab === "howto"     && <SettingsScreen
          notificationsEnabled={notificationsEnabled}
          onToggleNotifications={toggleNotifications}
          emailDigestEnabled={emailDigestEnabled}
          onToggleEmailDigest={toggleEmailDigest}
          onOpenShare={() => setTab("share")}
          userEmail={user?.email}
        />}
        {tab === "share" && <ShareScreen householdName={householdName} memberCount={memberCount} onOpenInvite={() => setShowInvite(true)} onBack={() => setTab("settings")} />}
      </View>
      {toast !== "" && <Animated.View style={[s.toast, { opacity: toastOpacity }]}><Text style={s.toastText}>{toast}</Text></Animated.View>}
      <AddModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onAdd={handleAddManual}
        onGoToScan={() => { setShowAdd(false); setTab("scan"); }}
        // v1.16 fix — was missing setBulkAddPresetMode("scan-camera"), so the
        // AddModal "Scan Receipt" tile opened BulkAddModal in manual mode
        // (3 empty rows) instead of auto-launching the camera. The empty-state
        // CTA at line 5411 was correctly wired; only this path regressed.
        // v1.21 — accepts "camera" | "library" from the AddModal chooser.
        onScanReceipt={(src) => { setShowAdd(false); setBulkAddPresetMode(src === "library" ? "scan-library" : "scan-camera"); setShowBulkAdd(true); }}
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

      {/* v1.18 — deep-linked recipe sheet. Opens when a user taps an
          "Open in ok2eat →" link from the daily digest email. Pulls the
          recipe from daily_recipe_cache (RLS-protected to their own row)
          and renders it in the same visual language as the in-app
          Eat Me First recipe modal. */}
      <Modal
        visible={!!deepLinkRecipe || deepLinkRecipeLoading || !!deepLinkRecipeError}
        transparent
        animationType="slide"
        onRequestClose={() => { setDeepLinkRecipe(null); setDeepLinkRecipeError(null); }}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => { setDeepLinkRecipe(null); setDeepLinkRecipeError(null); }}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => { /* swallow taps inside the sheet */ }}
            style={{ backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "85%" }}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", paddingTop: 20, paddingHorizontal: 20, paddingBottom: 6 }}>
              <View style={{ flex: 1 }}>
                <Text style={[s.pageTitle, { fontSize: 18, paddingHorizontal: 0, paddingTop: 0 }]}>
                  {deepLinkRecipe?.name || (deepLinkRecipeLoading ? "Loading recipe…" : "Recipe")}
                </Text>
                {deepLinkRecipe && (
                  <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 4 }}>
                    {[deepLinkRecipe.time, deepLinkRecipe.difficulty].filter(Boolean).join(" · ")}
                  </Text>
                )}
              </View>
              {/* v1.22 #240 — Share button. shareRecipe helper picks URL-share
                  vs text-share automatically. For saved ephemeral recipes
                  opened via this sheet (no source_recipe_id, uuid id), the
                  helper falls back to sharing the full recipe text. Bank
                  recipes get the public /recipes/{slug} Universal Link. */}
              {deepLinkRecipe && (
                <TouchableOpacity
                  onPress={async () => {
                    try {
                      const result = await shareRecipe(deepLinkRecipe, {
                        sourceRecipeId: deepLinkRecipe.source_recipe_id,
                      });
                      if (result?.action === Share.sharedAction) {
                        track("recipe_shared", {
                          name: deepLinkRecipe.name,
                          recipe_id: deepLinkRecipe.source_recipe_id || deepLinkRecipe.id || null,
                          source: "deep_link_sheet",
                          has_url: !!(deepLinkRecipe.source_recipe_id || isShareableRecipeId(deepLinkRecipe.id)),
                        });
                      }
                    } catch (e) {
                      console.warn("share recipe:", e?.message);
                    }
                  }}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityLabel="Share recipe"
                  style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: T.bg, alignItems: "center", justifyContent: "center", marginLeft: 12 }}
                >
                  <Ionicons name="share-outline" size={20} color={T.text} />
                </TouchableOpacity>
              )}
              {/* v1.18 — heart toggle. Hidden until the recipe loads. */}
              {deepLinkRecipe && (
                <TouchableOpacity
                  onPress={async () => {
                    if (deepLinkRecipeSaving || !user) return;
                    setDeepLinkRecipeSaving(true);
                    try {
                      if (deepLinkRecipeSavedId) {
                        // Unsave
                        await supabase
                          .from("user_recipes_saved")
                          .delete()
                          .eq("id", deepLinkRecipeSavedId);
                        setDeepLinkRecipeSavedId(null);
                        track("recipe_unsaved", { name: deepLinkRecipe.name });
                      } else {
                        // Save
                        const { data } = await supabase
                          .from("user_recipes_saved")
                          .insert({
                            user_id: user.id,
                            source_recipe_id: deepLinkRecipe.id || null,
                            recipe_data: deepLinkRecipe,
                          })
                          .select("id")
                          .single();
                        if (data?.id) setDeepLinkRecipeSavedId(data.id);
                        track("recipe_saved", { name: deepLinkRecipe.name, source: "deep_link" });
                      }
                    } catch (e) {
                      console.warn("toggle save recipe:", e?.message);
                    } finally {
                      setDeepLinkRecipeSaving(false);
                    }
                  }}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityLabel={deepLinkRecipeSavedId ? "Remove from saved" : "Save recipe"}
                  style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: T.bg, alignItems: "center", justifyContent: "center", marginLeft: 8 }}
                >
                  <Ionicons
                    name={deepLinkRecipeSavedId ? "heart" : "heart-outline"}
                    size={20}
                    color={deepLinkRecipeSavedId ? T.danger : T.text}
                  />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => { setDeepLinkRecipe(null); setDeepLinkRecipeError(null); setDeepLinkRecipeSavedId(null); }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel="Close recipe"
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: T.bg, alignItems: "center", justifyContent: "center", marginLeft: 8 }}
              >
                <Ionicons name="close" size={20} color={T.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
              <View style={{ height: 8 }} />

              {deepLinkRecipeLoading && (
                <View style={{ paddingVertical: 30, alignItems: "center" }}>
                  <ActivityIndicator color={T.accent} />
                  <Text style={{ color: T.textSoft, fontSize: 13, marginTop: 10 }}>Pulling today's recipe…</Text>
                </View>
              )}

              {deepLinkRecipeError && (
                <View style={{ backgroundColor: "rgba(220,38,38,0.08)", borderColor: "rgba(220,38,38,0.3)", borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <Text style={{ color: T.danger, fontSize: 13 }}>{deepLinkRecipeError}</Text>
                  <Text style={{ color: T.textSoft, fontSize: 12, marginTop: 6 }}>
                    The link is only valid for the day the email was sent. Open the Eat Me First tab to see today's suggestions.
                  </Text>
                </View>
              )}

              {deepLinkRecipe && (
                <View style={[s.card, { padding: 14, marginBottom: 10 }]}>
                  <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
                    <Text style={{ fontSize: 28 }}>{deepLinkRecipe.emoji || "🍽️"}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.bold, { fontSize: 16 }]}>{deepLinkRecipe.name}</Text>
                      {!!(deepLinkRecipe.uses_items?.length) && (
                        <Text style={{ color: T.accent, fontSize: 12, marginTop: 4 }}>
                          Uses: {deepLinkRecipe.uses_items.slice(0, 6).join(", ")}
                        </Text>
                      )}
                    </View>
                  </View>
                  {deepLinkRecipe.description && (
                    <Text style={{ color: T.textSoft, fontSize: 13, lineHeight: 19, marginBottom: 10 }}>
                      {deepLinkRecipe.description}
                    </Text>
                  )}
                  {Array.isArray(deepLinkRecipe.ingredients) && deepLinkRecipe.ingredients.length > 0 && (
                    <View style={{ marginBottom: 10 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                        <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 0, paddingHorizontal: 0, fontSize: 10, flex: 1 }]}>INGREDIENTS</Text>
                        {/* v1.19 — "Add all missing" bulk action. Only shown
                            when match has loaded and there's at least one
                            row still in the "skip" (default unchecked) state. */}
                        {(() => {
                          if (!matchSheetResult) return null;
                          const unqueued = (matchSheetResult.missing || []).filter((_, i) => !matchSheetToggles[`missing-${i}`]).length;
                          if (unqueued === 0) return null;
                          return (
                            <TouchableOpacity
                              onPress={() => setMatchSheetToggles(prev => {
                                const next = { ...prev };
                                (matchSheetResult.missing || []).forEach((_, i) => { next[`missing-${i}`] = true; });
                                return next;
                              })}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                              <Text style={{ fontSize: 11, fontWeight: "700", color: T.accent }}>
                                + ADD ALL {unqueued} MISSING
                              </Text>
                            </TouchableOpacity>
                          );
                        })()}
                      </View>
                      {/* v1.19 — inline match status. Each ingredient renders
                          in one of four states (computed below): "have" (in
                          fridge — green tinted card), "queued" (added to list
                          — green tinted card with + icon), "skip" (default for
                          missing — neutral, taps queue it), or "unknown"
                          (match still loading). */}
                      {(() => {
                        // Build a lookup: ingredient name (verbatim) → match info
                        const matchedByIng = new Map();
                        const missingByIng = new Map();
                        if (matchSheetResult) {
                          (matchSheetResult.matched || []).forEach((m, idx) => {
                            matchedByIng.set(m.ingredient, { idx, fridge_item: m.fridge_item });
                          });
                          (matchSheetResult.missing || []).forEach((m, idx) => {
                            missingByIng.set(m.ingredient, { idx });
                          });
                        }
                        return deepLinkRecipe.ingredients.map((ing, j) => {
                          const item = typeof ing === "object" ? ing.item : ing;
                          const amount = typeof ing === "object" ? ing.amount : "";
                          const matched = matchedByIng.get(item);
                          const missing = missingByIng.get(item);

                          // Display states (mutually exclusive):
                          //   "have"    — matched + check toggle ON. Green tinted card. "In stock in fridge".
                          //   "queued"  — missing + check toggle ON, OR matched + toggle OFF. Green tinted card with + icon. "Added to list".
                          //   "skip"    — missing + toggle OFF (default). Neutral row. "Tap to add to list".
                          //   "unknown" — match results not yet loaded (or this ingredient doesn't appear in match results).
                          let displayState = "unknown";
                          let rowKey = null;
                          if (matched) {
                            rowKey = `matched-${matched.idx}`;
                            const checked = !!matchSheetToggles[rowKey];
                            displayState = checked ? "have" : "queued";
                          } else if (missing) {
                            rowKey = `missing-${missing.idx}`;
                            const checked = !!matchSheetToggles[rowKey];
                            displayState = checked ? "queued" : "skip";
                          }

                          const onToggle = () => {
                            if (!rowKey) return;
                            setMatchSheetToggles(prev => ({ ...prev, [rowKey]: !prev[rowKey] }));
                          };

                          // Per-state styling
                          let iconName, iconColor, hintText, bgColor, hintColor;
                          if (displayState === "have") {
                            iconName = "checkmark-circle";
                            iconColor = T.accent;
                            bgColor = "rgba(22,163,74,0.08)";
                            hintColor = T.accent;
                            hintText = matched?.fridge_item ? `In stock — you have ${matched.fridge_item}` : "In stock in fridge";
                          } else if (displayState === "queued") {
                            iconName = "add-circle";
                            iconColor = T.accent;
                            bgColor = "rgba(22,163,74,0.08)";
                            hintColor = T.accent;
                            hintText = "Added to shopping list · tap to remove";
                          } else if (displayState === "skip") {
                            iconName = "add-circle-outline";
                            iconColor = T.muted;
                            bgColor = "transparent";
                            hintColor = T.textSoft;
                            hintText = "Tap to add to shopping list";
                          } else {
                            iconName = "ellipse-outline";
                            iconColor = T.muted;
                            bgColor = "transparent";
                            hintColor = T.textSoft;
                            hintText = matchSheetLoading ? "Checking your fridge…" : "";
                          }

                          return (
                            <TouchableOpacity
                              key={j}
                              onPress={onToggle}
                              disabled={!rowKey}
                              activeOpacity={rowKey ? 0.6 : 1}
                              style={{
                                flexDirection: "row", alignItems: "flex-start",
                                paddingVertical: 8, paddingHorizontal: 8,
                                marginBottom: 4, borderRadius: 8,
                                backgroundColor: bgColor,
                                gap: 8,
                              }}
                            >
                              <Ionicons name={iconName} size={20} color={iconColor} style={{ marginTop: 1 }} />
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: T.text, fontSize: 13, lineHeight: 18, fontWeight: displayState === "have" ? "600" : "400" }}>
                                  {item}{amount ? ` — ${amount}` : ""}
                                </Text>
                                {!!hintText && (
                                  <Text style={{ color: hintColor, fontSize: 11, marginTop: 2, fontWeight: displayState === "have" || displayState === "queued" ? "600" : "400" }} numberOfLines={1}>
                                    {hintText}
                                  </Text>
                                )}
                              </View>
                            </TouchableOpacity>
                          );
                        });
                      })()}
                    </View>
                  )}
                  {Array.isArray(deepLinkRecipe.instructions) && deepLinkRecipe.instructions.length > 0 && (
                    <View style={{ marginBottom: 10 }}>
                      <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 4, paddingHorizontal: 0, fontSize: 10 }]}>INSTRUCTIONS</Text>
                      {deepLinkRecipe.instructions.map((step, j) => (
                        <Text key={j} style={{ color: T.text, fontSize: 13, lineHeight: 20 }}>{j + 1}. {step}</Text>
                      ))}
                    </View>
                  )}
                  {deepLinkRecipe.tip && (
                    <Text style={{ color: T.accent, fontSize: 12, marginTop: 4, fontStyle: "italic" }}>💡 {deepLinkRecipe.tip}</Text>
                  )}
                </View>
              )}

              {/* v1.19 — Add-to-shopping-list CTA. Shows when there's at
                  least one ingredient queued for addition (either originally
                  missing + checked, or originally matched + UN-checked). The
                  user picks a target list with chips below. */}
              {(() => {
                if (!deepLinkRecipe || !matchSheetResult) return null;
                const willAdd =
                  (matchSheetResult.missing || []).filter((_, i) => matchSheetToggles[`missing-${i}`]).length +
                  (matchSheetResult.matched || []).filter((_, i) => !matchSheetToggles[`matched-${i}`]).length;
                if (willAdd === 0) return null;
                return (
                  <View style={{ marginTop: 6, marginBottom: 4 }}>
                    <Text style={[s.sectionLabel, { paddingHorizontal: 0, marginBottom: 6, fontSize: 10 }]}>
                      ADD TO LIST
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                      {matchSheetUserLists.map(l => {
                        const active = matchSheetTargetListId === l.id;
                        return (
                          <TouchableOpacity
                            key={l.id}
                            onPress={() => setMatchSheetTargetListId(l.id)}
                            style={{
                              paddingHorizontal: 11, paddingVertical: 6, borderRadius: 12,
                              borderWidth: 1, borderColor: active ? T.accent : "rgba(0,0,0,0.10)",
                              backgroundColor: active ? "rgba(22,163,74,0.10)" : "transparent",
                            }}
                          >
                            <Text style={{ fontSize: 12, fontWeight: "600", color: active ? T.accent : T.textSoft }}>
                              {l.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                      <TouchableOpacity
                        onPress={() => {
                          setMatchSheetTargetListId(null);
                          // Re-default the editable name in case user nuked it
                          if (!matchSheetNewListName) setMatchSheetNewListName(deepLinkRecipe.name || "");
                        }}
                        style={{
                          paddingHorizontal: 11, paddingVertical: 6, borderRadius: 12,
                          borderWidth: 1, borderColor: matchSheetTargetListId === null ? T.accent : "rgba(0,0,0,0.10)",
                          backgroundColor: matchSheetTargetListId === null ? "rgba(22,163,74,0.10)" : "transparent",
                          borderStyle: "dashed",
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "600", color: matchSheetTargetListId === null ? T.accent : T.textSoft }}>
                          + New list
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {/* When the user picks "+ New", reveal an editable name
                        field. Pre-filled with the recipe name; they can
                        rename before hitting Add. */}
                    {matchSheetTargetListId === null && (
                      <View style={{ marginBottom: 10 }}>
                        <Text style={{ fontSize: 11, color: T.textSoft, marginBottom: 4 }}>
                          Name this list:
                        </Text>
                        <TextInput
                          value={matchSheetNewListName}
                          onChangeText={setMatchSheetNewListName}
                          placeholder={deepLinkRecipe?.name || "Shopping list"}
                          placeholderTextColor={T.muted}
                          autoCapitalize="words"
                          returnKeyType="done"
                          style={{
                            borderWidth: 1, borderColor: "rgba(22,163,74,0.4)",
                            borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
                            fontSize: 14, color: T.text, backgroundColor: "rgba(22,163,74,0.04)",
                          }}
                        />
                      </View>
                    )}
                    <TouchableOpacity
                      onPress={addMissingToList}
                      disabled={matchSheetAdding}
                      style={[s.btnPrimary, { marginBottom: 10, opacity: matchSheetAdding ? 0.5 : 1 }]}
                    >
                      <Text style={s.btnPrimaryText}>
                        {matchSheetAdding ? "Adding…" : `Add ${willAdd} ${willAdd === 1 ? "item" : "items"} to shopping list`}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}

              <TouchableOpacity
                onPress={() => { setDeepLinkRecipe(null); setDeepLinkRecipeError(null); }}
                style={[s.btnPrimary, { marginTop: 0, marginBottom: 16, backgroundColor: "rgba(0,0,0,0.04)" }]}
              >
                <Text style={[s.btnPrimaryText, { color: T.text }]}>Close</Text>
              </TouchableOpacity>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      {/* v1.19 — InventoryMatchSheet removed. The match flow now lives
          inline inside the deepLinkRecipe modal: ingredients are decorated
          with ✓/+ icons, the persistent CTA at the bottom adds queued items
          to the chosen shopping list. */}

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
      <BulkAddModal
        visible={showBulkAdd}
        onClose={() => { setShowBulkAdd(false); setBulkAddPresetMode(null); }}
        onAddItems={handleBulkAdd}
        section={addSection}
        presetMode={bulkAddPresetMode}
        onPresetConsumed={() => setBulkAddPresetMode(null)}
      />

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
                // v1.22 #241 — Remember the version they dismissed so we
                // don't re-prompt for the same one. Tapping Update opens
                // the App Store; once they update locally compareVersions
                // returns 0 anyway, but record it as belt + suspenders.
                if (updateInfo?.latest) {
                  AsyncStorage.setItem("app_update_dismissed_version", updateInfo.latest).catch(() => {});
                }
                if (updateInfo?.url) Linking.openURL(updateInfo.url);
                setUpdateInfo(null);
              }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 16 }}>Update Now</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                track("update_prompt_dismissed", { from: updateInfo?.current, to: updateInfo?.latest });
                // v1.22 #241 — Persist so we suppress until a NEWER version
                // ships. compareVersions(dismissed, nextLatest) >= 0 stays
                // true only until Apple has something even newer.
                if (updateInfo?.latest) {
                  AsyncStorage.setItem("app_update_dismissed_version", updateInfo.latest).catch(() => {});
                }
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
          extends through the home-indicator / gesture-handle zone.
          paddingBottom keeps labels above the indicator on iOS and above
          the Android gesture bar (Pixel 9 default). v1.21 — extended to
          Android after Greg saw "PLAN" being clipped by the Pixel 9
          gesture handle. */}
      <View style={[s.navBar, { paddingBottom: 24 }]}>
        {navItems.map(n => {
          const active = tab === n.id ||
            (n.id === "eatMeFirst" && tab === "reminders") || // back-compat
            (n.id === "settings"   && (tab === "howto" || tab === "share"));
          const color = active ? T.accent : T.muted;
          return (
            <TouchableOpacity key={n.id} style={s.navBtn} onPress={() => setTab(n.id)}>
              {n.id === "fridge"     && <MaterialIcons name="kitchen"            size={24} color={color} />}
              {n.id === "eatMeFirst" && <MaterialIcons name="local-fire-department" size={24} color={color} />}
              {n.id === "plan"       && <Ionicons      name="list-outline"       size={24} color={color} />}
              {n.id === "dashboard"  && <Ionicons      name="bar-chart-outline"  size={24} color={color} />}
              {n.id === "settings"   && <Ionicons      name="settings-outline"   size={24} color={color} />}
              <Text style={[s.navLabel, active && { color: T.accent }]}>{n.label}</Text>
            </TouchableOpacity>
          );
        })}
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