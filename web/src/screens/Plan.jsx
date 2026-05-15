import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { RETAILERS } from "../lib/constants.js";
import { track } from "../lib/analytics.js";
import Modal from "../components/Modal.jsx";
import Layout from "../components/Layout.jsx";

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
          {/* v1.21 — subtitle was "Recipes from your fridge · shopping list"
              but the recipes half was removed when the external AllRecipes /
              NYT / Epicurious links got dropped (iOS dropped them in v1.18,
              #169). Native recipe browser (v1.19) hasn't been ported to web
              yet (#187 Phase 3 — in progress). Until that lands, the page is
              shopping-list-only so the subtitle should reflect that. */}
          <p className="text-textSoft text-sm mt-0.5">Build a shopping list — share it with whoever&apos;s at the store</p>
        </div>

        {err && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger mb-4">
            {err}
          </div>
        )}

        {/* ─── Recipe ideas removed v1.21 ──────────────────────────────────────
            iOS dropped the external AllRecipes/NYT/Epicurious search links in
            v1.18 (#169) when native recipes shipped in the daily digest +
            in-app recipe sheet. The web copy lingered as a stale parity gap.
            Full native Recipes UI (recipe_bank browser + inventory match) is
            #187 v1.20 web parity. Leaving Plan as shopping-list-only here is
            the right interim — same state iOS was in pre-v1.19. */}

        {/* ─── Shopping lists ───────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3 gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <h2 className="text-[11px] font-bold tracking-widest text-textSoft uppercase truncate">
                {showPicker ? "Shopping Lists" : `// ${(activeList?.name || "shopping list").toUpperCase()}`}
              </h2>
              {/* v1.21 #215 — Share button positioned right next to the
                  list name (per Greg, 2026-05-15) and styled like the
                  prominent solid-green "Order N items" button so it
                  reads as a primary action, not a sidekick to the text
                  links on the right. The text links (Clear checked /
                  ← All lists / + New list) stay on the right as before. */}
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
      </>
    </Layout>
  );
}
