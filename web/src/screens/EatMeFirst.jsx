import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { rowToItem, daysUntil, formatQty } from "../lib/helpers.js";
import { CATEGORY_EMOJI, inferEmoji } from "../lib/constants.js";
import { track } from "../lib/analytics.js";
import { shareRecipeWeb } from "../lib/recipeShare.js";
import Layout from "../components/Layout.jsx";
import Modal from "../components/Modal.jsx";

// Eat Me First — the headline tab for v1.16.
//
// What's the problem? Users open the app and don't know what to do. They see
// a long list of items in their fridge, and the most relevant decision —
// "what should I eat tonight before it goes bad?" — is buried 4 taps deep.
//
// This tab answers that question directly. It pulls the user's fridge, ranks
// every item by an urgency score (combining days-until-expiry with category
// spoil-risk weighting), and shows the top ~12 in priority order. Each row
// has a one-tap "Get recipes" button that calls generate-recipes with this
// item leading + the other 4 most-urgent items, so the recipes Claude
// suggests actually use what's about to spoil.
//
// Validates the Email 1 promise ("the day before something goes bad, we tell
// you what to make with it") and Cooklist's #1 differentiator (priority list
// instead of inventory list).

// Score lower = more urgent. Days-until-expiry dominates; category nudges
// faster-spoiling things up the list when expiry windows tie. Items >14 days
// out are dropped from the list entirely.
function urgencyScore(item) {
  const d = daysUntil(item.expiryDate);
  // Expired sits at the very top.
  if (d <= 0) return -1000 + d;
  // Per-category spoil factor — herbs/produce sink faster than dry goods even
  // at the same labeled date.
  const spoil = {
    Produce: -0.5,
    Dairy:   -0.4,
    Protein: -0.3,
    Bakery:  -0.2,
    Frozen:   0.5,
    "Dry goods": 0.8,
    Beverages: 0.2,
  }[item.category] ?? 0;
  return d + spoil;
}

