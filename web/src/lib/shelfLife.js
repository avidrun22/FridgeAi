// FoodKeeper shelf-life lookup for the web app.
// Mirror of the iOS App.js helper. Same Supabase RPC, same fallback logic.
//
// Usage:
//   import { lookupShelfLife } from "../lib/shelfLife";
//   const sl = await lookupShelfLife("whole milk", "Dairy", "fridge");
//   // → { closedDays: 7, openedDays: 7, source: "foodkeeper", matchName: "Milk" }
//
// On a miss (low confidence, no match, RPC error), returns the category
// default. The `source` field tells the caller which path was used so we
// can choose to surface "USDA-derived" vs "category default" in the UI.

import { supabase } from "./supabase.js";
import { EXPIRY_DAYS_BY_CATEGORY, OPENED_DAYS_MAP } from "./constants.js";

export async function lookupShelfLife(name, category, container = "fridge") {
  const fallback = {
    closedDays: EXPIRY_DAYS_BY_CATEGORY[category] || 7,
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
    if ((top.score ?? 0) < 30) return fallback;
    const containerKey =
      container === "freezer" ? "freezer" :
      container === "pantry"  ? "pantry"  :
                                "fridge";
    const closedMax = top[`${containerKey}_max_days`] ?? top[`${containerKey}_min_days`];
    const openedMax = top[`${containerKey}_open_max_days`] ?? top[`${containerKey}_open_min_days`];
    if (closedMax == null) {
      const fallbackKeys =
        container === "freezer" ? ["fridge_max_days", "pantry_max_days"] :
        container === "pantry"  ? ["fridge_max_days", "freezer_max_days"] :
                                  ["pantry_max_days", "freezer_max_days"];
      for (const k of fallbackKeys) {
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
