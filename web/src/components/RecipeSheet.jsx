import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { track } from "../lib/analytics.js";
import Modal from "./Modal.jsx";

// RecipeSheet — full-recipe modal with save/share/add-to-list actions.
//
// v1.22 #187 web parity port. Mirrors the iOS deep-link recipe sheet
// (App.js line ~8370): emoji + name + meta + ingredients (with amounts)
// + numbered instructions + tip, plus a header action row with Share
// (left of heart) and Heart (save/unsave).
//
// "+ Add to list" sits below the ingredients header. When tapped, the
// internal list-picker mode renders inline: destination-list dropdown
// + per-ingredient checkboxes + Confirm. Mirrors the iOS InventoryMatchSheet
// pattern; same flow we just shipped on the EatMeFirst recipe modal.
//
// Props:
//   recipe      — { id?, slug?, name, emoji?, time?, difficulty?, description?,
//                  ingredients: [{item,amount}], instructions: [string], tip? }
//   user        — current Supabase auth user (needed for save + add-to-list)
//   open        — boolean
//   onClose     — closes the sheet
//   initialSavedRowId — pre-load the heart as filled (caller knows the row id)
//   onSavedRowIdChange — fires after a successful save/unsave so the caller
//                  can update its local state without a re-fetch.
export default function RecipeSheet({
  recipe,
  user,
  open,
  onClose,
  initialSavedRowId = null,
  onSavedRowIdChange,
}) {
  const [savedRowId, setSavedRowId]   = useState(initialSavedRowId);
  const [savingHeart, setSavingHeart] = useState(false);
  const [toast, setToast]             = useState(null);

  // Add-to-list picker state. Same shape as EatMeFirst.
  // null = closed; object = open.
  const [addState, setAddState]       = useState(null);
  const [confirmingAdd, setConfirmingAdd] = useState(false);

  // Sync heart when caller's hint changes (e.g. user opens a different recipe).
  useEffect(() => {
    setSavedRowId(initialSavedRowId);
    setToast(null);
    setAddState(null);
  }, [initialSavedRowId, recipe?.id, recipe?.slug, recipe?.name]);

  if (!recipe) return null;

  const isSaved = !!savedRowId;
  const meta    = [recipe.time, recipe.difficulty, recipe.meal_type, recipe.cuisine]
    .filter(Boolean).join(" · ");

  // Bank recipes have a stable slug → shareable URL. Daily-cache and
  // AI-generated recipes don't, so Share is hidden for those.
  const shareableId   = recipe?.slug || (typeof recipe?.id === "string" && !/^\d{8}-/.test(recipe.id) ? recipe.id : null);
  const canShare      = !!shareableId;

  async function toggleSave() {
    if (!user?.id || savingHeart) return;
    setSavingHeart(true);
    try {
      if (savedRowId) {
        const { error } = await supabase
          .from("user_recipes_saved")
          .delete()
          .eq("id", savedRowId);
        if (error) throw error;
        setSavedRowId(null);
        onSavedRowIdChange?.(null);
        track("recipe_unsaved", { name: recipe?.name, source: "recipe_sheet" });
      } else {
        const { data, error } = await supabase
          .from("user_recipes_saved")
          .insert({
            user_id: user.id,
            source_recipe_id: recipe?.id || null,
            recipe_data: recipe,
          })
          .select("id")
          .single();
        if (error) throw error;
        setSavedRowId(data.id);
        onSavedRowIdChange?.(data.id);
        track("recipe_saved", { name: recipe?.name, source: "recipe_sheet" });
        setToast("Saved");
        setTimeout(() => setToast(null), 2000);
      }
    } catch (e) {
      console.warn("[recipe-sheet] toggleSave failed:", e?.message || e);
      setToast("Couldn't save. Try again.");
      setTimeout(() => setToast(null), 2500);
    } finally {
      setSavingHeart(false);
    }
  }

  async function shareRecipe() {
    if (!canShare) return;
    const url = `https://ok2eat.com/recipes/${encodeURIComponent(shareableId)}?utm_source=share&utm_medium=web_app&utm_campaign=recipe_share`;
    const shareData = {
      title: recipe.name,
      text:  `${recipe.name} — recipe from ok2eat`,
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        track("recipe_shared", { name: recipe?.name, recipe_id: shareableId, surface: "web_native" });
        return;
      }
    } catch (_e) {
      // user canceled — fall through to clipboard
    }
    try {
      await navigator.clipboard.writeText(url);
      track("recipe_shared", { name: recipe?.name, recipe_id: shareableId, surface: "web_clipboard" });
      setToast("Link copied");
      setTimeout(() => setToast(null), 2000);
    } catch (_e) {
      setToast("Couldn't copy link.");
      setTimeout(() => setToast(null), 2500);
    }
  }

  async function openAddToList() {
    if (!user?.id) return;
    if (!Array.isArray(recipe?.ingredients) || recipe.ingredients.length === 0) {
      setToast("Recipe has no ingredients.");
      setTimeout(() => setToast(null), 2500);
      return;
    }
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

      const ingredients = recipe.ingredients
        .map(ing => (typeof ing === "object" && ing !== null ? ing.item : ing))
        .filter(name => typeof name === "string" && name.trim().length > 0)
        .map(name => name.trim());

      const toggles = {};
      ingredients.forEach((_, i) => { toggles[i] = true; });

      setAddState({
        householdId: hh,
        lists: lists || [],
        ingredients,
        toggles,
        listId: (lists && lists[0]?.id) || null,
        newListName: "",
        creatingList: !(lists && lists[0]?.id),
      });
    } catch (e) {
      console.warn("[recipe-sheet] openAddToList failed:", e?.message || e);
      setToast("Couldn't load your lists.");
      setTimeout(() => setToast(null), 2500);
    }
  }

  async function confirmAdd() {
    if (!addState || confirmingAdd) return;
    const { householdId, lists, ingredients, toggles, listId, newListName, creatingList } = addState;

    const selected = ingredients.filter((_, i) => toggles[i]);
    if (selected.length === 0) {
      setToast("Pick at least one ingredient.");
      setTimeout(() => setToast(null), 2500);
      return;
    }

    setConfirmingAdd(true);
    try {
      let targetListId   = listId;
      let targetListName = null;
      if (creatingList || !targetListId) {
        const name = (newListName || "").trim() || "Shopping list";
        const { data: newList, error: createErr } = await supabase
          .from("shopping_lists")
          .insert({ household_id: householdId, name, created_by: user.id })
          .select("id, name")
          .single();
        if (createErr) throw createErr;
        targetListId   = newList.id;
        targetListName = newList.name;
      } else {
        targetListName = lists.find(l => l.id === targetListId)?.name || "list";
      }

      const rows = selected.map(name => ({
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
        recipe_name: recipe?.name,
        recipe_id: recipe?.id,
        target_list_id: targetListId,
        item_count: rows.length,
        source: "recipe_sheet",
        created_new_list: creatingList,
      });
      setToast(`Added ${rows.length} item${rows.length === 1 ? "" : "s"} to "${targetListName}"`);
      setTimeout(() => setToast(null), 3000);
      setAddState(null);
    } catch (e) {
      console.warn("[recipe-sheet] confirmAdd failed:", e?.message || e);
      setToast("Couldn't add to list. Try again.");
      setTimeout(() => setToast(null), 2500);
    } finally {
      setConfirmingAdd(false);
    }
  }

  const selectedCount = addState ? Object.values(addState.toggles).filter(Boolean).length : 0;

  return (
    <Modal open={open} onClose={onClose} title={null} size="lg">
      <div className="space-y-4">
        {/* Header — emoji + name + meta + share + heart + close */}
        <div className="flex items-start gap-3">
          <div className="text-3xl flex-shrink-0">{recipe.emoji || "🍽️"}</div>
          <div className="flex-1 min-w-0">
            <h2 className="text-text font-bold text-lg leading-tight">{recipe.name}</h2>
            {meta && (
              <p className="text-textSoft text-xs mt-1 font-mono uppercase tracking-wider">{meta}</p>
            )}
            {Array.isArray(recipe.dietary_tags) && recipe.dietary_tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {recipe.dietary_tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent/15 text-accent"
                  >
                    {String(tag).replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {canShare && (
              <button
                onClick={shareRecipe}
                className="w-8 h-8 rounded-full bg-bg border border-border flex items-center justify-center hover:opacity-80"
                aria-label="Share recipe"
              >
                <span aria-hidden="true" className="text-sm">📤</span>
              </button>
            )}
            {user?.id && (
              <button
                onClick={toggleSave}
                disabled={savingHeart}
                className={`w-8 h-8 rounded-full flex items-center justify-center ${isSaved ? "bg-danger/15" : "bg-bg border border-border"} ${savingHeart ? "opacity-50" : "hover:opacity-80"}`}
                aria-label={isSaved ? "Remove from saved" : "Save recipe"}
              >
                <span aria-hidden="true" className="text-base leading-none">{isSaved ? "♥" : "♡"}</span>
              </button>
            )}
          </div>
        </div>

        {recipe.description && (
          <p className="text-textSoft text-sm leading-relaxed">{recipe.description}</p>
        )}

        {/* Ingredients section with Add-to-list trigger */}
        {Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-textSoft text-xs font-bold tracking-widest uppercase">Ingredients</p>
              {user?.id && !addState && (
                <button
                  onClick={openAddToList}
                  className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent text-white hover:opacity-90 transition"
                >
                  + Add to list
                </button>
              )}
            </div>

            {addState ? (
              /* Picker mode (replaces the ingredients view inline). */
              <div className="space-y-3">
                <div>
                  <p className="text-textSoft text-[10px] font-bold tracking-widest uppercase mb-1.5">
                    Add to list
                  </p>
                  {!addState.creatingList ? (
                    <div className="flex items-center gap-2">
                      <select
                        className="flex-1 px-3 py-2 rounded-lg border border-border bg-bg text-text text-sm"
                        value={addState.listId || ""}
                        onChange={(e) => setAddState({ ...addState, listId: e.target.value })}
                      >
                        {addState.lists.map((l) => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setAddState({ ...addState, creatingList: true, newListName: "" })}
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
                        placeholder='e.g. "This week" or "Costco trip"'
                        value={addState.newListName}
                        onChange={(e) => setAddState({ ...addState, newListName: e.target.value })}
                        className="flex-1 px-3 py-2 rounded-lg border border-border bg-bg text-text text-sm placeholder-textSoft/70"
                      />
                      {addState.lists.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setAddState({ ...addState, creatingList: false, newListName: "" })}
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
                    <p className="text-textSoft text-[10px] font-bold tracking-widest uppercase">
                      Ingredients ({selectedCount}/{addState.ingredients.length})
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          const all = {};
                          addState.ingredients.forEach((_, i) => { all[i] = true; });
                          setAddState({ ...addState, toggles: all });
                        }}
                        className="text-xs font-semibold text-accent hover:opacity-80"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const none = {};
                          addState.ingredients.forEach((_, i) => { none[i] = false; });
                          setAddState({ ...addState, toggles: none });
                        }}
                        className="text-xs font-semibold text-textSoft hover:text-text"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <ul className="space-y-1 max-h-56 overflow-auto pr-1">
                    {addState.ingredients.map((name, i) => {
                      const checked = !!addState.toggles[i];
                      return (
                        <li key={i}>
                          <label className="flex items-center gap-2 cursor-pointer py-1 px-1 rounded hover:bg-bg transition">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setAddState({ ...addState, toggles: { ...addState.toggles, [i]: !checked } })}
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

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setAddState(null)}
                    disabled={confirmingAdd}
                    className="flex-1 px-4 py-2 rounded-lg border border-border bg-card text-text text-sm font-semibold hover:bg-bg transition disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmAdd}
                    disabled={confirmingAdd || selectedCount === 0}
                    className="flex-1 px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-60"
                  >
                    {confirmingAdd ? "Adding…" : `Add ${selectedCount} item${selectedCount === 1 ? "" : "s"}`}
                  </button>
                </div>
              </div>
            ) : (
              <ul className="text-text text-sm space-y-0.5">
                {recipe.ingredients.map((ing, j) => {
                  const item = typeof ing === "object" && ing !== null ? ing.item : ing;
                  const amount = typeof ing === "object" && ing !== null ? ing.amount : null;
                  return (
                    <li key={j}>• {item}{amount ? <span className="text-textSoft"> — {amount}</span> : null}</li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Instructions */}
        {Array.isArray(recipe.instructions) && recipe.instructions.length > 0 && !addState && (
          <div>
            <p className="text-textSoft text-xs font-bold tracking-widest uppercase mb-2">Instructions</p>
            <ol className="text-text text-sm space-y-1.5 list-decimal pl-5">
              {recipe.instructions.map((step, j) => <li key={j}>{step}</li>)}
            </ol>
          </div>
        )}

        {recipe.tip && !addState && (
          <div className="rounded-xl bg-accent/10 p-3">
            <p className="text-accent text-sm italic leading-relaxed">💡 {recipe.tip}</p>
          </div>
        )}

        {/* Floating toast pinned at the bottom of the sheet. */}
        {toast && (
          <div className="rounded-xl bg-text text-white text-sm font-semibold text-center py-2.5 px-4">
            {toast}
          </div>
        )}
      </div>
    </Modal>
  );
}
