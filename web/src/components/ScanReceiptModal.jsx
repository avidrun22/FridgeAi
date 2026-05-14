import { useEffect, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import { supabase } from "../lib/supabase.js";
import { track } from "../lib/analytics.js";
import {
  CATEGORIES, CATEGORY_EMOJI, CONTAINERS,
  EXPIRY_DAYS_BY_CATEGORY, OPENED_DAYS_MAP, isPackagedCategory,
  inferEmoji,
} from "../lib/constants.js";

// v1.16 — Receipt scan for the web app. Mirrors the iOS receipt-scan flow:
// user uploads a JPEG/PNG of a grocery receipt, the scan-receipt Edge
// Function returns parsed items, user reviews and edits, then we bulk insert
// into fridge_items. Uses the AUTHENTICATED scan-receipt function (10/day
// per user) — distinct from scan-receipt-public on the marketing site which
// is anonymous + IP-throttled.
//
// Two phases:
//   1. UPLOAD — file picker / drop zone, preview, "Scan" button
//   2. REVIEW — table of parsed items with category override + per-row delete,
//      shared container picker, then "Add all" bulk insert
//
// Errors during scan show inline; errors during insert show inline. Rate
// limit hits (429) surface the 10/day cap to the user.

const MAX_FILE_BYTES = 4_500_000; // 4.5 MB pre-encoding

// v1.16 — smart-default container for a parsed item. Mirrors the iOS
// defaultContainerFor in App.js. Rules in priority order:
//   1. Name says "frozen/ice cream/sorbet/etc." → freezer.
//   2. Produce that's typically pantry-stored (potato/onion/garlic) → pantry.
//   3. Dry Goods → pantry.
//   4. Everything else → fridge (safe default; user can override per row).
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

export default function ScanReceiptModal({ open, onClose, onAdded, householdId, defaultContainer = "fridge" }) {
  const fileRef = useRef(null);

  // Phase: "upload" → "review"
  const [phase, setPhase]             = useState("upload");
  const [file, setFile]               = useState(null);
  const [previewUrl, setPreviewUrl]   = useState(null);
  const [scanning, setScanning]       = useState(false);
  const [scanError, setScanError]     = useState(null);

  // Review-phase state
  const [items, setItems]             = useState([]); // [{name, quantity, category, expiry_days}]
  const [container, setContainer]     = useState(defaultContainer);
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState(null);

  useEffect(() => {
    if (open) {
      setPhase("upload");
      setFile(null);
      setPreviewUrl(null);
      setScanning(false);
      setScanError(null);
      setItems([]);
      setContainer(defaultContainer);
      setSaving(false);
      setSaveError(null);
    }
  }, [open, defaultContainer]);

  // Free the object URL when the file changes / modal closes
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function handleFile(f) {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setScanError("That doesn't look like an image. Try a JPEG or PNG of your receipt.");
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setScanError(`File is ${(f.size / 1_000_000).toFixed(1)} MB — please use one under 4 MB.`);
      return;
    }
    setScanError(null);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    track("web_app_scan_file_chosen", { size: f.size, type: f.type });
  }

  function handleDrop(e) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  async function fileToBase64(f) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(String(e.target.result).split(",")[1]);
      reader.onerror = () => reject(new Error("could not read file"));
      reader.readAsDataURL(f);
    });
  }

  async function handleScan() {
    if (!file || scanning) return;
    setScanning(true);
    setScanError(null);
    track("web_app_scan_started");
    try {
      const base64 = await fileToBase64(file);

      // Use supabase.functions.invoke so the JWT is attached automatically.
      const t0 = performance.now();
      const { data, error } = await supabase.functions.invoke("scan-receipt", {
        body: { image: base64 },
      });
      const ms = Math.round(performance.now() - t0);

      if (error) {
        // Functions invoke returns { error } on non-2xx
        const status = error?.context?.status;
        const json = await error?.context?.json?.().catch(() => ({}));
        if (status === 429) {
          setScanError(`Daily scan limit reached (${json?.limit || 10}/day). Try again tomorrow, or use the iOS app.`);
        } else {
          setScanError(json?.error || error?.message || "Couldn't parse your receipt. Try a clearer photo.");
        }
        track("web_app_scan_failed", { status, ms });
        setScanning(false);
        return;
      }

      const parsed = Array.isArray(data?.items) ? data.items : [];
      if (parsed.length === 0) {
        setScanError("We couldn't find any food items on that receipt. Try a clearer, fully-visible photo.");
        track("web_app_scan_zero_items", { ms });
        setScanning(false);
        return;
      }

      // Normalize each item — make category one of the known ones, force
      // expiry_days into a sensible range, default missing fields. v1.16 also
      // assigns a smart-default container based on category + name keywords
      // so a mixed receipt auto-splits across fridge/pantry/freezer.
      const normalized = parsed.map((it) => {
        const cat = CATEGORIES.includes(it?.category) ? it.category : "Other";
        const days = Number.isFinite(Number(it?.expiry_days))
          ? Math.max(1, Math.min(365, Math.round(Number(it.expiry_days))))
          : EXPIRY_DAYS_BY_CATEGORY[cat] || 7;
        const name = String(it?.name || "Unknown item").slice(0, 80);
        return {
          name,
          quantity: it?.quantity ? String(it.quantity).slice(0, 40) : "1",
          category: cat,
          expiry_days: days,
          container: defaultContainerFor(name, cat),
        };
      });

      setItems(normalized);
      setPhase("review");
      track("web_app_scan_completed", { item_count: normalized.length, ms });
    } catch (e) {
      track("web_app_scan_failed", { message: String(e?.message || "").slice(0, 80) });
      setScanError(e?.message || "Couldn't reach the scanner. Try again.");
    } finally {
      setScanning(false);
    }
  }

  function updateItem(idx, patch) {
    setItems(curr => curr.map((it, i) => i === idx ? { ...it, ...patch } : it));
  }
  function removeItem(idx) {
    setItems(curr => curr.filter((_, i) => i !== idx));
  }

  async function handleSaveAll() {
    if (items.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      let hhId = householdId;
      if (!hhId) {
        const { data, error } = await supabase.rpc("ensure_household_for_user");
        if (error) throw error;
        hhId = data;
      }
      const { data: { user } } = await supabase.auth.getUser();
      const now = new Date();

      // v1.16 — each row carries its own container (set by smart-default in
      // normalization or by user pill tap). Save uses per-row container, not
      // the modal-level state. Also persists the FoodKeeper-suggested days
      // as expiry_usda_date so ItemDetailModal can show the dual-date.
      const rows = items.map(it => {
        const itContainer = it.container || container || "fridge";
        const sectionMirror = itContainer === "pantry" ? "cupboard" : itContainer;
        const expiryDate = new Date(now.getTime() + it.expiry_days * 86_400_000).toISOString();
        const packaged = isPackagedCategory(it.category);
        // The Edge Function returns expiry_days derived from FoodKeeper for
        // the receipt scan. We treat that as the USDA snapshot; the visible
        // expiry can later be shortened by the user without losing this.
        const usdaDate = expiryDate.slice(0, 10);
        return {
          name: it.name,
          category: it.category,
          emoji: inferEmoji(it.name, CATEGORY_EMOJI[it.category] || "📦"),
          quantity: 1,
          unit: null,
          added_date: now.toISOString(),
          expiry_date: expiryDate,
          user_id: user.id,
          household_id: hhId,
          container: itContainer,
          section: sectionMirror,
          is_opened: false,
          opened_at: null,
          expiry_opened_days: packaged ? (OPENED_DAYS_MAP[it.category] || 7) : null,
          expiry_unopened: packaged ? expiryDate.slice(0, 10) : null,
          expiry_usda_date: usdaDate,
        };
      });

      const { data, error } = await supabase
        .from("fridge_items")
        .insert(rows)
        .select();
      if (error) throw error;

      track("item_added_bulk", { count: (data || []).length, source: "scan_receipt" });
      track("web_app_scan_saved", { count: (data || []).length });
      (data || []).forEach(row => onAdded?.(row));
      onClose?.();
    } catch (e) {
      track("item_add_failed", { source: "scan_receipt", message: String(e?.message || "").slice(0, 80) });
      setSaveError(e?.message || "Couldn't save items.");
      setSaving(false);
    }
  }

  // ---------- RENDER ----------
  return (
    <Modal open={open} onClose={onClose} title={phase === "upload" ? "Scan a receipt" : "Review items"} size="lg">
      {phase === "upload" && (
        <div className="space-y-3">
          {!previewUrl ? (
            <div
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition"
            >
              <div className="mx-auto w-12 h-12 rounded-xl bg-accent/15 flex items-center justify-center text-accent mb-3">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <p className="font-semibold text-text">Tap or drop a photo of your receipt</p>
              <p className="text-textSoft text-xs mt-1">JPEG or PNG · up to 4 MB</p>
              <p className="text-textSoft text-xs mt-1 opacity-80">10 free scans per day</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-3 items-center bg-card border border-border rounded-xl p-3">
                <img src={previewUrl} alt="Receipt preview" className="w-20 h-20 object-cover rounded-lg border border-border" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{file?.name || "receipt"}</p>
                  <p className="text-textSoft text-xs mt-0.5 font-mono">
                    {(file?.size / 1024).toFixed(0)} KB · {file?.type?.split("/")[1]?.toUpperCase()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setFile(null); setPreviewUrl(null); }}
                  disabled={scanning}
                  className="text-textSoft text-xs hover:text-text underline disabled:opacity-50"
                >Change</button>
              </div>
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/heic,image/webp"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />

          {scanError && <p className="text-sm text-danger">{scanError}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={scanning}
              className="px-5 py-2.5 rounded-full border border-border text-sm font-medium text-textSoft hover:bg-card disabled:opacity-50"
            >Cancel</button>
            <button
              type="button"
              onClick={handleScan}
              disabled={!file || scanning}
              className="flex-1 px-5 py-2.5 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {scanning ? (<><Spinner /> Reading receipt…</>) : "Scan receipt"}
            </button>
          </div>
        </div>
      )}

      {phase === "review" && (
        <div className="space-y-3">
          <p className="text-textSoft text-sm">
            Found <strong className="text-text">{items.length}</strong> {items.length === 1 ? "item" : "items"}. Containers are pre-assigned by category — tap to override per row, or bulk-move all below.
          </p>

          {/* v1.16 — bulk-move action chip. Single click sets every row's
              container, useful for "I just emptied the freezer haul" cases. */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-textSoft">Move all to:</span>
            {CONTAINERS.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setItems(curr => curr.map(it => ({ ...it, container: c.id })))}
                className="px-2.5 py-1 rounded-full border border-border bg-card text-textSoft hover:border-accent hover:text-accent transition"
              >→ {c.label}</button>
            ))}
          </div>

          <div className="max-h-[40vh] overflow-y-auto -mx-1 px-1 space-y-2">
            {items.map((it, i) => {
              const rowContainer = it.container || "fridge";
              return (
                <div key={i} className="bg-card border border-border rounded-lg px-3 py-2">
                  {/* Line 1: emoji + name + category + expiry days + remove */}
                  <div className="flex items-center gap-2">
                    <span className="text-lg flex-shrink-0">{inferEmoji(it.name, CATEGORY_EMOJI[it.category] || "📦")}</span>
                    <input
                      value={it.name}
                      onChange={(e) => updateItem(i, { name: e.target.value })}
                      className="flex-1 min-w-0 bg-transparent border-0 text-sm font-medium focus:outline-none focus:ring-0"
                    />
                    <select
                      value={it.category}
                      onChange={(e) => updateItem(i, { category: e.target.value, expiry_days: EXPIRY_DAYS_BY_CATEGORY[e.target.value] || it.expiry_days })}
                      className="text-xs bg-bg border border-border rounded-md px-1.5 py-1 focus:outline-none focus:border-accent flex-shrink-0"
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input
                      type="number"
                      min="1" max="365" step="1"
                      value={it.expiry_days}
                      onChange={(e) => updateItem(i, { expiry_days: Math.max(1, parseInt(e.target.value || "1", 10) || 1) })}
                      className="w-14 text-xs bg-bg border border-border rounded-md px-1.5 py-1 text-center focus:outline-none focus:border-accent flex-shrink-0"
                    />
                    <span className="text-xs text-textSoft flex-shrink-0">d</span>
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      className="text-textSoft hover:text-danger w-6 h-6 flex items-center justify-center flex-shrink-0"
                      aria-label="Remove item"
                    >×</button>
                  </div>
                  {/* Line 2: container pills — three equal-width tap targets */}
                  <div className="flex gap-1 mt-2">
                    {CONTAINERS.map(c => {
                      const selected = rowContainer === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => updateItem(i, { container: c.id })}
                          className={`flex-1 py-1 rounded-md text-xs font-medium border transition ${
                            selected
                              ? "bg-accent/10 border-accent text-accent"
                              : "bg-bg border-border text-textSoft hover:border-accent"
                          }`}
                          aria-pressed={selected}
                          aria-label={`Set container to ${c.label}`}
                        >{c.label}</button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {saveError && <p className="text-sm text-danger">{saveError}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setPhase("upload")}
              disabled={saving}
              className="px-5 py-2.5 rounded-full border border-border text-sm font-medium text-textSoft hover:bg-card disabled:opacity-50"
            >Back</button>
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={items.length === 0 || saving}
              className="flex-1 px-5 py-2.5 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? "Saving…" : `Add ${items.length} ${items.length === 1 ? "item" : "items"}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"
      aria-hidden="true"
    />
  );
}