// v1.22 #236 — pre-generation filters for the EatMeFirst recipe modal,
// mirrored from App.js EMF_*_OPTIONS. Renders as 3 horizontally-scrollable
// chip rows above the recipe cards. Selection alone doesn't trigger a
// fetch; user taps "Update results" to spend a credit and re-generate.
const EMF_CUISINE_OPTIONS = [
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
const EMF_PROTEIN_OPTIONS = [
  { key: "chicken",  emoji: "🍗", label: "Chicken" },
  { key: "beef",     emoji: "🥩", label: "Beef" },
  { key: "pork",     emoji: "🥓", label: "Pork" },
  { key: "fish",     emoji: "🐟", label: "Fish" },
  { key: "shrimp",   emoji: "🦐", label: "Shrimp" },
  { key: "egg",      emoji: "🥚", label: "Egg" },
  { key: "tofu",     emoji: "🌱", label: "Tofu" },
  { key: "beans",    emoji: "🫘", label: "Beans" },
];
const EMF_MAX_INGREDIENTS_OPTIONS = [
  { key: 5,  label: "≤ 5 ingredients" },
  { key: 8,  label: "≤ 8 ingredients" },
  { key: 12, label: "≤ 12 ingredients" },
];

function urgencyBadge(days) {
  // 2026-05-15 — split "Expired" (truly past) from "Use today" (day-0, still
  // safe). The whole "Eat Me First" pitch is: act on this before it goes
  // bad. Labeling a day-0 item "Expired" tells the user the opposite —
  // that they've already failed. Matches helpers.expiryLabel + Demo's
  // urgencyBadge.
  if (days < 0)   return { text: "Expired",            color: "#DC2626", bg: "#FEE2E2" };
  if (days === 0) return { text: "Use today",          color: "#DC2626", bg: "#FEE2E2" };
  if (days === 1) return { text: "Expires tomorrow",   color: "#DC2626", bg: "#FEE2E2" };
  if (days <= 3)  return { text: `${days} days left`,  color: "#EA580C", bg: "#FFEDD5" };
  if (days <= 7)  return { text: `${days} days left`,  color: "#CA8A04", bg: "#FEF9C3" };
  return            { text: `${days} days left`,  color: "#16A34A", bg: "#DCFCE7" };
}

export default function EatMeFirst({ user }) {
  const [items, setItems]   = useState([]);
  const [loading, setLoad]  = useState(true);
  const [err, setErr]       = useState(null);

  // Recipe modal — opens when user taps "Get recipes" on a row, or the
  // header "Top 5 together" CTA.
  const [recipeModal, setRecipeModal] = useState(null); // {leadItem, items, recipes, loading, error, filters}
  // v1.22 #236 — filter selection. Persisted across modal opens within a
  // session. "Update results" only appears when pending != applied.
  const [pendingFilters, setPendingFilters] = useState({ cuisine: null, protein: null, maxIngredients: null });

  // v1.22 #187 web parity — track which recipes in the open modal the user
  // has saved this session, keyed by recipe index. Value is the
  // user_recipes_saved row id so we can unsave without a second lookup.
  // Map<recipeIndex, savedRowId>
  const [savedRowIds, setSavedRowIds] = useState({});
  const [savingIdx, setSavingIdx]     = useState(null);   // shows spinner on the heart while in-flight
  const [addingIdx, setAddingIdx]     = useState(null);   // shows spinner on the "Add to list" while we open the picker
  const [recipeToast, setRecipeToast] = useState(null);   // string | null — floating 2.5s confirmation

  // v1.22 #187 — Add-to-list picker state. Opens when the user taps
  // "+ Add to list" on a recipe card. Mirrors iOS's InventoryMatchSheet
  // pattern: a destination-list picker (existing lists OR "New list…")
  // plus per-ingredient checkboxes (default all checked). User confirms
  // with "Add N items" and the rows land in the chosen list.
  // shape: { recipe, recipeIndex, householdId, lists:[{id,name}],
  //          ingredients:[string], toggles:{idx:bool},
  //          listId:uuid|null, newListName:string, creatingList:bool }
  const [addToListState, setAddToListState] = useState(null);
  const [confirmingAdd, setConfirmingAdd]   = useState(false);

  async function load() {
    try {
      setErr(null);
      const { data, error } = await supabase
        .from("fridge_items")
        .select("*")
        .order("expiry_date", { ascending: true });
      if (error) throw error;
      setItems((data || []).map(rowToItem));
    } catch (e) {
      setErr(e?.message || "Couldn't load your fridge.");
    } finally {
      setLoad(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  // v1.16 — fire once per mount when data finishes loading so we get a clean
  // "user actually saw the ranked list" signal (vs. "user navigated then
  // bounced before fetch returned"). Includes counts so we can correlate
  // with "do empty-state visitors retain less than populated-state ones".
  const viewedRef = useRef(false);
  useEffect(() => {
    if (loading || viewedRef.current) return;
    const expCount = items.filter(i => daysUntil(i.expiryDate) <= 0).length;
    const soonCount = items.filter(i => { const d = daysUntil(i.expiryDate); return d > 0 && d <= 3; }).length;
    track("eat_me_first_viewed", {
      surface: "web",
      total_items: items.length,
      expired_count: expCount,
      expiring_soon_count: soonCount,
      has_actionable: expCount + soonCount > 0,
    });
    viewedRef.current = true;
  }, [loading, items.length]);

  // Sort + cap. Anything past 14 days drops off — they're not "eat me first".
  const ranked = items
    .filter(i => daysUntil(i.expiryDate) <= 14)
    .sort((a, b) => urgencyScore(a) - urgencyScore(b))
    .slice(0, 12);

  const expiredCount = items.filter(i => daysUntil(i.expiryDate) <= 0).length;
  const soonCount    = items.filter(i => {
    const d = daysUntil(i.expiryDate);
    return d > 0 && d <= 3;
  }).length;

  // v1.22 #236 — fetchRecipes accepts optional filters that flow to the
  // generate-recipes Edge Function. Filters default to pendingFilters;
  // callers can pass `filters: {}` to ignore selection. Applied filters are
  // stored on recipeModal so the chip bar can render the "Update results"
  // CTA only when pending differs from what was last fetched.
  async function fetchRecipes({ leadItem, contextItems, filters }) {
    const activeFilters = filters !== undefined ? filters : pendingFilters;
    // v1.22 #187 — reset save / add-to-list per-card state when opening a
    // fresh recipe set, so we don't show a stale filled-heart on
    // index 0 from a previous lead.
    setSavedRowIds({});
    setSavingIdx(null);
    setAddingIdx(null);
    setRecipeToast(null);
    // v1.26 #307 — preserve selectedItemIds across re-fetches so the user can
    // toggle a chip + "Update results" without losing their other choices.
    // Build from leadItem + contextItems passed in (those are the ALREADY-
    // filtered set the caller wants Claude to use).
    const preservedSelection = new Set();
    if (leadItem) preservedSelection.add(leadItem.id);
    contextItems.forEach(i => preservedSelection.add(i.id));
    setRecipeModal(prev => ({
      // Preserve the FULL items pool (lead + context) for the chip row even
      // after recipes load — user can re-toggle to refine.
      leadItem: prev?.leadItem || leadItem,
      items: prev?.items || contextItems,
      recipes: [],
      loading: true,
      error: null,
      filters: activeFilters,
      awaitingSuggest: false,
      selectedItemIds: preservedSelection,
      // v1.26 #307 — snapshot of which items were sent to the API on this
      // fetch. Used to detect "selection dirty" → re-show Update Results
      // when the user toggles a chip after recipes have rendered.
      appliedSelectionIds: new Set(preservedSelection),
    }));
    track("eat_me_first_recipes_requested", {
      lead_item: leadItem?.name || null,
      context_count: contextItems.length,
      surface: leadItem ? "row" : "header_top5",
      cuisine: activeFilters?.cuisine || null,
      protein: activeFilters?.protein || null,
      max_ingredients: activeFilters?.maxIngredients || null,
    });
    try {
      // Send the lead item first so Claude knows what to anchor on, then the
      // other expiring items as the "and a few others you already have"
      // context promised in Email 3.
      const names = [
        ...(leadItem ? [leadItem.name] : []),
        ...contextItems.map(i => i.name).filter(n => n && n !== leadItem?.name),
      ].slice(0, 8);
      const body = { items: names };
      if (activeFilters?.cuisine) body.cuisine = activeFilters.cuisine;
      if (activeFilters?.protein) body.protein = activeFilters.protein;
      if (activeFilters?.maxIngredients) body.max_ingredients = activeFilters.maxIngredients;
      const { data, error } = await supabase.functions.invoke("generate-recipes", { body });
      if (error) throw error;
      setRecipeModal(m => m && { ...m, recipes: data?.recipes || [], loading: false });
    } catch (e) {
      setRecipeModal(m => m && { ...m, error: e?.message || "Couldn't generate recipes.", loading: false });
    }
  }

  // v1.22 #187 web parity — Save / Add-to-list handlers for the AI-generated
  // recipes in the modal. Mirrors iOS App.js's heart toggle (v1.18) +
  // shopping-list-from-recipe insert (v1.19). source_recipe_id is null for
  // AI-generated recipes (they're not in recipe_bank), so we save the full
  // JSON blob in recipe_data and let the saved-recipe sheet render it back.

  // v1.22 #240 — Share an EatMeFirst recipe. These are AI-generated and have
  // no public URL, so shareRecipeWeb falls back to text-share (full ingredients
  // + instructions in the message body or clipboard).
  async function shareRecipeFromCard(recipe) {
    try {
      const result = await shareRecipeWeb(recipe);
      if (result.ok) {
        track("recipe_shared", {
          name: recipe?.name,
          surface: `web_${result.surface}`,
          has_url: !!result.url,
          source: "eat_me_first",
        });
        if (result.surface === "clipboard") {
          setRecipeToast(result.url ? "Link copied" : "Recipe copied");
          setTimeout(() => setRecipeToast(null), 2000);
        }
      } else if (result.surface === "none") {
        setRecipeToast("Couldn't share. Try again.");
        setTimeout(() => setRecipeToast(null), 2500);
      }
    } catch (e) {
      console.warn("[eat-me-first] share failed:", e?.message || e);
    }
  }

  async function toggleSaveRecipe(recipe, index) {
    if (!user?.id || savingIdx === index) return;
    setSavingIdx(index);
    try {
      const existingId = savedRowIds[index];
      if (existingId) {
        // Unsave — same row id we cached when we inserted.
        const { error } = await supabase
          .from("user_recipes_saved")
          .delete()
          .eq("id", existingId);
        if (error) throw error;
        setSavedRowIds(prev => {
          const next = { ...prev };
          delete next[index];
          return next;
        });
        track("recipe_unsaved", { name: recipe?.name, source: "eat_me_first" });
      } else {
        const { data, error } = await supabase
          .from("user_recipes_saved")
          .insert({
            user_id: user.id,
            source_recipe_id: null,
            recipe_data: recipe,
          })
          .select("id")
          .single();
        if (error) throw error;
        setSavedRowIds(prev => ({ ...prev, [index]: data.id }));
        track("recipe_saved", { name: recipe?.name, source: "eat_me_first" });
        setRecipeToast(`Saved "${recipe?.name || "recipe"}"`);
        setTimeout(() => setRecipeToast(null), 2500);
      }
    } catch (e) {
      console.warn("[eat-me-first] toggleSaveRecipe failed:", e?.message || e);
      setRecipeToast("Couldn't save. Try again.");
      setTimeout(() => setRecipeToast(null), 2500);
    } finally {
      setSavingIdx(null);
    }
  }

  // v1.22 #187 — open the picker. Loads the user's active lists, extracts
  // ingredient names (no amounts — quantities don't carry over to a
  // shopping list), and seeds the toggles all-checked. The user can
  // uncheck items they already have + pick which list to add to before
  // committing.
  async function openAddToListModal(recipe, index) {
    if (!user?.id || addingIdx === index) return;
    if (!Array.isArray(recipe?.ingredients) || recipe.ingredients.length === 0) {
      setRecipeToast("Recipe has no ingredients to add.");
      setTimeout(() => setRecipeToast(null), 2500);
      return;
    }
    setAddingIdx(index);
    try {
      const { data: hh, error: hhErr } = await supabase.rpc("ensure_household_for_user");
      if (hhErr) throw hhErr;

      const { data: lists, error: lErr } = await supabase
        .from("shopping_lists")
        .select("id, name, created_at")
        .eq("household_id", hh)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (lErr) throw lErr;

      // Normalize ingredients to clean strings before showing in the picker.
      const ingredients = recipe.ingredients
        .map(ing => (typeof ing === "object" && ing !== null ? ing.item : ing))
        .filter(name => typeof name === "string" && name.trim().length > 0)
        .map(name => name.trim());

      const toggles = {};
      ingredients.forEach((_, i) => { toggles[i] = true; });

      // Default destination: most-recently-created active list, or
      // null (= "create new") if the user has none.
      const defaultListId = (lists && lists[0]?.id) || null;

      setAddToListState({
        recipe,
        recipeIndex: index,
        householdId: hh,
        lists: lists || [],
        ingredients,
        toggles,
        listId: defaultListId,
        newListName: "",
        creatingList: defaultListId === null,   // jump straight into "new list" mode for empty-state users
      });
    } catch (e) {
      console.warn("[eat-me-first] openAddToListModal failed:", e?.message || e);
      setRecipeToast("Couldn't load your lists. Try again.");
      setTimeout(() => setRecipeToast(null), 2500);
    } finally {
      setAddingIdx(null);
    }
  }

  // v1.22 #187 — commit the picker. Filters ingredients by the user's
  // checkbox toggles, optionally creates a new list, then bulk-inserts
  // shopping_list_items in one round-trip. Closes the picker on success.
  async function confirmAddToList() {
    if (!addToListState || confirmingAdd) return;
    const { recipe, householdId, lists, ingredients, toggles, listId, newListName, creatingList } = addToListState;

    const selectedIngredients = ingredients.filter((_, i) => toggles[i]);
    if (selectedIngredients.length === 0) {
      setRecipeToast("Pick at least one ingredient.");
      setTimeout(() => setRecipeToast(null), 2500);
      return;
    }

    setConfirmingAdd(true);
    try {
      // Resolve target list. Existing → use its id. "New list…" → create now.
      let targetListId = listId;
      let targetListName = null;
      if (creatingList || !targetListId) {
        const name = (newListName || "").trim() || "Shopping list";
        const { data: newList, error: createErr } = await supabase
          .from("shopping_lists")
          .insert({ household_id: householdId, name, created_by: user.id })
          .select("id, name")
          .single();
        if (createErr) throw createErr;
        targetListId = newList.id;
        targetListName = newList.name;
      } else {
        const existing = lists.find(l => l.id === targetListId);
        targetListName = existing?.name || "list";
      }

      const rows = selectedIngredients.map(name => ({
        household_id: householdId,
        list_id: targetListId,
        name,
        created_by: user.id,
      }));

      const { error: insErr } = await supabase
        .from("shopping_list_items")
        .insert(rows);
      if (insErr) throw insErr;

      track("shopping_list_generated", {
        recipe_name: recipe?.name || null,
        target_list_id: targetListId,
        item_count: rows.length,
        source: "eat_me_first",
        created_new_list: creatingList,
      });
      setRecipeToast(`Added ${rows.length} item${rows.length === 1 ? "" : "s"} to "${targetListName}"`);
      setTimeout(() => setRecipeToast(null), 3000);
      setAddToListState(null);
    } catch (e) {
      console.warn("[eat-me-first] confirmAddToList failed:", e?.message || e);
      setRecipeToast("Couldn't add to list. Try again.");
      setTimeout(() => setRecipeToast(null), 2500);
    } finally {
      setConfirmingAdd(false);
    }
  }

  // v1.26 #307 — pre-suggest gate. Was: tapping "Get recipes" immediately
  // fired the Claude call. Now we open the modal in awaiting-suggest state
  // so the user can deselect items they don't want grouped together (e.g.
  // chicken + blueberries don't belong in the same recipe). Default all
  // selected; Suggest button fires the actual fetch.
  function openSelectionModal({ leadItem, contextItems }) {
    // selectedItemIds includes the lead (if any) + all context items by default.
    const allIds = new Set();
    if (leadItem) allIds.add(leadItem.id);
    contextItems.forEach(i => allIds.add(i.id));
    setRecipeModal({
      leadItem,
      items: contextItems,
      recipes: [],
      loading: false,
      error: null,
      filters: pendingFilters,
      awaitingSuggest: true,
      selectedItemIds: allIds,
    });
    track("eat_me_first_selection_opened", {
      surface: leadItem ? "row" : "header_top5",
      item_count: allIds.size,
    });
  }

  function onUseLeading(leadItem) {
    // Find the 4 next-most-urgent items (excluding the lead) for context.
    const context = ranked
      .filter(i => i.id !== leadItem.id)
      .slice(0, 4);
    openSelectionModal({ leadItem, contextItems: context });
  }

  function onUseTop5() {
    openSelectionModal({ leadItem: null, contextItems: ranked.slice(0, 5) });
  }

  // v1.26 #307 — wraps fetchRecipes to honor the per-item selection. Pulls
  // selectedItemIds out of recipeModal, filters lead + items by that set,
  // then calls the real fetch.
  function suggestFromSelection() {
    if (!recipeModal) return;
    const sel = recipeModal.selectedItemIds || new Set();
    const filteredLead = (recipeModal.leadItem && sel.has(recipeModal.leadItem.id))
      ? recipeModal.leadItem
      : null;
    const filteredItems = (recipeModal.items || []).filter(i => sel.has(i.id));
    if (!filteredLead && filteredItems.length === 0) return;  // disabled button shouldn't reach here
    fetchRecipes({
      leadItem: filteredLead,
      contextItems: filteredItems,
      filters: pendingFilters,
    });
  }

  return (
    <Layout user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text tracking-tight">Eat me first</h1>
        <p className="text-textSoft text-sm mt-0.5">
          {loading ? "Loading…" :
           ranked.length === 0 ?
             "Nothing in your fridge is close to spoiling — nice." :
             `${ranked.length} ${ranked.length === 1 ? "item" : "items"} ranked by urgency` +
             (expiredCount + soonCount > 0
               ? ` · ${expiredCount} expired · ${soonCount} expiring within 3 days`
               : "")}
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger mb-4">
          {err}
        </div>
      )}

      {/* Top-5-together CTA. Only worth showing if we have at least 3
          urgent items — otherwise per-item recipes are cleaner. */}
      {ranked.length >= 3 && (
        <div className="mb-5 rounded-xl border border-accent/30 bg-accent/5 p-4 flex items-center gap-3">
          <div className="text-2xl">🍳</div>
          <div className="flex-1 min-w-0">
            <p className="text-text font-semibold text-sm">
              Cook with your top 5 expiring items together
            </p>
            <p className="text-textSoft text-xs mt-0.5">
              We'll suggest 3 recipes that use as many of them as possible.
            </p>
          </div>
          <button
            onClick={onUseTop5}
            className="px-3 py-1.5 rounded-full bg-accent text-white text-xs font-semibold hover:opacity-90 transition flex-shrink-0"
          >
            Suggest recipes
          </button>
        </div>
      )}

      {/* Ranked list */}
      {!loading && ranked.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <div className="text-5xl mb-3">✨</div>
          <p className="text-text font-semibold">All clear</p>
          <p className="text-textSoft text-sm mt-1">
            Nothing in your fridge is close to spoiling.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {ranked.map((item, idx) => {
          const days = daysUntil(item.expiryDate);
          const badge = urgencyBadge(days);
          return (
            <div
              key={item.id}
              className="rounded-xl border border-border bg-card p-3 flex items-center gap-3"
            >
              <div className="w-7 text-center text-textSoft text-xs font-bold flex-shrink-0">
                {idx + 1}
              </div>
              <div className="w-10 h-10 rounded-lg bg-bg flex items-center justify-center text-xl flex-shrink-0">
                {inferEmoji(item.name, item.emoji || CATEGORY_EMOJI[item.category] || "📦")}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-text font-semibold truncate">{item.name}</p>
                {/* v1.20 — Category + quantity on one line, e.g.
                    "Produce · 5 oz". Skip the qty suffix when there's
                    no unit (avoids "Produce · 1" for unitless rows). */}
                <p className="text-textSoft text-xs mt-0.5 truncate">
                  {item.category}{item.unit ? ` · ${formatQty(item)}` : ""}
                </p>
              </div>
              {/* v1.20 — Stack urgency badge above the "Get recipes" button.
                  Mirrors the iOS Eat Me First row. Side-by-side ate ~180px
                  on the right, leaving real item names ("Whole milk",
                  "Baby spinach", "Ground beef") truncating to "Who...",
                  "Bab...", "Gro..." on narrow viewports. Stacking shrinks
                  the right column to max(badge, button) ≈ 95px. */}
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                <span
                  className="text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap"
                  style={{ color: badge.color, backgroundColor: badge.bg }}
                >
                  {badge.text}
                </span>
                <button
                  onClick={() => onUseLeading(item)}
                  className="px-3 py-1.5 rounded-full bg-accent/10 text-accent text-xs font-semibold hover:bg-accent hover:text-white transition whitespace-nowrap"
                >
                  Get recipes
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recipe modal */}
      {recipeModal && (
        // v1.16 papercut fix — pass `title` prop so Modal renders the X
        // button in the header. Backdrop tap and Esc already dismiss
        // (handled by the Modal component). Matches the iOS fix in
        // App.js's EatMeFirstScreen recipe modal.
        <Modal
          open={true}
          onClose={() => setRecipeModal(null)}
          size="lg"
          title={recipeModal.leadItem
            ? `Recipes using ${recipeModal.leadItem.name}`
            : "Recipes for your top expiring items"}
        >
          <div className="max-h-[75vh] overflow-y-auto">
            {/* v1.26 #307 — subtitle reflects current selection vs total pool.
                In awaiting-suggest, shows "Using: a, b · 2 of 5". After fetch,
                just the names of the items actually used. */}
            {(() => {
              const sel = recipeModal.selectedItemIds || new Set();
              const allItems = [
                ...(recipeModal.leadItem ? [recipeModal.leadItem] : []),
                ...recipeModal.items,
              ];
              const selectedNames = allItems.filter(i => sel.has(i.id)).map(i => i.name);
              const countSuffix = recipeModal.awaitingSuggest && allItems.length > 0
                ? ` · ${selectedNames.length} of ${allItems.length}`
                : "";
              return (
                <p className="text-textSoft text-sm mb-4">
                  Using: {selectedNames.join(", ") || "no items selected"}{countSuffix}
                </p>
              );
            })()}

            {/* v1.26 #307 — item-selection chip row. Toggle per item. Default
                all-selected. Suggest button below the filters fires the actual
                Claude call when the user is happy with the set. */}
            {(() => {
              const sel = recipeModal.selectedItemIds || new Set();
              const allItems = [
                ...(recipeModal.leadItem ? [recipeModal.leadItem] : []),
                ...recipeModal.items,
              ];
              if (allItems.length === 0) return null;
              return (
                <div className="mb-3">
                  <p className="text-textSoft text-[10px] font-bold tracking-widest uppercase mb-1.5">
                    Items to include
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {allItems.map(item => {
                      const active = sel.has(item.id);
                      return (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => {
                            setRecipeModal(m => {
                              if (!m) return m;
                              const next = new Set(m.selectedItemIds || new Set());
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return { ...m, selectedItemIds: next };
                            });
                          }}
                          className={`px-2.5 py-1 rounded-full border text-xs font-semibold whitespace-nowrap flex items-center gap-1 transition ${
                            active
                              ? "bg-accent text-white border-accent"
                              : "bg-surface text-textSoft border-border line-through opacity-60 hover:opacity-100"
                          }`}
                        >
                          {item.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {recipeModal.loading && (
              <div className="py-10 text-center text-textSoft text-sm">
                Generating recipes…
              </div>
            )}
            {recipeModal.error && (
              <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
                {recipeModal.error}
              </div>
            )}

            {/* v1.22 #236 — Pre-generation filter chips. Cuisine + protein +
                ingredient cap. Selection alone doesn't fetch; "Suggest recipes"
                (awaiting state) or "Update results" (after fetch) commits.
                v1.26 #307 — gated behind the new item-selection chip row above.
                Button is disabled if user has deselected ALL items. */}
            {!recipeModal.loading && (() => {
              const applied = recipeModal.filters || {};
              const filtersDirty =
                (pendingFilters.cuisine || null) !== (applied.cuisine || null) ||
                (pendingFilters.protein || null) !== (applied.protein || null) ||
                (pendingFilters.maxIngredients || null) !== (applied.maxIngredients || null);
              const sel = recipeModal.selectedItemIds || new Set();
              const appliedSel = recipeModal.appliedSelectionIds || new Set();
              const selectionDirty =
                sel.size !== appliedSel.size ||
                Array.from(sel).some(id => !appliedSel.has(id));
              const dirty = filtersDirty || selectionDirty;
              const hasSelection = sel.size > 0;
              const awaiting = !!recipeModal.awaitingSuggest;
              const Row = ({ label, options, currentKey, onPick }) => (
                <div className="mb-2">
                  <p className="text-textSoft text-[10px] font-bold tracking-widest uppercase mb-1.5">{label}</p>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                    <button
                      type="button"
                      onClick={() => onPick(null)}
                      className={`px-2.5 py-1 rounded-full border text-xs font-semibold whitespace-nowrap flex-shrink-0 transition ${
                        currentKey === null
                          ? "bg-text text-white border-text"
                          : "bg-surface text-textSoft border-border hover:border-text/40"
                      }`}
                    >
                      Any
                    </button>
                    {options.map(opt => {
                      const active = currentKey === opt.key;
                      return (
                        <button
                          type="button"
                          key={String(opt.key)}
                          onClick={() => onPick(opt.key)}
                          className={`px-2.5 py-1 rounded-full border text-xs font-semibold whitespace-nowrap flex items-center gap-1 flex-shrink-0 transition ${
                            active
                              ? "bg-accent text-white border-accent"
                              : "bg-surface text-text border-border hover:border-accent/60"
                          }`}
                        >
                          {opt.emoji ? <span aria-hidden="true">{opt.emoji}</span> : null}
                          <span>{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
              return (
                <div className="pb-3 mb-3 border-b border-border">
                  <Row label="Cuisine" options={EMF_CUISINE_OPTIONS} currentKey={pendingFilters.cuisine}
                    onPick={k => setPendingFilters(p => ({ ...p, cuisine: k }))} />
                  <Row label="Protein" options={EMF_PROTEIN_OPTIONS} currentKey={pendingFilters.protein}
                    onPick={k => setPendingFilters(p => ({ ...p, protein: k }))} />
                  <Row label="Ingredients" options={EMF_MAX_INGREDIENTS_OPTIONS} currentKey={pendingFilters.maxIngredients}
                    onPick={k => setPendingFilters(p => ({ ...p, maxIngredients: k }))} />
                  {/* v1.26 #307 — In awaiting-suggest state, primary CTA is
                      "Suggest recipes" (disabled if no items selected). Once
                      recipes are loaded, "Update results" only appears if
                      filters changed since the last fetch. */}
                  {awaiting ? (
                    <button
                      type="button"
                      onClick={suggestFromSelection}
                      disabled={!hasSelection}
                      className={`mt-2 w-full py-2 rounded-lg text-white text-sm font-bold transition ${
                        hasSelection ? "bg-accent hover:opacity-90" : "bg-muted opacity-50 cursor-not-allowed"
                      }`}
                    >
                      {hasSelection ? `Suggest recipes using ${sel.size} ${sel.size === 1 ? "item" : "items"}` : "Pick at least one item"}
                    </button>
                  ) : dirty && (
                    <button
                      type="button"
                      onClick={() => hasSelection && fetchRecipes({
                        leadItem: (recipeModal.leadItem && sel.has(recipeModal.leadItem.id)) ? recipeModal.leadItem : null,
                        contextItems: (recipeModal.items || []).filter(i => sel.has(i.id)),
                        filters: pendingFilters,
                      })}
                      disabled={!hasSelection}
                      className={`mt-2 w-full py-2 rounded-lg text-white text-sm font-bold transition ${
                        hasSelection ? "bg-accent hover:opacity-90" : "bg-muted opacity-50 cursor-not-allowed"
                      }`}
                    >
                      {hasSelection ? "Update results" : "Pick at least one item"}
                    </button>
                  )}
                </div>
              );
            })()}

            <div className="space-y-3">
              {(recipeModal.recipes || []).map((r, i) => {
                const isSaved  = !!savedRowIds[i];
                const isSaving = savingIdx === i;
                const isAdding = addingIdx === i;
                return (
                  <div key={i} className="rounded-xl border border-border bg-bg p-4">
                    {/* Header row — emoji + name + meta on the left, Save + Add
                        buttons on the right. v1.22 #187 web parity — mirrors
                        the iOS recipe sheet's heart + action layout. */}
                    <div className="flex items-start gap-2 mb-2">
                      <div className="text-2xl flex-shrink-0">{r.emoji || "🍽️"}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-text font-bold">{r.name}</p>
                        <p className="text-textSoft text-xs mt-0.5">
                          {[r.time, r.difficulty].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      {/* v1.22 #240 — Share button. Sits LEFT of the heart
                          per the same convention as iOS App.js. Ephemeral
                          recipes (no recipe_bank slug) text-share the full
                          recipe content. */}
                      <button
                        onClick={() => shareRecipeFromCard(r)}
                        aria-label="Share recipe"
                        className="w-8 h-8 rounded-full bg-bg border border-border flex items-center justify-center flex-shrink-0 hover:opacity-80 transition"
                      >
                        <span aria-hidden="true" className="text-sm">📤</span>
                      </button>
                      <button
                        onClick={() => toggleSaveRecipe(r, i)}
                        disabled={isSaving}
                        aria-label={isSaved ? "Remove from saved" : "Save recipe"}
                        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition ${isSaved ? "bg-danger/15" : "bg-bg border border-border"} ${isSaving ? "opacity-50" : "hover:opacity-80"}`}
                      >
                        <span aria-hidden="true" className="text-base leading-none">{isSaved ? "♥" : "♡"}</span>
                      </button>
                    </div>
                    {r.description && (
                      <p className="text-textSoft text-sm mb-3">{r.description}</p>
                    )}
                    {Array.isArray(r.ingredients) && r.ingredients.length > 0 && (
                      <div className="mb-2">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-text text-xs font-bold">Ingredients</p>
                          <button
                            onClick={() => openAddToListModal(r, i)}
                            disabled={isAdding}
                            className={`text-xs font-semibold px-2.5 py-1 rounded-full bg-accent text-white transition ${isAdding ? "opacity-60" : "hover:opacity-90"}`}
                          >
                            {isAdding ? "Loading…" : "+ Add to list"}
                          </button>
                        </div>
                        <ul className="text-text text-sm space-y-0.5">
                          {r.ingredients.map((ing, j) => (
                            <li key={j}>• {ing.item}{ing.amount ? ` — ${ing.amount}` : ""}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {Array.isArray(r.instructions) && r.instructions.length > 0 && (
                      <div>
                        <p className="text-text text-xs font-bold mb-1">Instructions</p>
                        <ol className="text-text text-sm space-y-0.5 list-decimal pl-5">
                          {r.instructions.map((step, j) => <li key={j}>{step}</li>)}
                        </ol>
                      </div>
                    )}
                    {r.tip && (
                      <p className="text-accent text-xs mt-3 italic">💡 {r.tip}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* v1.22 #187 — floating toast for save / add-to-list confirmations.
                2.5-3s auto-dismiss handled by setTimeout in the handlers. */}
            {recipeToast && (
              <div className="mt-3 rounded-xl bg-text text-white text-sm font-semibold text-center py-2.5 px-4">
                {recipeToast}
              </div>
            )}

            <button
              onClick={() => setRecipeModal(null)}
              className="mt-4 w-full px-4 py-2 rounded-lg border border-border bg-card text-text text-sm font-semibold hover:bg-bg transition"
            >
              Close
            </button>
          </div>
        </Modal>
      )}

      {/* v1.22 #187 — Add-to-list picker. Stacks on top of the recipe
          modal when the user taps "+ Add to list" on a recipe card.
          Renders the destination-list dropdown + per-ingredient
          checkboxes, then confirms with a bulk insert. Mirrors iOS's
          InventoryMatchSheet pattern from v1.19. */}
      <Modal
        open={!!addToListState}
        onClose={() => !confirmingAdd && setAddToListState(null)}
        title="Add to shopping list"
        size="md"
      >
        {addToListState && (
          <div className="space-y-4">
            <div>
              <p className="text-textSoft text-xs font-bold tracking-widest uppercase mb-1.5">
                Add to list
              </p>
              {!addToListState.creatingList ? (
                <div className="flex items-center gap-2">
                  <select
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-bg text-text text-sm"
                    value={addToListState.listId || ""}
                    onChange={(e) =>
                      setAddToListState({ ...addToListState, listId: e.target.value })
                    }
                  >
                    {addToListState.lists.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setAddToListState({ ...addToListState, creatingList: true, newListName: "" })
                    }
                    className="text-xs font-semibold text-accent hover:opacity-80 whitespace-nowrap"
                  >
                    + New list
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    autoFocus
                    placeholder='e.g. "Costco trip" or "This week"'
                    value={addToListState.newListName}
                    onChange={(e) =>
                      setAddToListState({ ...addToListState, newListName: e.target.value })
                    }
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-bg text-text text-sm placeholder-textSoft/70"
                  />
                  {addToListState.lists.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setAddToListState({ ...addToListState, creatingList: false, newListName: "" })
                      }
                      className="text-xs font-semibold text-textSoft hover:text-text whitespace-nowrap"
                    >
                      Pick existing
                    </button>
                  )}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-textSoft text-xs font-bold tracking-widest uppercase">
                  Ingredients ({Object.values(addToListState.toggles).filter(Boolean).length}/{addToListState.ingredients.length})
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const all = {};
                      addToListState.ingredients.forEach((_, i) => { all[i] = true; });
                      setAddToListState({ ...addToListState, toggles: all });
                    }}
                    className="text-xs font-semibold text-accent hover:opacity-80"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const none = {};
                      addToListState.ingredients.forEach((_, i) => { none[i] = false; });
                      setAddToListState({ ...addToListState, toggles: none });
                    }}
                    className="text-xs font-semibold text-textSoft hover:text-text"
                  >
                    None
                  </button>
                </div>
              </div>
              <ul className="space-y-1.5 max-h-72 overflow-auto pr-1">
                {addToListState.ingredients.map((name, i) => {
                  const checked = !!addToListState.toggles[i];
                  return (
                    <li key={i}>
                      <label className="flex items-center gap-2 cursor-pointer py-1 px-1 rounded hover:bg-bg transition">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setAddToListState({
                              ...addToListState,
                              toggles: { ...addToListState.toggles, [i]: !checked },
                            })
                          }
                          className="w-4 h-4 accent-accent flex-shrink-0"
                        />
                        <span className={`text-sm ${checked ? "text-text" : "text-textSoft line-through"}`}>
                          {name}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAddToListState(null)}
                disabled={confirmingAdd}
                className="flex-1 px-4 py-2 rounded-lg border border-border bg-card text-text text-sm font-semibold hover:bg-bg transition disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAddToList}
                disabled={confirmingAdd || Object.values(addToListState.toggles).filter(Boolean).length === 0}
                className="flex-1 px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-60"
              >
                {confirmingAdd
                  ? "Adding…"
                  : `Add ${Object.values(addToListState.toggles).filter(Boolean).length} item${Object.values(addToListState.toggles).filter(Boolean).length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
