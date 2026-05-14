import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import { supabase } from "../lib/supabase.js";
import { track } from "../lib/analytics.js";
import {
  CATEGORIES, CATEGORY_EMOJI, CONTAINERS,
  EXPIRY_DAYS_BY_CATEGORY, OPENED_DAYS_MAP, isPackagedCategory,
  inferEmoji,
} from "../lib/constants.js";

// v1.16 — Bulk-add for fridge items. Mirrors the iOS BulkAddModal pattern:
// user pastes/types one item per line, picks a default category + container
// + expiry days for the batch, hits Save → all rows insert with the same
// defaults. Faster than the single-item flow when restocking after a
// grocery run. Per-item category override is a future enhancement.
export default function BulkAddItemsModal({ open, onClose, onAdded, householdId, defaultContainer = "fridge" }) {
  const [text, setText]               = useState("");
  const [category, setCategory]       = useState("Other");
  const [container, setContainer]     = useState(defaultContainer);
  const [closedDays, setClosedDays]   = useState(EXPIRY_DAYS_BY_CATEGORY.Other);
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState(null);

  useEffect(() => {
    if (open) {
      setText("");
      setCategory("Other"); setContainer(defaultContainer);
      setClosedDays(EXPIRY_DAYS_BY_CATEGORY.Other);
      setSaving(false); setErr(null);
    }
  }, [open, defaultContainer]);

  function pickCategory(c) {
    setCategory(c);
    setClosedDays(EXPIRY_DAYS_BY_CATEGORY[c] || 7);
  }

  // Parse the textarea on \n, trim, drop empties.
  const names = (text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  async function handleSave() {
    if (names.length === 0 || saving) return;
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
      const openedDays = OPENED_DAYS_MAP[category] || 7;
      const { data: { user } } = await supabase.auth.getUser();

      const rows = names.map(name => ({
        name,
        category,
        emoji: inferEmoji(name, CATEGORY_EMOJI[category] || "📦"),
        quantity: 1,
        unit: null,
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
      }));
      const { data, error } = await supabase
        .from("fridge_items")
        .insert(rows)
        .select();
      if (error) throw error;
      track("item_added_bulk", { count: (data || []).length, category, container });
      (data || []).forEach(row => onAdded?.(row));
      onClose?.();
    } catch (e) {
      track("item_add_failed", { source: "bulk", message: String(e?.message || "").slice(0, 80) });
      setErr(e?.message || "Couldn't save items.");
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add multiple items" size="md">
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-textSoft mb-1 font-medium uppercase tracking-wide">
            Items (one per line)
          </label>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"eggs\nmilk\nbread\navocados\nyogurt"}
            rows={7}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:border-accent font-mono"
          />
          <p className="text-textSoft text-xs mt-1">
            {names.length === 0
              ? "Paste or type items above. Same category + expiry will apply to all."
              : `${names.length} ${names.length === 1 ? "item" : "items"} ready to add.`}
          </p>
        </div>

        <div>
          <label className="block text-xs text-textSoft mb-1.5 font-medium uppercase tracking-wide">
            Category (applied to all)
          </label>
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
          <label className="block text-xs text-textSoft mb-1.5 font-medium uppercase tracking-wide">
            Container
          </label>
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

        <div>
          <label className="block text-xs text-textSoft mb-1 font-medium uppercase tracking-wide">
            Lasts (days from today)
          </label>
          <input
            type="number" min="1" max="365" step="1"
            value={closedDays}
            onChange={(e) => setClosedDays(parseInt(e.target.value || "1", 10) || 1)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
        </div>

        {err && <p className="text-sm text-danger">{err}</p>}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-full border border-border text-sm font-medium text-textSoft hover:bg-card"
          >Cancel</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={names.length === 0 || saving}
            className="flex-1 px-5 py-2.5 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-50"
          >
            {saving ? "Adding…" : `Add ${names.length || ""} ${names.length === 1 ? "item" : "items"}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
