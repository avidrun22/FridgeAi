import { useEffect, useState } from "react";

// v1.16+ — Web parity with iOS ExpiryDateField (shipped iOS v1.1.0).
// Tappable date hint that flips into a native HTML5 date picker on click.
// Two-way bound with the parent's `days` prop: when the user picks a new
// date we compute days-from-today and call onDaysChange; when `days`
// changes from the stepper we re-derive the date display.
//
// Direct response to user feedback: "you should be able to put in an
// actual date instead of number of days till expiration."
//
// Web wins over iOS here: HTML5 `<input type="date">` opens the OS-native
// calendar picker (or browser-native fallback), which is way better UX
// than iOS's text-input approach.
export default function ExpiryDateField({ days, onDaysChange }) {
  const [editing, setEditing] = useState(false);

  // Derived YYYY-MM-DD from days. Recompute on each render so it tracks
  // the parent's `days` prop changes from the DayStepper.
  const targetDate = new Date(Date.now() + days * 86400000);
  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, "0");
  const dd = String(targetDate.getDate()).padStart(2, "0");
  const isoStr = `${yyyy}-${mm}-${dd}`;

  // Today's date in YYYY-MM-DD for `min` attribute — prevents picking the
  // past, which would give negative days and would be nonsensical for an
  // "expires on" picker.
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const [draft, setDraft] = useState(isoStr);

  // Friendly format for the hint: "May 4, 2026"
  const friendly = targetDate.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  // Keep draft in sync when parent `days` changes and we're not editing.
  useEffect(() => { if (!editing) setDraft(isoStr); }, [isoStr, editing]);

  function commit(value) {
    const v = (value ?? draft).trim();
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) { setDraft(isoStr); setEditing(false); return; }
    const picked = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(picked.getTime())) { setDraft(isoStr); setEditing(false); return; }
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    picked.setHours(0, 0, 0, 0);
    const diffDays = Math.round((picked.getTime() - t.getTime()) / 86400000);
    if (diffDays < 1) { setDraft(isoStr); setEditing(false); return; }
    onDaysChange?.(diffDays);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="-mt-1.5 mb-3 flex items-center gap-2">
        <span className="text-[11px] text-textSoft">Expires:</span>
        <input
          type="date"
          autoFocus
          value={draft}
          min={todayIso}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          // Pressing Enter doesn't fire onChange in some browsers; commit explicitly.
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
          className="text-xs text-text px-2 py-1 bg-card border border-border rounded-md focus:outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => { setDraft(isoStr); setEditing(false); }}
          className="text-[11px] text-muted hover:text-textSoft"
        >Cancel</button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(isoStr); setEditing(true); }}
      className="-mt-1.5 mb-3 self-start py-1 px-1.5 text-[11px] text-textSoft hover:text-text"
    >
      Goes bad {friendly}{" "}
      <span className="text-accent font-semibold">· tap to pick a date</span>
    </button>
  );
}
