import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { RETAILERS } from "../lib/constants.js";
import Modal from "../components/Modal.jsx";
import Layout from "../components/Layout.jsx";

// Round 4 — Plan tab. Mirrors the iOS PlanScreen behavior at parity:
//  - Recipe search links (AllRecipes / NYT Cooking / Epicurious) seeded from
//    the most-recent fridge_items.
//  - Multiple shopping lists per household (shopping_lists table + list_id FK
//    on shopping_list_items) — matches iOS v1.1.0 schema.
//  - Per-list view with check/uncheck, single-item add, clear-checked,
//    archive-list.
//  - "Order N items" retailer picker (Instacart, Amazon, Walmart) that opens
//    the chosen retailer with all unchecked items pre-loaded into search.
//
// Deferred to a follow-up commit:
//  - Bulk add (paste multiple items at once)
//  - Recently-added chips
//  - Past lists / clone archived list
//  - Checked items collapse to bottom
//  - Realtime sync between household members
export default function Plan({ user }) {
  const [householdId, setHouseholdId] = useState(null);
  const [lists, setLists] = useState([]);            // active lists
  const [activeListId, setActiveListId] = useState(null);
  const [items, setItems] = useState([]);
  const [adding, setAdding] = useState("");
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [err, setErr] = useState(null);

  // New-list dialog
  const [showCreateList, setShowCreateList] = useState(false);
  const [newListName, setNewListName] = useState("");

  // Order retailer picker
  const [showOrderPicker, setShowOrderPicker] = useState(false);

  // Fridge items for the recipe-links seed.
  const [fridgeItems, setFridgeItems] = useState([]);

  async function loadEverything() {
    try {
      setErr(null);
      const { data: hh, error: hhErr } = await supabase.rpc("ensure_household_for_user");
      if (hhErr) throw hhErr;
      setHouseholdId(hh);

      const { data: l, error: lErr } = await supabase
        .from("shopping_lists")
        .select("id, name, archived_at, created_at")
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
    } catch (e) {
      setErr(e?.message || "Couldn't load lists.");
    } finally {
      setLoadingLists(false);
    }
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
    } catch (e) {
      setItems(prev => prev.filter(i => i.id !== tempId));
      setErr(e?.message || "Couldn't add item.");
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

  // ─── Recipe seed ────────────────────────────────────────────────────────────
  // Top 3 most-recent fresh items become the recipe search query. Mirrors the
  // iOS logic.
  const recipeIngredients = (fridgeItems || [])
    .map(i => i.name)
    .filter(Boolean)
    .slice(0, 3);
  const recipeQuery = recipeIngredients.join(" ").trim();
  const recipeSources = recipeQuery ? [
    { label: "AllRecipes",  url: `https://www.allrecipes.com/search?q=${encodeURIComponent(recipeQuery)}` },
    { label: "NYT Cooking", url: `https://cooking.nytimes.com/search?q=${encodeURIComponent(recipeQuery)}` },
    { label: "Epicurious",  url: `https://www.epicurious.com/search/${encodeURIComponent(recipeQuery)}` },
  ] : [];

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

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <Layout user={user}>
      <>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text tracking-tight">Plan</h1>
          <p className="text-textSoft text-sm mt-0.5">Recipes from your fridge · shopping list</p>
        </div>

        {err && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger mb-4">
            {err}
          </div>
        )}

        {/* ─── Recipe ideas ─────────────────────────────────────────────────── */}
        <section className="mb-8">
          <h2 className="text-[11px] font-bold tracking-widest text-textSoft uppercase mb-3">Recipe Ideas</h2>
          {recipeSources.length > 0 ? (
            <>
              <p className="text-xs text-textSoft mb-2">
                Based on {recipeIngredients.join(", ")}
              </p>
              <div className="space-y-2">
                {recipeSources.map(src => (
                  <a
                    key={src.label}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl border border-border bg-card p-4 hover:border-accent/60 transition"
                  >
                    <p className="text-text font-semibold text-sm">{src.label}</p>
                    <p className="text-textSoft text-xs mt-0.5">Search results for your fridge →</p>
                  </a>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-textSoft text-sm">
                Add some items to your fridge and we'll suggest recipes based on what you have.
              </p>
            </div>
          )}
        </section>

        {/* ─── Shopping lists ───────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-bold tracking-widest text-textSoft uppercase">
              {showPicker ? "Shopping Lists" : `// ${(activeList?.name || "shopping list").toUpperCase()}`}
            </h2>
            <div className="flex items-center gap-3">
              {!showPicker && lists.length > 1 && (
                <button onClick={() => setActiveListId(null)} className="text-xs text-textSoft hover:text-accent">
                  ← All lists
                </button>
              )}
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
          ) : (
            <>
              {loadingList ? (
                <div className="rounded-xl border border-border bg-card p-4 text-sm text-textSoft">Loading…</div>
              ) : items.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-4 text-sm text-textSoft">
                  Nothing on the list yet. Add an item below.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {items.map(item => (
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
                  ))}
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
      </>
    </Layout>
  );
}
