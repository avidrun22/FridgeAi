import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import DayStepper from "./DayStepper.jsx";
import ExpiryDateField from "./ExpiryDateField.jsx";
import { supabase } from "../lib/supabase.js";
import { track } from "../lib/analytics.js";
import {
  CATEGORIES, CATEGORY_EMOJI, CONTAINERS,
  EXPIRY_DAYS_BY_CATEGORY, OPENED_DAYS_MAP, isPackagedCategory, UNIT_OPTIONS,
} from "../lib/constants.js";

// Mirror of the iOS AddModal: name + amount + unit + category +
// editable closed-expiry, plus opened-shelf-life for packaged categories.
// v1.16: type-ahead search dropdown via the searchable_products catalog
// (~855K US-locale OFF rows). User types in the name field, picks a result,
// and the form auto-populates name + category + emoji + expiry default.
// Default-to-closed semantics. Writes via Supabase (same fields the iOS
// dbAddItem writes), and the parent gets an `onAdded(row)` callback to
// merge the new item into local state.
export default function AddItemModal({ open, onClose, onAdded, householdId, defaultContainer = "fridge" }) {
  const [name, setName]         = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit]         = useState("");
  const [category, setCategory] = useState("Other");
  const [container, setContainer] = useState(defaultContainer);
  const [closedDays, setClosedDays] = useState(EXPIRY_DAYS_BY_CATEGORY.Other);
  const [openedDays, setOpenedDays] = useState(OPENED_DAYS_MAP.Other);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState(null);
  // v1.16 Phase 1 — type-ahead search results from the local product catalog.
  // suppressSearch flips to true when user picks a result, so the next
  // setName() doesn't immediately re-fire the search.
  const [searchResults, setSearchResults]   = useState([]);
  const [searching, setSearching]           = useState(false);
  const [suppressSearch, setSuppressSearch] = useState(false);

  // Reset when re-opened so we don't carry stale state from a prior add.
  useEffect(() => {
    if (open) {
      setName(""); setQuantity(1); setUnit("");
      setCategory("Other"); setContainer(defaultContainer);
      setClosedDays(EXPIRY_DAYS_BY_CATEGORY.Other);
      setOpenedDays(OPENED_DAYS_MAP.Other || 7);
      setSaving(false); setErr(null);
      setSearchResults([]); setSearching(false); setSuppressSearch(false);
    }
  }, [open, defaultContainer]);

  // Debounced product search (300ms). Skips queries < 2 chars and the
  // post-pick re-render where suppressSearch is briefly true.
  useEffect(() => {
    if (!open) return;
    if (suppressSearch) { setSuppressSearch(false); return; }
    const trimmed = (name || "").trim();
    if (trimmed.length < 2) { setSearchResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc("search_products", {
          query: trimmed,
          result_limit: 5,
        });
        if (cancelled) return;
        setSearchResults(error ? [] : (data || []));
      } catch (_) {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [name, open]);

  function pickCategory(c) {
    setCategory(c);
    setClosedDays(EXPIRY_DAYS_BY_CATEGORY[c] || 7);
    setOpenedDays(OPENED_DAYS_MAP[c] || 7);
  }

  // v1.16 — picking a search result populates the form with the result's
  // name + category + emoji + expiry default. Clears the dropdown and
  // suppresses the next search-fire so we don't re-query for the just-
  // picked name.
  function handlePickResult(result) {
    const cat = (result.category && CATEGORIES.includes(result.category)) ? result.category : "Other";
    setSuppressSearch(true);
    setName(result.name || "");
    setCategory(cat);
    setClosedDays(EXPIRY_DAYS_BY_CATEGORY[cat] || 7);
    setOpenedDays(OPENED_DAYS_MAP[cat] || 7);
    setSearchResults([]);
  }

  async function handleSave(e) {
    e?.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true); setErr(null);

    try {
      let hhId = householdId;
      if (!hhId) {
        const { data, error } = await supabase.rpc("ensure_household_for_user");
        if (error) throw error;
        hhId = data;
      }

      const expiryIso = new Date(Date.now() + closedDays * 86400000).toISOString();
      const packaged = isPackagedCategory(category);
      const sectionMirror = container === "pantry" ? "cupboard" : container;

      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("fridge_items")
        .insert({
          name: name.trim(),
          category,
          emoji: CATEGORY_EMOJI[category] || "📦",
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
          unit: unit || null,
          added_date: new Date().toISOString(),
          expiry_date: expiryIso,
          user_id: user.id,
          household_id: hhId,
          container,
          section: sectionMirror,
          is_opened: false,
          opened_at: null,
          expiry_opened_days: packaged ? openedDays : null,
          expiry_unopened: packaged ? expiryIso.slice(0, 10) : null,
        })
        .select()
        .single();
      if (error) throw error;

      track("item_added_manual", { category, container });
      onAdded?.(data);
      onClose?.();
    } catch (e) {
      track("item_add_failed", { category, message: String(e?.message || "").slice(0, 80) });
      setErr(e?.message || "Couldn't save item.");
      setSaving(false);
    }
  }

  const packaged = isPackagedCategory(category);

  return (
    <Modal open={open} onClose={onClose} title="Add item" size="md">
      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label className="block text-xs text-textSoft mb-1 font-medium uppercase tracking-wide">Item name</label>
          <input
            autoFocus required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Start typing — we'll search 800K+ products…"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />

          {/* v1.16 — type-ahead results from the local product catalog. */}
          {(searching || searchResults.length > 0) && (
            <div className="mt-1 rounded-lg border border-border bg-card overflow-hidden">
              {searching && searchResults.length === 0 && (
                <div className="px-3 py-2 flex items-center gap-2 text-xs text-textSoft">
                  <span className="inline-block w-3 h-3 rounded-full border-2 border-textSoft border-t-transparent animate-spin"></span>
                  Searching products…
                </div>
              )}
              {searchResults.map((r, idx) => (
                <button
                  key={r.id || `${r.source}-${idx}`}
                  type="button"
                  onClick={() => handlePickResult(r)}
                  className={`w-full flex items-center gap-3 px-3 py-2 hover:bg-accent/5 text-left transition ${
                    idx > 0 ? "border-t border-border" : ""
                  }`}
                >
                  <div className="w-8 h-8 rounded bg-bg flex items-center justify-center text-base flex-shrink-0">
                    {r.emoji || CATEGORY_EMOJI[r.category] || "📦"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text truncate">{r.name}</p>
                    <p className="text-xs text-textSoft truncate">
                      {[r.brand, r.category].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="text-accent text-sm font-bold">+</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-textSoft mb-1 font-medium uppercase tracking-wide">Amount</label>
            <input
              type="number" min="1" step="1"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value || "0", 10) || 1)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-textSoft mb-1 font-medium uppercase tracking-wide">Unit</label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:border-accent"
            >
              {UNIT_OPTIONS.map(u => <option key={u || "none"} value={u}>{u || "— (no unit)"}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-textSoft mb-1.5 font-medium uppercase tracking-wide">Category</label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => pickCategory(c)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                  category === c
                    ? "bg-accent/10 border-accent text-accent"
                    : "bg-card border-border text-textSoft hover:border-accent"
                }`}
              >
                {CATEGORY_EMOJI[c]} {c}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-textSoft mb-1.5 font-medium uppercase tracking-wide">Container</label>
          <div className="flex gap-2">
            {CONTAINERS.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setContainer(c.id)}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition ${
                  container === c.id
                    ? "bg-accent/10 border-accent text-accent"
                    : "bg-card border-border text-textSoft hover:border-accent"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <DayStepper
          value={closedDays}
          onChange={setClosedDays}
          min={1}
          label={packaged ? "Lasts (unopened)" : "Lasts"}
          suffix="days from today"
        />
        {/* v1.16+ — date-picker hint, parity with iOS ExpiryDateField.
            Two-way bound with closedDays via the ExpiryDateField component. */}
        <ExpiryDateField days={closedDays} onDaysChange={setClosedDays} />

        {packaged && (
          <DayStepper
            value={openedDays}
            onChange={setOpenedDays}
            min={1}
            label="Once opened, lasts"
            suffix="more days"
          />
        )}

        <p className="text-xs text-muted">
          {packaged
            ? "Item starts as unopened. Mark it opened later to switch to the shorter shelf life."
            : "Fresh items don't change after opening — same expiry either way."}
        </p>

        {err && <p className="text-sm text-danger">{err}</p>}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-full border border-border text-sm font-medium text-textSoft hover:bg-card"
          >Cancel</button>
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="flex-1 px-5 py-2.5 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add to fridge"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
