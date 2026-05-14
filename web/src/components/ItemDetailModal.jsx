import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import { supabase } from "../lib/supabase.js";
import { track } from "../lib/analytics.js";
import {
  CATEGORIES, CATEGORY_EMOJI, CONTAINERS, UNIT_OPTIONS, isPackagedCategory,
  inferEmoji,
} from "../lib/constants.js";
import { daysUntil, expiryColor, expiryLabel, formatQty } from "../lib/helpers.js";

// View / edit / delete a single item. Mark used (decrement quantity, or
// delete when quantity goes to 0). Mark as opened (for packaged items —
// recalculates expiry from opened-days).
export default function ItemDetailModal({ open, onClose, item, onUpdated, onRemoved }) {
  const [editing, setEditing] = useState(false);
  const [name, setName]         = useState("");
  const [category, setCategory] = useState("Other");
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit]         = useState("");
  const [container, setContainer] = useState("fridge");
  const [expiryDate, setExpiryDate] = useState("");
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState(null);
  // "Use this item" inline form — opens when user taps Use, asks for how
  // many units they used (in the item's unit, e.g. "oz"). Defaults to 1.
  const [useOpen, setUseOpen] = useState(false);
  const [useAmount, setUseAmount] = useState(1);

  useEffect(() => {
    if (item) {
      setName(item.name || "");
      setCategory(item.category || "Other");
      setQuantity(item.quantity || 1);
      setUnit(item.unit || "");
      setContainer(item.container || "fridge");
      setExpiryDate(item.expiryDate ? item.expiryDate.slice(0, 10) : "");
      setEditing(false); setErr(null); setBusy(false);
      setUseOpen(false); setUseAmount(1);
    }
  }, [item]);

  if (!item) return null;
  const days = daysUntil(item.expiryDate);
  const color = expiryColor(days);

  async function patch(updates) {
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase
        .from("fridge_items")
        .update(updates)
        .eq("id", item.id)
        .select()
        .single();
      if (error) throw error;
      onUpdated?.(data);
      return data;
    } catch (e) {
      setErr(e?.message || "Couldn't save changes.");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdits() {
    if (!name.trim()) return;
    const sectionMirror = container === "pantry" ? "cupboard" : container;
    try {
      await patch({
        name: name.trim(),
        category,
        // v1.19 — upgrade to inferred emoji on save (mirrors iOS App.js).
        emoji: inferEmoji(name.trim(), CATEGORY_EMOJI[category] || item.emoji),
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        unit: unit || null,
        container,
        section: sectionMirror,
        expiry_date: expiryDate ? new Date(expiryDate).toISOString() : item.expiryDate,
      });
      setEditing(false);
    } catch {}
  }

  async function handleDelete() {
    if (!window.confirm(`Remove ${item.name} from your fridge? This can't be undone.`)) return;
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.from("fridge_items").delete().eq("id", item.id);
      if (error) throw error;
      track("item_deleted", { category: item.category, days_until: daysUntil(item.expiryDate) });
      onRemoved?.(item.id);
      onClose?.();
    } catch (e) {
      setErr(e?.message || "Couldn't delete item.");
      setBusy(false);
    }
  }

  async function handleUseAmount(amount) {
    // amount is how many units the user just consumed. If it equals or
    // exceeds the current quantity, delete the row entirely.
    const used = Number.isFinite(amount) && amount > 0 ? amount : 1;
    const remaining = (item.quantity || 1) - used;
    if (remaining <= 0) {
      setBusy(true); setErr(null);
      try {
        const { error } = await supabase.from("fridge_items").delete().eq("id", item.id);
        if (error) throw error;
        track("item_used", { fully_used: true, category: item.category });
        onRemoved?.(item.id);
        onClose?.();
      } catch (e) {
        setErr(e?.message || "Couldn't update item.");
        setBusy(false);
      }
      return;
    }
    track("item_used", { fully_used: false, amount: used, category: item.category });
    try {
      await patch({ quantity: remaining });
      setUseOpen(false);
    } catch {}
  }

  async function handleMarkOpened() {
    if (!item.expiryOpenedDays) return;
    const newExpiry = new Date(Date.now() + item.expiryOpenedDays * 86400000).toISOString();
    try {
      await patch({
        is_opened: true,
        opened_at: new Date().toISOString(),
        expiry_date: newExpiry,
      });
    } catch {}
  }

  async function handleUndoOpen() {
    if (!item.expiryUnopened) return;
    try {
      await patch({
        is_opened: false,
        opened_at: null,
        expiry_date: new Date(item.expiryUnopened).toISOString(),
      });
    } catch {}
  }

  const packaged = isPackagedCategory(item.category);

  return (
    <Modal open={open} onClose={onClose} title="Item" size="md">
      <div className="space-y-4">
        <div className="text-center">
          <div className="text-6xl mb-2">{inferEmoji(editing ? name : item.name, CATEGORY_EMOJI[item.category] || item.emoji || "📦")}</div>
          {editing ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-center text-xl font-bold rounded-lg border border-border bg-card px-3 py-2"
            />
          ) : (
            <h3 className="text-xl font-bold text-text">{item.name}</h3>
          )}
          <p className="inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: color + "22", color }}>
            {expiryLabel(days)}
          </p>
          {/* v1.16 — dual-date display. When USDA's window is at least 2 days
              longer than the user's committed expiry, surface the gap. This
              is the "you can stop trashing yogurt that's fine" moment from
              Email 4 tip 4. Hidden when usdaDate is missing or roughly equal. */}
          {(() => {
            if (!item.expiryUsdaDate || !item.expiryDate) return null;
            const usdaMs = new Date(item.expiryUsdaDate).getTime();
            const expMs  = new Date(item.expiryDate).getTime();
            if (!Number.isFinite(usdaMs) || !Number.isFinite(expMs)) return null;
            const gapDays = Math.round((usdaMs - expMs) / 86_400_000);
            if (gapDays < 2) return null;
            const usdaTotal = Math.max(0, Math.round((usdaMs - Date.now()) / 86_400_000));
            return (
              <p className="mt-2 inline-block px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "rgba(22,163,74,0.08)", color: "#16a34a", border: "1px solid rgba(22,163,74,0.2)" }}>
                🌿 USDA shelf life: {usdaTotal} {usdaTotal === 1 ? "day" : "days"} ({gapDays}+ longer than your date)
              </p>
            );
          })()}
        </div>

        {!editing && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-textSoft uppercase tracking-wide">Quantity</p>
              <p className="text-text font-medium">{formatQty(item)}</p>
            </div>
            <div>
              <p className="text-xs text-textSoft uppercase tracking-wide">Category</p>
              <p className="text-text font-medium">{item.category}</p>
            </div>
            <div>
              <p className="text-xs text-textSoft uppercase tracking-wide">Container</p>
              <p className="text-text font-medium">{CONTAINERS.find(c => c.id === item.container)?.label || "Fridge"}</p>
            </div>
            <div>
              <p className="text-xs text-textSoft uppercase tracking-wide">Status</p>
              <p className="text-text font-medium">
                {packaged ? (item.isOpened ? "Opened" : "Sealed") : "Fresh"}
              </p>
            </div>
          </div>
        )}

        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-textSoft mb-1 font-medium uppercase tracking-wide">Amount</label>
                <input
                  type="number" min="1" step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(parseInt(e.target.value || "0", 10) || 1)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-textSoft mb-1 font-medium uppercase tracking-wide">Unit</label>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
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
                    key={c} type="button" onClick={() => setCategory(c)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                      category === c
                        ? "bg-accent/10 border-accent text-accent"
                        : "bg-card border-border text-textSoft hover:border-accent"
                    }`}
                  >{CATEGORY_EMOJI[c]} {c}</button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-textSoft mb-1.5 font-medium uppercase tracking-wide">Container</label>
              <div className="flex gap-2">
                {CONTAINERS.map(c => (
                  <button
                    key={c.id} type="button" onClick={() => setContainer(c.id)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition ${
                      container === c.id
                        ? "bg-accent/10 border-accent text-accent"
                        : "bg-card border-border text-textSoft hover:border-accent"
                    }`}
                  >{c.label}</button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-textSoft mb-1 font-medium uppercase tracking-wide">Expires</label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              />
            </div>
          </div>
        )}

        {err && <p className="text-sm text-danger">{err}</p>}

        {!editing && (
          <div className="space-y-2 pt-2">
            {!useOpen && (
              <button
                onClick={() => { setUseAmount(1); setUseOpen(true); }}
                disabled={busy}
                className="w-full px-4 py-2.5 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-50"
              >
                Use this item
              </button>
            )}

            {useOpen && (
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-xs text-textSoft mb-2">
                  How {item.unit ? `many ${item.unit}` : "much"} did you use? You have {formatQty(item)}.
                </p>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="number" min="1" max={item.quantity || 1} step="1" autoFocus
                    value={useAmount}
                    onChange={(e) => setUseAmount(parseInt(e.target.value || "0", 10) || 1)}
                    className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
                  />
                  {item.unit && <span className="text-sm text-textSoft px-1">{item.unit}</span>}
                  <button
                    onClick={() => handleUseAmount(useAmount)}
                    disabled={busy || useAmount < 1}
                    className="px-4 py-2 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-50"
                  >Use</button>
                </div>
                <div className="flex gap-3 justify-between text-xs">
                  <button
                    onClick={() => handleUseAmount(item.quantity || 1)}
                    disabled={busy}
                    className="text-accent font-medium hover:underline"
                  >Use it all</button>
                  <button
                    onClick={() => setUseOpen(false)}
                    className="text-textSoft hover:underline"
                  >Cancel</button>
                </div>
              </div>
            )}

            {packaged && !item.isOpened && item.expiryOpenedDays && (
              <button
                onClick={handleMarkOpened}
                disabled={busy}
                className="w-full px-4 py-2.5 rounded-full border border-accent text-accent text-sm font-semibold hover:bg-accent/10 disabled:opacity-50"
              >
                Mark as opened (lasts {item.expiryOpenedDays} more days)
              </button>
            )}

            {packaged && item.isOpened && item.expiryUnopened && (
              <button
                onClick={handleUndoOpen}
                disabled={busy}
                className="w-full px-4 py-2.5 rounded-full border border-border text-textSoft text-sm font-medium hover:bg-card disabled:opacity-50"
              >
                Undo "opened" (restore sealed expiry)
              </button>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setEditing(true)}
                className="flex-1 px-4 py-2.5 rounded-full border border-border text-textSoft text-sm font-medium hover:bg-card"
              >Edit</button>
              <button
                onClick={handleDelete}
                disabled={busy}
                className="px-4 py-2.5 rounded-full border border-danger/40 text-danger text-sm font-medium hover:bg-danger/10 disabled:opacity-50"
              >Delete</button>
            </div>
          </div>
        )}

        {editing && (
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => setEditing(false)}
              className="px-5 py-2.5 rounded-full border border-border text-sm font-medium text-textSoft hover:bg-card"
            >Cancel</button>
            <button
              onClick={handleSaveEdits}
              disabled={busy || !name.trim()}
              className="flex-1 px-5 py-2.5 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
