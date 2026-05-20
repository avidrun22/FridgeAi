import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { RETAILERS } from "../lib/constants.js";
import { track } from "../lib/analytics.js";
import Modal from "../components/Modal.jsx";
import Layout from "../components/Layout.jsx";
import RecipeSheet from "../components/RecipeSheet.jsx";

// v1.22 #187 — cuisine list for the Plan-tab recipe browser. Mirrors
// CUISINE_PICKER_OPTIONS in App.js. Ordered roughly by recipe_bank size
// (largest cuisines first) so the most-populated options sit on top of
// the picker grid.
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

// Plan tab — full parity with iOS v1.13:
//  - Recipe search links (AllRecipes / NYT Cooking / Epicurious) seeded from
//    most-recent fridge_items.
//  - Multiple shopping lists per household (shopping_lists table + list_id FK).
//  - List picker (when 0 or 2+ lists) and in-list view.
//  - Single-add and bulk-add (paste multiple items at once).
//  - Recently-added chips above the input — household-shared, last 6 unique
//    names, tap to re-add.
//  - Checked items collapse to a "Got N" group at the bottom of the list.
//  - "Save & start fresh" CTA when everything's checked → archives the list.
//  - Past lists section in the picker view → tap to clone an archived list
//    back into a new active one (preserves names, drops check state).
//  - "Order N items" retailer picker (Instacart, Amazon, Walmart).
//
// Deferred: realtime sync between household members (Supabase Realtime
// channel on shopping_list_items would push updates without polling).
export default function Plan({ user }) {
  const [householdId, setHouseholdId] = useState(null);
  const [lists, setLists] = useState([]);            // active lists
  const [activeListId, setActiveListId] = useState(null);
  const [items, setItems] = useState([]);
  const [adding, setAdding] = useState("");
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [err, setErr] = useState(null);
  // v1.21 #215 — Share toast lives at the top of the screen for ~2.5s
  // after the user taps Share and we successfully copy the URL or fire
  // the native share sheet.
  const [shareToast, setShareToast] = useState(null);

  // New-list dialog
  const [showCreateList, setShowCreateList] = useState(false);
  const [newListName, setNewListName] = useState("");

  // Order retailer picker
  const [showOrderPicker, setShowOrderPicker] = useState(false);

  // Fridge items for the recipe-links seed.
  const [fridgeItems, setFridgeItems] = useState([]);

  // Bulk-add modal
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkText, setBulkText] = useState("");

  // Recently-added chips (top 6 unique names across the household).
  const [recentNames, setRecentNames] = useState([]);

  // Checked-items collapse — "Got N" group at the bottom is collapsed by
  // default; tap to expand.
  const [checkedExpanded, setCheckedExpanded] = useState(false);

  // Past lists (archived) — collapsed-by-default section in the picker view.
  const [archivedLists, setArchivedLists] = useState([]);
  const [archivedExpanded, setArchivedExpanded] = useState(false);

  // v1.26 #312 web parity — top-level mode gate. null = haven't picked Today
  // vs Week yet; "today" = legacy Tonight/All/Saved flow; "week" = the new
  // multi-cuisine + serving picker → 5-card Mon-Fri plan persisted to
  // weekly_meal_plans. Mirrors iOS PlanScreen.
  const [planMode, setPlanMode] = useState(null);                    // null | "today" | "week"
  const [weeklyPlan, setWeeklyPlan] = useState(null);                // { id, servings, cuisines, recipes, created_at }
  const [weeklyCuisines, setWeeklyCuisines] = useState(new Set());
  const [weeklyServings, setWeeklyServings] = useState(2);
  const [weeklyGenerating, setWeeklyGenerating] = useState(false);
  const [previousPlans, setPreviousPlans] = useState([]);
  const [previousPlansExpanded, setPreviousPlansExpanded] = useState(false);
  const [viewingPreviousPlan, setViewingPreviousPlan] = useState(null);

  // v1.22 #187 web parity — Recipes section. Mirrors iOS PlanScreen v1.19.
  // Three sub-tabs: Tonight (fridge-aware, ranked by overlap), All Recipes
  // (cuisine-filtered browse), Saved (user_recipes_saved).
  const [recipesTab,     setRecipesTab]     = useState("tonight");   // "tonight" | "all" | "saved"
  const [tonightCuisine, setTonightCuisine] = useState(null);
  const [browseCuisine,  setBrowseCuisine]  = useState(null);
  const [tonightRecipes, setTonightRecipes] = useState([]);
  const [browseRecipes,  setBrowseRecipes]  = useState([]);
  const [savedRecipes,   setSavedRecipes]   = useState([]);          // [{ id, recipe_data, saved_at, source_recipe_id }]
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [loadingSaved,   setLoadingSaved]   = useState(false);
  // openRecipe is the recipe object currently shown in RecipeSheet.
  // openRecipeSavedRowId hints the heart's filled state for that recipe.
  const [openRecipe,            setOpenRecipe]            = useState(null);
  const [openRecipeSavedRowId,  setOpenRecipeSavedRowId]  = useState(null);

  async function loadEverything() {
    try {
      setErr(null);
      const { data: hh, error: hhErr } = await supabase.rpc("ensure_household_for_user");
      if (hhErr) throw hhErr;
      setHouseholdId(hh);

      const { data: l, error: lErr } = await supabase
        .from("shopping_lists")
        // v1.21 #215 — pull share_token + is_public_shareable so the
        // Share button can read existing tokens (no DB round-trip when
        // re-sharing a list that already has one).
        .select("id, name, archived_at, created_at, share_token, is_public_shareable")
        .eq("household_id", hh)
        .is("archived_at", null)
        .order("created_at", { ascending: true });
      if (lErr) throw lErr;
      setLists(l || []);

      // Auto-select if exactly one list — same UX as iOS.
      if ((l || []).length === 1 && !activeListId) {
        setActiveListId(l[0].id);
      }

      // Fridge items (top 3 fresh, used to seed recipe links).
      const { data: fi } = await supabase
        .from("fridge_items")
        .select("name, expiry_date")
        .eq("household_id", hh)
        .order("created_at", { ascending: false })
        .limit(20);
      setFridgeItems(fi || []);

      // Load recently-added shopping names + archived lists in parallel.
      // Both are non-critical (nice-to-have UI), so silent failures are fine.
      loadRecentNames(hh);
      loadArchivedLists(hh);
    } catch (e) {
      setErr(e?.message || "Couldn't load lists.");
    } finally {
      setLoadingLists(false);
    }
  }

  // Pull last 60 shopping_list_items (any list, archived included) and
  // dedupe by name to surface the household's last 6 unique additions.
  async function loadRecentNames(hh) {
    if (!hh) { setRecentNames([]); return; }
    try {
      const { data, error } = await supabase
        .from("shopping_list_items")
        .select("name, created_at")
        .eq("household_id", hh)
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
      setRecentNames(out);
    } catch (_) {
      // Silent — chips are cosmetic.
    }
  }

  // Pull the 20 most-recently-archived lists with item counts via PostgREST
  // relation embedding (same pattern as iOS).
  async function loadArchivedLists(hh) {
    if (!hh) { setArchivedLists([]); return; }
    try {
      const { data, error } = await supabase
        .from("shopping_lists")
        .select("id, name, archived_at, shopping_list_items(count)")
        .eq("household_id", hh)
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      const enriched = (data || []).map(l => ({
        id: l.id,
        name: l.name,
        archived_at: l.archived_at,
        item_count: (l.shopping_list_items?.[0]?.count) || 0,
      }));
      setArchivedLists(enriched);
    } catch (_) { /* silent */ }
  }

  async function loadItems(listId) {
    if (!listId) { setItems([]); return; }
    try {
      setLoadingList(true);
      const { data, error } = await supabase
        .from("shopping_list_items")
        .select("id, name, checked, created_by, created_at")
        .eq("list_id", listId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      setItems((data || []).map(r => ({ id: r.id, name: r.name, checked: !!r.checked })));
    } catch (e) {
      setErr(e?.message || "Couldn't load list items.");
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => { loadEverything(); /* eslint-disable-line */ }, []);
  useEffect(() => { if (activeListId) loadItems(activeListId); else setItems([]); /* eslint-disable-line */ }, [activeListId]);
  // v1.26 #312 — Load weekly plans when user enters Week mode (or household changes).
  useEffect(() => {
    if (planMode === "week") loadWeeklyPlans();
    // eslint-disable-next-line
  }, [householdId, planMode]);

  // v1.26 #312 web parity — Weekly Meal Plans handlers. Same shape as iOS:
  // load active + history, generate (auto-saves), clone-on-reactivate.
  async function loadWeeklyPlans() {
    if (!householdId) {
      setWeeklyPlan(null);
      setPreviousPlans([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("weekly_meal_plans")
        .select("id, servings, cuisines, recipes, created_at")
        .eq("household_id", householdId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(21);
      if (error) throw error;
      const rows = data || [];
      if (rows.length === 0) {
        setWeeklyPlan(null);
        setPreviousPlans([]);
      } else {
        setWeeklyPlan(rows[0]);
        setPreviousPlans(rows.slice(1));
      }
    } catch (e) {
      console.warn("[plan-web] loadWeeklyPlans failed:", e?.message || e);
    }
  }

  async function generateWeeklyPlan() {
    if (!householdId || weeklyGenerating) return;
    setWeeklyGenerating(true);
    try {
      const itemNames = (items || [])
        .map(i => (i.name || "").trim())
        .filter(Boolean)
        .slice(0, 60);
      if (itemNames.length === 0) {
        alert("Add a few items to your fridge first — the weekly plan uses your inventory.");
        return;
      }
      const cuisinesArr = Array.from(weeklyCuisines);
      const body = {
        items: itemNames,
        servings: weeklyServings,
        mode: "weekly",
        cuisines: cuisinesArr,
      };
      const { data, error } = await supabase.functions.invoke("generate-recipes", { body });
      if (error) throw error;
      const recipes = Array.isArray(data?.recipes) ? data.recipes : [];
      if (recipes.length === 0) {
        alert("Couldn't build a plan. Try a different cuisine mix or add more items.");
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      const { data: inserted, error: insErr } = await supabase
        .from("weekly_meal_plans")
        .insert({
          household_id: householdId,
          created_by: user?.id || null,
          servings: weeklyServings,
          cuisines: cuisinesArr,
          recipes,
        })
        .select("id, servings, cuisines, recipes, created_at")
        .single();
      if (insErr) throw insErr;
      setPreviousPlans(prev => weeklyPlan ? [weeklyPlan, ...prev].slice(0, 20) : prev);
      setWeeklyPlan(inserted);
      track("weekly_plan_generated", {
        surface: "web",
        servings: weeklyServings,
        cuisine_count: cuisinesArr.length,
        recipe_count: recipes.length,
        source: data?.source || "claude",
      });
    } catch (e) {
      console.warn("[plan-web] generateWeeklyPlan failed:", e?.message || e);
      alert("Couldn't build a plan. Try again in a moment.");
    } finally {
      setWeeklyGenerating(false);
    }
  }

  async function cloneWeeklyPlan(sourcePlan) {
    if (!householdId || !sourcePlan) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: inserted, error } = await supabase
        .from("weekly_meal_plans")
        .insert({
          household_id: householdId,
          created_by: user?.id || null,
          servings: sourcePlan.servings,
          cuisines: sourcePlan.cuisines || [],
          recipes: sourcePlan.recipes,
        })
        .select("id, servings, cuisines, recipes, created_at")
        .single();
      if (error) throw error;
      setPreviousPlans(prev => weeklyPlan ? [weeklyPlan, ...prev].slice(0, 20) : prev);
      setWeeklyPlan(inserted);
      setViewingPreviousPlan(null);
      track("weekly_plan_cloned", { surface: "web", source_id: sourcePlan.id });
    } catch (e) {
      console.warn("[plan-web] cloneWeeklyPlan failed:", e?.message || e);
      alert("Couldn't reactivate that plan. Try again.");
    }
  }

  // v1.22 #187 — recipe loaders. Tonight comes from recipe-browse with
  // tab=tonight (server ranks by fridge overlap). All Recipes is browse
  // mode. Saved reads user_recipes_saved client-side. Both Tonight and
  // All Recipes are gated behind a cuisine pick — once a cuisine is
  // selected, we filter the loaded list client-side. Loading is cheap
  // (Edge Function caches) so we re-load on tab switch rather than
  // memoizing per cuisine.
  async function loadRecipesForTab(tab) {
    if (tab === "saved") return;
    setLoadingRecipes(true);
    try {
      const body = { limit: 50 };
      if (tab === "tonight") {
        body.tab = "tonight";
      } else if (tab === "all") {
        body.tab = "browse";
      }
      const { data, error } = await supabase.functions.invoke("recipe-browse", { body });
      if (error) throw error;
      const recipes = Array.isArray(data?.recipes) ? data.recipes : [];
      if (tab === "tonight") setTonightRecipes(recipes);
      else if (tab === "all") setBrowseRecipes(recipes);
      track("recipe_browse_tab_view", {
        tab, result_count: recipes.length, surface: "web_plan",
      });
    } catch (e) {
      console.warn(`[plan-web] loadRecipesForTab(${tab}) failed:`, e?.message || e);
    } finally {
      setLoadingRecipes(false);
    }
  }

  async function loadSavedRecipes() {
    if (!user?.id) { setSavedRecipes([]); return; }
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
      console.warn("[plan-web] loadSavedRecipes failed:", e?.message || e);
      setSavedRecipes([]);
    } finally {
      setLoadingSaved(false);
    }
  }

  // Initial recipe load. Tonight is the default tab; saved comes along
  // because the Saved tab is one click away. All Recipes loads on demand
  // when the user switches tabs.
  useEffect(() => {
    if (!householdId) return;
    loadRecipesForTab("tonight");
    loadSavedRecipes();
    /* eslint-disable-line */
  }, [householdId]);

  // v1.22 — open the recipe sheet. The recipe-browse Edge Function only
  // returns a card-shape payload (id, name, emoji, time, difficulty,
  // meal_type, cuisine, dietary_tags, description, fridge_overlap_count) —
  // it leaves out ingredients / instructions / tip. When the user taps a
  // browse-tab card, we hydrate from recipe_bank by slug before opening
  // the sheet. Saved cards already carry the full recipe_data blob from
  // user_recipes_saved, so they open instantly.
  async function openRecipeSheet(recipe, savedRowId = null) {
    setOpenRecipeSavedRowId(savedRowId);
    track("recipe_sheet_opened", {
      recipe_name: recipe?.name,
      recipe_id: recipe?.id,
      source: savedRowId ? "saved_tab" : recipesTab,
    });

    // If the recipe already has ingredients (Saved tab + cache hits),
    // open immediately.
    if (Array.isArray(recipe?.ingredients) && recipe.ingredients.length > 0) {
      setOpenRecipe(recipe);
      return;
    }

    // Card-shape recipe — hydrate from recipe_bank. id IS the slug for
    // bank recipes per the recipe-browse interface comment.
    setOpenRecipe(recipe);   // open immediately so user sees the card while we fetch
    try {
      const slug = recipe?.slug || recipe?.id;
      if (!slug || /^\d{8}-/.test(String(slug))) {
        // Daily-cache id — can't resolve publicly. Leave the card as-is.
        return;
      }
      const { data, error } = await supabase
        .from("recipe_bank")
        .select("id, slug, name, emoji, time_minutes, difficulty, meal_type, cuisine, dietary_tags, description, ingredients, instructions, tip")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        // Format time_minutes back to "20 min" / "1 hr 30 min" — matches what
        // the card-shape `time` field provides.
        const timeStr = (function () {
          if (!data.time_minutes) return recipe.time || null;
          if (data.time_minutes < 60) return `${data.time_minutes} min`;
          const h = Math.floor(data.time_minutes / 60);
          const m = data.time_minutes % 60;
          return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
        })();
        setOpenRecipe({
          ...recipe,
          ...data,
          time: timeStr,
        });
      }
    } catch (e) {
      console.warn("[plan-web] hydrate recipe failed:", e?.message || e);
    }
  }

  // Update savedRecipes list when the user heart-toggles in the sheet.
  // null = unsaved, string = newly-saved row id.
  function handleSavedRowIdChange(newRowId) {
    setOpenRecipeSavedRowId(newRowId);
    // Re-fetch saved list so the Saved tab stays accurate.
    loadSavedRecipes();
  }

  async function createList() {
    const name = (newListName || "").trim();
    if (!name || !householdId) return;
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("shopping_lists")
        .insert({ household_id: householdId, name, created_by: u?.id || null })
        .select("id, name, archived_at, created_at")
        .single();
      if (error) throw error;
      setLists(prev => [...prev, data]);
      setActiveListId(data.id);
      setNewListName("");
      setShowCreateList(false);
    } catch (e) {
      setErr(e?.message || "Couldn't create list.");
    }
  }

  async function archiveList(id) {
    if (!confirm("Archive this list? You can still find it in Past Lists later.")) return;
    try {
      const { error } = await supabase
        .from("shopping_lists")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      setLists(prev => prev.filter(l => l.id !== id));
      if (activeListId === id) setActiveListId(null);
      // Refresh past-lists so the archived list appears immediately.
      loadArchivedLists(householdId);
    } catch (e) {
      setErr(e?.message || "Couldn't archive list.");
    }
  }

  async function addItem() {
    const name = (adding || "").trim();
    if (!name || !householdId || !activeListId) return;
    setAdding("");
    const tempId = "temp-" + Date.now();
    setItems(prev => [...prev, { id: tempId, name, checked: false }]);
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("shopping_list_items")
        .insert({
          household_id: householdId,
          list_id: activeListId,
          name,
          created_by: u?.id || null,
        })
        .select("id, name, checked")
        .single();
      if (error) throw error;
      setItems(prev => prev.map(i => i.id === tempId ? { id: data.id, name: data.name, checked: !!data.checked } : i));
      // Bump the just-added name to the top of the recent chips.
      setRecentNames(prev => {
        const k = name.toLowerCase();
        const filtered = prev.filter(n => n.toLowerCase() !== k);
        return [name, ...filtered].slice(0, 6);
      });
    } catch (e) {
      setItems(prev => prev.filter(i => i.id !== tempId));
      setErr(e?.message || "Couldn't add item.");
    }
  }

  // Batch insert. Optimistic UI: temp IDs render immediately, replaced by
  // real Supabase rows on success; pessimistic refetch on failure.
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
    setItems(prev => [...prev, ...tempItems]);
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      const rows = cleaned.map(name => ({
        household_id: householdId,
        list_id: activeListId,
        name,
        created_by: u?.id || null,
      }));
      const { data, error } = await supabase
        .from("shopping_list_items")
        .insert(rows)
        .select("id, name, checked");
      if (error) throw error;
      setItems(prev => {
        const tempIds = new Set(tempItems.map(t => t.id));
        const withoutTemps = prev.filter(i => !tempIds.has(i.id));
        const real = (data || []).map(r => ({ id: r.id, name: r.name, checked: !!r.checked }));
        return [...withoutTemps, ...real];
      });
      // Refresh chips so just-added names jump to the top.
      setRecentNames(prev => {
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
      const tempIds = new Set(tempItems.map(t => t.id));
      setItems(prev => prev.filter(i => !tempIds.has(i.id)));
      setErr("Some items may not have been saved.");
      loadItems(activeListId);
    }
  }

  // Copy an archived list's items into a NEW active list. Strips check
  // state. New list name auto-generated as "<old> · <Mon D>" so users can
  // tell clones apart.
  async function cloneArchivedList(archived) {
    if (!householdId || !archived?.id) return;
    try {
      const { data: srcItems, error: srcErr } = await supabase
        .from("shopping_list_items")
        .select("name")
        .eq("list_id", archived.id);
      if (srcErr) throw srcErr;
      const names = (srcItems || []).map(i => (i.name || "").trim()).filter(Boolean);
      if (names.length === 0) {
        setErr("That list doesn't have any items.");
        return;
      }
      const today = new Date();
      const monthDay = today.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const newName = `${archived.name} · ${monthDay}`;

      const { data: { user: u } } = await supabase.auth.getUser();
      const { data: newList, error: newErr } = await supabase
        .from("shopping_lists")
        .insert({ household_id: householdId, name: newName, created_by: u?.id || null })
        .select("id, name, archived_at, created_at")
        .single();
      if (newErr) throw newErr;

      const rows = names.map(name => ({
        household_id: householdId,
        list_id: newList.id,
        name,
        created_by: u?.id || null,
      }));
      const { error: insErr } = await supabase.from("shopping_list_items").insert(rows);
      if (insErr) throw insErr;

      setLists(prev => [...prev, newList]);
      setActiveListId(newList.id);
    } catch (e) {
      setErr(e?.message || "Couldn't reuse that list.");
    }
  }

  async function toggle(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const nextChecked = !item.checked;
    setItems(prev => prev.map(i => i.id === id ? { ...i, checked: nextChecked } : i));
    try {
      const { error } = await supabase
        .from("shopping_list_items")
        .update({ checked: nextChecked })
        .eq("id", id);
      if (error) throw error;
    } catch (e) {
      // Revert on failure.
      setItems(prev => prev.map(i => i.id === id ? { ...i, checked: !nextChecked } : i));
    }
  }

  async function remove(id) {
    const removed = items.find(i => i.id === id);
    setItems(prev => prev.filter(i => i.id !== id));
    try {
      const { error } = await supabase
        .from("shopping_list_items")
        .delete()
        .eq("id", id);
      if (error) throw error;
    } catch (e) {
      if (removed) setItems(prev => [...prev, removed]);
    }
  }

  async function clearChecked() {
    const checkedItems = items.filter(i => i.checked);
    if (checkedItems.length === 0) return;
    const ids = checkedItems.map(i => i.id);
    setItems(prev => prev.filter(i => !i.checked));
    try {
      const { error } = await supabase
        .from("shopping_list_items")
        .delete()
        .in("id", ids);
      if (error) throw error;
    } catch (e) {
      // Refetch on failure to restore truth from server.
      loadItems(activeListId);
    }
  }

  // v1.21 — Recipe ideas section removed (iOS dropped these external links
  // in v1.18 — see #169). Greg flagged the lingering web links 2026-05-15.
  // Full native Recipes UI parity (v1.19 recipe_bank browser + inventory
  // match) is tracked under #187 v1.20 — Web at parity with iOS. Until
  // that lands, the Plan tab is shopping-list-only on web — same as iOS
  // before v1.19.

  // Order picker — runs against unchecked items.
  const unchecked = items.filter(i => !i.checked);
  const orderQuery = unchecked.map(i => i.name).join(" ").trim();
  function handleOrderRetailer(retailer) {
    if (!orderQuery) return;
    window.open(retailer.url(orderQuery), "_blank", "noopener,noreferrer");
    setShowOrderPicker(false);
  }

  const activeList = lists.find(l => l.id === activeListId);
  const showPicker = !activeListId;

  // v1.21 #215 — Share the active list. Generates a UUID share_token on
  // first share (and flips is_public_shareable=true), then either fires
  // the native share sheet (mobile, navigator.share) or copies the URL
  // to clipboard with a toast confirmation. Subsequent shares reuse the
  // existing token so the link stays stable for recipients.
  async function shareActiveList() {
    if (!activeList) return;
    let token = activeList.share_token;
    if (!token || !activeList.is_public_shareable) {
      // Most browsers expose crypto.randomUUID(); fall back to v4 polyfill.
      token = (crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
            const r = (Math.random() * 16) | 0;
            return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
          });
      const { error } = await supabase
        .from("shopping_lists")
        .update({
          share_token: token,
          is_public_shareable: true,
          share_token_created_at: new Date().toISOString(),
        })
        .eq("id", activeList.id);
      if (error) {
        setShareToast("Couldn't generate share link — please try again.");
        setTimeout(() => setShareToast(null), 3000);
        return;
      }
      // Update local cache so subsequent shares of this same list reuse
      // the token instead of regenerating.
      setLists(prev => prev.map(l =>
        l.id === activeList.id
          ? { ...l, share_token: token, is_public_shareable: true }
          : l));
      track("shopping_list_share_link_generated", { list_id: activeList.id });
    }
    const url = `https://ok2eat.com/lists?t=${token}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: activeList.name,
          text: `Shopping list: ${activeList.name}`,
          url,
        });
        track("shopping_list_share_link_native_shared", { list_id: activeList.id });
        return;
      } catch (_e) {
        // user canceled / dismissed — fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareToast("Link copied — paste anywhere to share.");
      setTimeout(() => setShareToast(null), 2500);
      track("shopping_list_share_link_copied", { list_id: activeList.id });
    } catch (_e) {
      setShareToast(`Couldn't copy. Link: ${url}`);
      setTimeout(() => setShareToast(null), 5000);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <Layout user={user}>
      <>
        {/* v1.21 #215 — Share-link toast (auto-dismisses ~2.5s) */}
        {shareToast && (
          <div
            role="status"
            aria-live="polite"
            className="fixed top-24 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-text text-white text-sm font-medium shadow-lg max-w-[90vw] text-center"
          >
            {shareToast}
          </div>
        )}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text tracking-tight">Plan</h1>
          {/* v1.22 — recipes section restored on web (#187 Phase 2+3). Matches
              the iOS Plan tab subtitle. */}
          <p className="text-textSoft text-sm mt-0.5">Recipes · shopping lists · saved</p>
        </div>

        {err && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger mb-4">
            {err}
          </div>
        )}

        {/* ─── Meal Planning — top-level mode gate (v1.26 #312) ───────────
            Two-button gate: "For Today" preserves the Tonight/All/Saved
            cuisine-first flow. "For This Week" swaps in a multi-cuisine +
            serving picker → 5-card Mon-Fri plan persisted to
            weekly_meal_plans, with a Previous Plans collapsible. Mirrors
            iOS App.js PlanScreen. */}
        <section className="mb-8">
          <h2 className="text-[11px] font-bold tracking-widest text-textSoft uppercase mb-3">
            // Meal Planning
          </h2>

          {/* Mode gate — only shown when user hasn't picked Today vs Week yet. */}
          {planMode === null && (
            <div className="mb-5">
              <p className="text-textSoft text-sm mb-3">What are you planning?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setPlanMode("today"); track("plan_mode_selected", { surface: "web", mode: "today" }); }}
                  className="rounded-xl border border-border bg-card p-4 hover:border-accent/60 transition text-center"
                >
                  <div className="text-3xl mb-1">🍽️</div>
                  <div className="text-text text-sm font-semibold">For Today</div>
                  <div className="text-textSoft text-xs mt-0.5">What to cook tonight</div>
                </button>
                <button
                  onClick={() => { setPlanMode("week"); track("plan_mode_selected", { surface: "web", mode: "week" }); }}
                  className="rounded-xl border border-border bg-card p-4 hover:border-accent/60 transition text-center"
                >
                  <div className="text-3xl mb-1">📅</div>
                  <div className="text-text text-sm font-semibold">For This Week</div>
                  <div className="text-textSoft text-xs mt-0.5">5 dinners Mon–Fri</div>
                </button>
              </div>
            </div>
          )}

          {/* Mode-active pill — tap to return to gate */}
          {planMode !== null && (
            <button
              onClick={() => { setPlanMode(null); track("plan_mode_changed", { surface: "web" }); }}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/15 text-accent text-xs font-semibold mb-4 hover:opacity-80"
            >
              <span>←</span>
              <span>{planMode === "today" ? "🍽️ Planning for today" : "📅 Planning for the week"}</span>
              <span className="text-textSoft font-normal ml-0.5">· tap to change</span>
            </button>
          )}

          {/* ─── Today mode — Tonight/All/Saved sub-tabs ─────────────── */}
          {planMode === "today" && (<>
          <h2 className="text-[11px] font-bold tracking-widest text-textSoft uppercase mb-3">
            // Recipes
          </h2>

          {/* Tab pills */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {[
              { key: "tonight", label: "Tonight" },
              { key: "all",     label: "All Recipes" },
              { key: "saved",   label: "Saved" },
            ].map(t => {
              const active = recipesTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => {
                    setRecipesTab(t.key);
                    if (t.key === "all" && browseRecipes.length === 0) loadRecipesForTab("all");
                    if (t.key === "saved") loadSavedRecipes();
                  }}
                  className={`text-xs font-semibold px-3.5 py-1.5 rounded-full transition ${active ? "bg-accent text-white" : "bg-card border border-border text-textSoft hover:text-text"}`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* ── Tonight / All Recipes — cuisine-first flow ── */}
          {(recipesTab === "tonight" || recipesTab === "all") && (() => {
            const activeCuisine = recipesTab === "tonight" ? tonightCuisine : browseCuisine;
            const setActiveCuisine = recipesTab === "tonight" ? setTonightCuisine : setBrowseCuisine;
            const baseList = recipesTab === "tonight" ? tonightRecipes : browseRecipes;
            const currentList = activeCuisine ? baseList.filter(r => r.cuisine === activeCuisine) : [];
            const activeCuisineOpt = CUISINE_PICKER_OPTIONS.find(c => c.key === activeCuisine);

            return (
              <>
                {!activeCuisine ? (
                  <>
                    <p className="text-xs text-textSoft mb-3">
                      {recipesTab === "tonight"
                        ? "Pick a cuisine to see recipes that use what's in your fridge."
                        : "Pick a cuisine to browse."}
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {CUISINE_PICKER_OPTIONS.map(c => (
                        <button
                          key={c.key}
                          onClick={() => setActiveCuisine(c.key)}
                          className="rounded-xl border border-border bg-card p-3 hover:border-accent/60 transition text-center"
                        >
                          <div className="text-2xl mb-1">{c.emoji}</div>
                          <div className="text-text text-xs font-semibold">{c.label}</div>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    {/* "Change cuisine" pill */}
                    <button
                      onClick={() => setActiveCuisine(null)}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/15 text-accent text-xs font-semibold mb-3 hover:opacity-80"
                    >
                      <span>←</span>
                      <span>{activeCuisineOpt?.emoji} {activeCuisineOpt?.label}</span>
                      <span className="text-textSoft font-normal ml-0.5">· tap to change</span>
                    </button>

                    {loadingRecipes && currentList.length === 0 ? (
                      <div className="rounded-xl border border-border bg-card p-4 text-sm text-textSoft">
                        Loading recipes…
                      </div>
                    ) : currentList.length === 0 ? (
                      <div className="rounded-xl border border-border bg-card p-4 text-center">
                        <p className="text-textSoft text-sm">
                          {recipesTab === "tonight"
                            ? "Add items to your fridge to get personalized picks."
                            : `No ${activeCuisineOpt?.label} recipes in the catalog yet.`}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {currentList.map(r => {
                          // v1.22 #187 — "USES N" inventory-match badge.
                          // The recipe-browse Edge Function returns
                          // fridge_overlap_count on the Tonight tab (it's
                          // how the server ranks results). Render as a
                          // green pill to call out which recipes lean on
                          // what's already in the user's fridge. Hidden
                          // when 0 or null (no useful signal there).
                          const overlap = typeof r.fridge_overlap_count === "number" ? r.fridge_overlap_count : null;
                          return (
                            <button
                              key={r.id || r.slug || r.name}
                              onClick={() => openRecipeSheet(r)}
                              className="w-full rounded-xl border border-border bg-card p-3 flex items-start gap-3 text-left hover:border-accent/60 transition"
                            >
                              <div className="text-2xl flex-shrink-0">{r.emoji || "🍽️"}</div>
                              <div className="flex-1 min-w-0">
                                <p className="text-text font-semibold text-sm truncate">{r.name}</p>
                                <p className="text-textSoft text-xs mt-0.5">
                                  {[r.time, r.difficulty].filter(Boolean).join(" · ")}
                                </p>
                              </div>
                              {overlap != null && overlap > 0 && (
                                <span className="text-[10px] font-bold tracking-wider px-2 py-1 rounded-full bg-accent/15 text-accent flex-shrink-0 self-center">
                                  USES {overlap}
                                </span>
                              )}
                              <span className="text-muted text-xl flex-shrink-0 self-center">›</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </>
            );
          })()}

          {/* ── Saved tab ── */}
          {recipesTab === "saved" && (
            loadingSaved && savedRecipes.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-4 text-sm text-textSoft">
                Loading saved recipes…
              </div>
            ) : savedRecipes.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-4 text-center">
                <p className="text-textSoft text-sm">
                  No saved recipes yet. Tap the heart on any recipe to save it here.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {savedRecipes.map(sr => {
                  const r = sr.recipe_data || {};
                  return (
                    <button
                      key={sr.id}
                      onClick={() => openRecipeSheet(r, sr.id)}
                      className="w-full rounded-xl border border-border bg-card p-3 flex items-start gap-3 text-left hover:border-accent/60 transition"
                    >
                      <div className="text-2xl flex-shrink-0">{r.emoji || "🍽️"}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-text font-semibold text-sm truncate">{r.name || "Untitled recipe"}</p>
                        <p className="text-textSoft text-xs mt-0.5">
                          {[r.time, r.difficulty].filter(Boolean).join(" · ") || "Saved recipe"}
                        </p>
                      </div>
                      <span className="text-danger text-base flex-shrink-0">♥</span>
                    </button>
                  );
                })}
              </div>
            )
          )}
          </>)}

          {/* ─── Week mode — multi-cuisine + servings → 5-card Mon-Fri ─── */}
          {planMode === "week" && (() => {
            const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
            if (weeklyGenerating) {
              return (
                <div className="rounded-xl border border-border bg-card p-6 text-center">
                  <div className="text-2xl mb-2">⏳</div>
                  <p className="text-text font-semibold text-sm">Building your week's plan…</p>
                  <p className="text-textSoft text-xs mt-1">
                    5 dinners, scaled to {weeklyServings} {weeklyServings === 1 ? "serving" : "servings"}.
                  </p>
                </div>
              );
            }
            // ────── ACTIVE PLAN — 5 cards Mon-Fri ──────
            if (weeklyPlan && Array.isArray(weeklyPlan.recipes) && weeklyPlan.recipes.length > 0) {
              const planRecipes = weeklyPlan.recipes;
              const planCuisinesLabel = (weeklyPlan.cuisines || [])
                .map(k => CUISINE_PICKER_OPTIONS.find(c => c.key === k)?.label || k)
                .join(", ");
              return (
                <div>
                  <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 mb-3">
                    <p className="text-textSoft text-xs">
                      Active plan · {weeklyPlan.servings} {weeklyPlan.servings === 1 ? "serving" : "servings"}
                      {planCuisinesLabel ? ` · ${planCuisinesLabel}` : ""}
                    </p>
                    <p className="text-accent text-xs font-bold mt-0.5">📅 Your week</p>
                  </div>
                  <div className="space-y-2 mb-4">
                    {planRecipes.slice(0, 5).map((r, idx) => {
                      const day = DAY_LABELS[idx] || `Day ${idx + 1}`;
                      const meta = [r.time, r.difficulty].filter(Boolean).join(" · ");
                      return (
                        <button
                          key={`${weeklyPlan.id}-${idx}`}
                          onClick={() => {
                            track("weekly_plan_recipe_opened", { surface: "web", plan_id: weeklyPlan.id, day_index: idx, name: r.name });
                            openRecipeSheet(r);
                          }}
                          className="w-full rounded-xl border border-border bg-card p-3 flex items-center gap-3 text-left hover:border-accent/60 transition"
                        >
                          <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-bold text-accent">{day.toUpperCase()}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-text font-semibold text-sm truncate">
                              {r.emoji || "🍽️"} {r.name || "Recipe"}
                            </p>
                            {!!meta && (
                              <p className="text-textSoft text-xs mt-0.5 truncate">{meta}</p>
                            )}
                          </div>
                          <span className="text-muted text-xl flex-shrink-0">›</span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => {
                      setWeeklyPlan(null);
                      setWeeklyCuisines(new Set());
                      setWeeklyServings(2);
                      track("weekly_plan_new_tapped", { surface: "web", previous_id: weeklyPlan.id });
                    }}
                    className="w-full rounded-xl border border-dashed border-border bg-card p-3 hover:border-accent/60 transition text-center"
                  >
                    <p className="text-accent text-sm font-bold">+ New plan</p>
                    <p className="text-textSoft text-xs mt-0.5">Compose a fresh week</p>
                  </button>

                  {/* Previous Plans */}
                  {previousPlans.length > 0 && (
                    <div className="mt-4">
                      <button
                        onClick={() => setPreviousPlansExpanded(!previousPlansExpanded)}
                        className="w-full flex items-center justify-between py-2"
                      >
                        <span className="text-textSoft text-[10px] font-bold tracking-widest uppercase">
                          ⏱  Previous Plans · {previousPlans.length}
                        </span>
                        <span className="text-muted text-base">{previousPlansExpanded ? "▴" : "▾"}</span>
                      </button>
                      {previousPlansExpanded && (
                        <div className="space-y-1.5">
                          {previousPlans.map(p => {
                            const created = new Date(p.created_at);
                            const dateLabel = created.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                            const cuisinesLabel = (p.cuisines || [])
                              .map(k => CUISINE_PICKER_OPTIONS.find(c => c.key === k)?.label || k)
                              .join(", ") || "Any cuisine";
                            const firstRecipeName = (p.recipes?.[0]?.name) || "Recipe";
                            return (
                              <button
                                key={p.id}
                                onClick={() => setViewingPreviousPlan(p)}
                                className="w-full rounded-xl border border-border bg-card p-2.5 flex items-center gap-3 text-left hover:border-accent/60 transition"
                              >
                                <div className="w-10 h-10 rounded-lg bg-bg flex flex-col items-center justify-center flex-shrink-0">
                                  <span className="text-[9px] font-bold text-textSoft uppercase">{dateLabel.split(" ")[0]}</span>
                                  <span className="text-xs font-bold text-text leading-none">{dateLabel.split(" ")[1]}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-text font-semibold text-xs truncate">{cuisinesLabel}</p>
                                  <p className="text-textSoft text-[11px] mt-0.5 truncate">
                                    {p.servings} {p.servings === 1 ? "serving" : "servings"} · starts with {firstRecipeName}
                                  </p>
                                </div>
                                <span className="text-muted text-base flex-shrink-0">›</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            }
            // ────── COMPOSE — multi-cuisine + servings + Generate ──────
            return (
              <div>
                <p className="text-text text-sm font-semibold mb-1">Pick the cuisines you want this week</p>
                <p className="text-textSoft text-xs mb-3">
                  We'll spread 5 dinners across them. Pick 1 or pick all — your call.
                </p>
                <div className="flex flex-wrap gap-1.5 mb-5">
                  {CUISINE_PICKER_OPTIONS.map(c => {
                    const selected = weeklyCuisines.has(c.key);
                    return (
                      <button
                        key={c.key}
                        onClick={() => {
                          const next = new Set(weeklyCuisines);
                          if (selected) next.delete(c.key); else next.add(c.key);
                          setWeeklyCuisines(next);
                        }}
                        className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition flex items-center gap-1.5 ${
                          selected
                            ? "bg-accent/15 text-accent border-accent"
                            : "bg-surface text-text border-border hover:border-accent/60"
                        }`}
                      >
                        <span>{c.emoji}</span>
                        <span>{c.label}</span>
                      </button>
                    );
                  })}
                </div>

                <p className="text-text text-sm font-semibold mb-1">How many people?</p>
                <p className="text-textSoft text-xs mb-3">We'll scale ingredient amounts to match.</p>
                <div className="flex flex-wrap gap-1.5 mb-5">
                  {[1, 2, 3, 4, 5, 6, 8].map(n => {
                    const selected = weeklyServings === n;
                    return (
                      <button
                        key={n}
                        onClick={() => setWeeklyServings(n)}
                        className={`min-w-[44px] px-3.5 py-2 rounded-xl border text-sm font-bold transition ${
                          selected
                            ? "bg-accent/15 text-accent border-accent"
                            : "bg-surface text-text border-border hover:border-accent/60"
                        }`}
                      >
                        {n}{n === 8 ? "+" : ""}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={generateWeeklyPlan}
                  disabled={weeklyGenerating}
                  className="w-full py-2.5 rounded-lg bg-accent text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-50"
                >
                  {weeklyCuisines.size > 0
                    ? `Generate ${weeklyCuisines.size === 1
                        ? "from " + (CUISINE_PICKER_OPTIONS.find(c => c.key === Array.from(weeklyCuisines)[0])?.label || "selected")
                        : "across " + weeklyCuisines.size + " cuisines"}`
                    : "Surprise me with 5 dinners"}
                </button>
                <p className="text-textSoft text-xs mt-2 text-center">
                  Uses what's in your fridge when possible · skip cuisines to let us mix
                </p>

                {/* Previous Plans (also visible in compose state) */}
                {previousPlans.length > 0 && (
                  <div className="mt-6">
                    <button
                      onClick={() => setPreviousPlansExpanded(!previousPlansExpanded)}
                      className="w-full flex items-center justify-between py-2"
                    >
                      <span className="text-textSoft text-[10px] font-bold tracking-widest uppercase">
                        ⏱  Previous Plans · {previousPlans.length}
                      </span>
                      <span className="text-muted text-base">{previousPlansExpanded ? "▴" : "▾"}</span>
                    </button>
                    {previousPlansExpanded && (
                      <div className="space-y-1.5">
                        {previousPlans.map(p => {
                          const created = new Date(p.created_at);
                          const dateLabel = created.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                          const cuisinesLabel = (p.cuisines || [])
                            .map(k => CUISINE_PICKER_OPTIONS.find(c => c.key === k)?.label || k)
                            .join(", ") || "Any cuisine";
                          const firstRecipeName = (p.recipes?.[0]?.name) || "Recipe";
                          return (
                            <button
                              key={p.id}
                              onClick={() => setViewingPreviousPlan(p)}
                              className="w-full rounded-xl border border-border bg-card p-2.5 flex items-center gap-3 text-left hover:border-accent/60 transition"
                            >
                              <div className="w-10 h-10 rounded-lg bg-bg flex flex-col items-center justify-center flex-shrink-0">
                                <span className="text-[9px] font-bold text-textSoft uppercase">{dateLabel.split(" ")[0]}</span>
                                <span className="text-xs font-bold text-text leading-none">{dateLabel.split(" ")[1]}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-text font-semibold text-xs truncate">{cuisinesLabel}</p>
                                <p className="text-textSoft text-[11px] mt-0.5 truncate">
                                  {p.servings} {p.servings === 1 ? "serving" : "servings"} · starts with {firstRecipeName}
                                </p>
                              </div>
                              <span className="text-muted text-base flex-shrink-0">›</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </section>

        {/* v1.26 #312 — View-previous-plan modal (Reactivate this plan). */}
        {viewingPreviousPlan && (
          <Modal
            open={true}
            onClose={() => setViewingPreviousPlan(null)}
            size="lg"
            title="Previous plan"
          >
            <div className="max-h-[75vh] overflow-y-auto">
              <p className="text-textSoft text-sm mb-4">
                {new Date(viewingPreviousPlan.created_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                {" · "}{viewingPreviousPlan.servings} {viewingPreviousPlan.servings === 1 ? "serving" : "servings"}
              </p>
              <div className="space-y-2 mb-4">
                {(viewingPreviousPlan.recipes || []).slice(0, 5).map((r, idx) => {
                  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
                  const day = DAY_LABELS[idx] || `Day ${idx + 1}`;
                  const meta = [r.time, r.difficulty].filter(Boolean).join(" · ");
                  return (
                    <div key={`prev-${idx}`} className="rounded-xl border border-border bg-bg p-3 flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-accent">{day.toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-text font-semibold text-sm truncate">
                          {r.emoji || "🍽️"} {r.name || "Recipe"}
                        </p>
                        {!!meta && <p className="text-textSoft text-xs mt-0.5 truncate">{meta}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <button
                onClick={() => cloneWeeklyPlan(viewingPreviousPlan)}
                className="w-full py-2.5 rounded-lg bg-accent text-white text-sm font-bold hover:opacity-90 transition mb-2"
              >
                Reactivate this plan
              </button>
              <button
                onClick={() => setViewingPreviousPlan(null)}
                className="w-full py-2.5 rounded-lg bg-bg text-text text-sm font-semibold hover:opacity-80 transition"
              >
                Close
              </button>
            </div>
          </Modal>
        )}

        {/* ─── Shopping lists ───────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3 gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {/* v1.22 — promoted the back-to-picker link from a faint gray
                  text link in the right action row to a real left-side
                  chevron button next to the list name. Matches iOS App.js
                  Plan tab where chevron-back sits left of the title.
                  Easier to discover when the user lands in a list-detail
                  view after Add-to-list or Save and wants to see all
                  their lists again. Only renders when multiple lists
                  exist; single-list users have no picker to go back to. */}
              {!showPicker && lists.length > 1 && (
                <button
                  onClick={() => setActiveListId(null)}
                  className="w-7 h-7 rounded-full hover:bg-bg flex items-center justify-center text-accent flex-shrink-0"
                  aria-label="Back to all lists"
                >
                  <span aria-hidden="true" className="text-lg leading-none">‹</span>
                </button>
              )}
              <h2 className="text-[11px] font-bold tracking-widest text-textSoft uppercase truncate">
                {showPicker ? "Shopping Lists" : `// ${(activeList?.name || "shopping list").toUpperCase()}`}
              </h2>
              {/* v1.21 #215 — Share button positioned right next to the
                  list name (per Greg, 2026-05-15) and styled like the
                  prominent solid-green "Order N items" button so it
                  reads as a primary action, not a sidekick to the text
                  links on the right. */}
              {!showPicker && activeList && (
                <button
                  onClick={shareActiveList}
                  className="px-3 py-1.5 rounded-full bg-accent text-white text-xs font-semibold hover:opacity-90 transition flex items-center gap-1.5 flex-shrink-0 shadow-sm"
                  aria-label="Share this shopping list"
                >
                  <span aria-hidden="true">📤</span> Share
                </button>
              )}
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {!showPicker && items.some(i => i.checked) && (
                <button onClick={clearChecked} className="text-xs text-accent font-semibold hover:underline">
                  Clear checked
                </button>
              )}
              <button
                onClick={() => { setNewListName(""); setShowCreateList(true); }}
                className="text-xs text-accent font-semibold hover:underline"
              >
                + New list
              </button>
            </div>
          </div>

          {showPicker ? (
            <>
              <div className="space-y-2">
                {loadingLists ? (
                  <div className="rounded-xl border border-border bg-card p-4 text-sm text-textSoft">Loading lists…</div>
                ) : lists.length === 0 ? (
                  <button
                    onClick={() => { setNewListName(""); setShowCreateList(true); }}
                    className="w-full rounded-xl border border-dashed border-border bg-card p-6 hover:border-accent transition"
                  >
                    <p className="text-accent font-semibold text-sm">+ Create your first list</p>
                    <p className="text-textSoft text-xs mt-1">e.g. "Costco trip", "This week", "Birthday party"</p>
                  </button>
                ) : (
                  lists.map(l => (
                    <button
                      key={l.id}
                      onClick={() => setActiveListId(l.id)}
                      className="w-full rounded-xl border border-border bg-card p-4 flex items-center gap-3 text-left hover:border-accent/60 transition"
                    >
                      <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
                        📝
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-text font-semibold truncate">{l.name}</p>
                        <p className="text-textSoft text-xs mt-0.5">Tap to view</p>
                      </div>
                      <span className="text-muted text-xl">›</span>
                    </button>
                  ))
                )}
              </div>

              {/* Past lists — collapsed-by-default. Tap a row to clone its items
                  into a new active list. Solves the recurring-trip pattern. */}
              {archivedLists.length > 0 && (
                <div className="mt-6">
                  <button
                    onClick={() => setArchivedExpanded(v => !v)}
                    className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-muted uppercase hover:text-accent w-full"
                  >
                    🕐 <span className="flex-1 text-left">Past lists · {archivedLists.length}</span>
                    <span>{archivedExpanded ? "▲" : "▼"}</span>
                  </button>
                  {archivedExpanded && (
                    <div className="space-y-2 mt-3">
                      {archivedLists.map(al => {
                        const archivedDate = new Date(al.archived_at).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        });
                        return (
                          <button
                            key={al.id}
                            onClick={() => {
                              if (confirm(`Reuse "${al.name}"? Start a new list with the ${al.item_count} ${al.item_count === 1 ? "item" : "items"} from this past list. The original stays archived.`)) {
                                cloneArchivedList(al);
                              }
                            }}
                            className="w-full rounded-xl border border-border bg-card p-3 flex items-center gap-3 text-left opacity-85 hover:opacity-100 hover:border-accent/40 transition"
                          >
                            <div className="w-8 h-8 rounded-lg bg-bg flex items-center justify-center text-muted text-sm">
                              📦
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-text font-semibold text-sm truncate">{al.name}</p>
                              <p className="text-textSoft text-[11px] mt-0.5">
                                {al.item_count} {al.item_count === 1 ? "item" : "items"} · archived {archivedDate}
                              </p>
                            </div>
                            <span className="text-accent text-[10px] font-bold tracking-wider">REUSE</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {(() => {
                // Split items: pending always visible, checked collapsed at the bottom.
                const pending = items.filter(i => !i.checked);
                const checkedItems = items.filter(i => i.checked);
                const renderRow = (item) => (
                  <div key={item.id} className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
                    <button
                      onClick={() => toggle(item.id)}
                      className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition ${
                        item.checked
                          ? "bg-accent border-accent text-white"
                          : "bg-transparent border-border hover:border-accent"
                      }`}
                    >
                      {item.checked && <span className="text-xs leading-none">✓</span>}
                    </button>
                    <span className={`flex-1 text-sm ${item.checked ? "text-muted line-through" : "text-text"}`}>
                      {item.name}
                    </span>
                    <button
                      onClick={() => remove(item.id)}
                      className="text-muted hover:text-danger text-xs"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </div>
                );
                if (loadingList) {
                  return <div className="rounded-xl border border-border bg-card p-4 text-sm text-textSoft">Loading…</div>;
                }
                if (items.length === 0) {
                  return (
                    <div className="rounded-xl border border-border bg-card p-4 text-sm text-textSoft">
                      Nothing on the list yet. Add an item below.
                    </div>
                  );
                }
                return (
                  <div className="space-y-1.5">
                    {pending.length === 0 && checkedItems.length > 0 && (
                      <div className="rounded-xl border border-accent/20 bg-accent/5 p-5 text-center">
                        <p className="text-text font-bold text-base">🎉 All caught up</p>
                        <p className="text-textSoft text-xs mt-1.5">
                          Save this list to your past trips so you can reuse it next time.
                        </p>
                        {activeList && (
                          <button
                            onClick={() => archiveList(activeList.id)}
                            className="mt-3 px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent/90"
                          >
                            Save &amp; start fresh
                          </button>
                        )}
                      </div>
                    )}
                    {pending.map(renderRow)}
                    {checkedItems.length > 0 && (
                      <>
                        <button
                          onClick={() => setCheckedExpanded(v => !v)}
                          className="w-full rounded-xl border border-accent/30 bg-accent/5 p-3 flex items-center gap-3 hover:bg-accent/10 transition"
                        >
                          <span className="w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center text-xs flex-shrink-0">✓</span>
                          <span className="flex-1 text-left text-sm font-bold text-accent">
                            Got {checkedItems.length} {checkedItems.length === 1 ? "item" : "items"}
                          </span>
                          <span className="text-accent text-sm">{checkedExpanded ? "▲" : "▼"}</span>
                        </button>
                        {checkedExpanded && checkedItems.map(renderRow)}
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Recently-added chips — household-shared. Tap to re-add. */}
              {recentNames.length > 0 && (
                <div className="mt-5">
                  <p className="text-[10px] font-bold tracking-widest text-textSoft uppercase mb-2">
                    Recently added · tap to add again
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {recentNames.map((n, idx) => (
                      <button
                        key={n + "_" + idx}
                        onClick={() => bulkAddItems([n])}
                        className="px-3 py-1.5 rounded-full border border-border bg-card text-sm hover:border-accent transition flex items-center gap-1.5"
                      >
                        <span className="text-text">{n}</span>
                        <span className="text-accent font-bold">+</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Add item input */}
              <div className="flex gap-2 mt-4">
                <input
                  type="text"
                  value={adding}
                  onChange={(e) => setAdding(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addItem(); }}
                  placeholder="Add an item…"
                  className="flex-1 rounded-full border border-border bg-card px-4 py-2 text-sm focus:outline-none focus:border-accent"
                />
                <button
                  onClick={addItem}
                  disabled={!adding.trim()}
                  className="w-10 h-10 rounded-full bg-accent text-white text-xl flex items-center justify-center disabled:opacity-40 hover:bg-accent/90"
                >
                  +
                </button>
              </div>

              <button
                onClick={() => { setBulkText(""); setShowBulkAdd(true); }}
                className="block mx-auto mt-3 text-xs text-accent font-semibold hover:underline flex items-center gap-1"
              >
                📋 Add multiple items at once
              </button>

              {unchecked.length > 0 && (
                <button
                  onClick={() => setShowOrderPicker(true)}
                  className="w-full mt-4 rounded-full bg-accent text-white py-2.5 text-sm font-semibold hover:bg-accent/90 flex items-center justify-center gap-2"
                >
                  🛒 Order {unchecked.length} {unchecked.length === 1 ? "item" : "items"}
                </button>
              )}

              {activeList && (
                <button
                  onClick={() => archiveList(activeList.id)}
                  className="block mx-auto mt-4 text-xs text-muted hover:text-danger"
                >
                  Archive this list
                </button>
              )}
            </>
          )}
        </section>

      {/* ─── New list dialog ───────────────────────────────────────────────── */}
      {/* ─── Bulk-add modal ─────────────────────────────────────────────── */}
      <Modal open={showBulkAdd} onClose={() => setShowBulkAdd(false)} title="Add multiple items">
        <p className="text-sm text-textSoft mb-3">
          One item per line. Or paste a list from elsewhere — we'll split it on line breaks.
        </p>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={"eggs\nmilk\nbread\navocados (3)\nsourdough"}
          autoFocus
          rows={8}
          className="w-full rounded-lg border border-border bg-card px-4 py-2 text-sm focus:outline-none focus:border-accent mb-2 font-mono"
        />
        <p className="text-textSoft text-xs mb-3">
          {(() => {
            const parsed = (bulkText || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            return parsed.length === 0
              ? "Type or paste items above."
              : `${parsed.length} ${parsed.length === 1 ? "item" : "items"} ready to add.`;
          })()}
        </p>
        <button
          onClick={async () => {
            const names = (bulkText || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            if (names.length === 0) return;
            setShowBulkAdd(false);
            setBulkText("");
            await bulkAddItems(names);
          }}
          disabled={!bulkText.trim()}
          className="w-full rounded-full bg-accent text-white py-2 text-sm font-semibold disabled:opacity-50 hover:bg-accent/90"
        >
          Add to list
        </button>
      </Modal>

      <Modal open={showCreateList} onClose={() => setShowCreateList(false)} title="New shopping list">
        <p className="text-sm text-textSoft mb-4">
          Name it after a store, a trip, or whatever helps you keep things separate.
        </p>
        <input
          type="text"
          value={newListName}
          onChange={(e) => setNewListName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") createList(); }}
          placeholder='e.g. "Costco trip"'
          autoFocus
          className="w-full rounded-lg border border-border bg-card px-4 py-2 text-sm focus:outline-none focus:border-accent mb-3"
        />
        <button
          onClick={createList}
          disabled={!newListName.trim()}
          className="w-full rounded-full bg-accent text-white py-2 text-sm font-semibold disabled:opacity-50 hover:bg-accent/90"
        >
          Create list
        </button>
      </Modal>

      {/* ─── Order retailer picker ─────────────────────────────────────────── */}
      <Modal open={showOrderPicker} onClose={() => setShowOrderPicker(false)} title="Order shopping list">
        <p className="text-xs text-textSoft mb-3 truncate">
          Searching for: {unchecked.map(i => i.name).join(", ")}
        </p>
        <div className="space-y-2">
          {RETAILERS.map(r => (
            <button
              key={r.id}
              onClick={() => handleOrderRetailer(r)}
              className="w-full rounded-xl border p-4 flex items-center gap-3 text-left transition hover:opacity-80"
              style={{
                backgroundColor: r.color + "0D",
                borderColor: r.color + "33",
              }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold"
                style={{ backgroundColor: r.color + "1A", color: r.color }}
              >
                {r.label.charAt(0)}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm" style={{ color: r.color }}>{r.label}</p>
                <p className="text-textSoft text-[11px] mt-0.5">
                  Find {unchecked.length} {unchecked.length === 1 ? "item" : "items"} on {r.label}
                </p>
              </div>
              <span style={{ color: r.color }} className="text-xl">›</span>
            </button>
          ))}
        </div>
      </Modal>

      {/* v1.22 #187 — full-recipe modal shared by Tonight/All/Saved tabs.
          Renders only when openRecipe is set; close clears state. */}
      <RecipeSheet
        recipe={openRecipe}
        user={user}
        open={!!openRecipe}
        onClose={() => { setOpenRecipe(null); setOpenRecipeSavedRowId(null); }}
        initialSavedRowId={openRecipeSavedRowId}
        onSavedRowIdChange={handleSavedRowIdChange}
      />
      </>
    </Layout>
  );
}
