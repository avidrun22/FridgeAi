// Date + display helpers shared across screens. Mirrors what App.js does on
// iOS so behavior is identical — same expiry math, same color thresholds.

export function daysUntil(isoDate) {
  if (!isoDate) return Infinity;
  const target = new Date(isoDate);
  const now = new Date();
  // Day-precision math: zero-out time so "today" expiry counts as 0 days
  // instead of -0.4 because of clock drift.
  target.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

export function expiryColor(days) {
  if (days <= 1) return "#DC2626"; // danger
  if (days <= 3) return "#EA580C"; // warn
  return "#16A34A";                // accent
}

export function expiryLabel(days) {
  if (days <= 0) return "Expired";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${days} days`;
}

// "1 oz" / "1 dozen" / "1" — matches the iOS formatQty helper.
export function formatQty(item) {
  const q = item?.quantity;
  const u = (item?.unit || "").trim();
  if (q === undefined || q === null || q === "") return u || "—";
  return u ? `${q} ${u}` : String(q);
}

// Map a fridge_items row from Supabase into the shape the UI expects.
// Mirrors rowToItem in App.js, including the legacy section→container
// fallback for rows that pre-date the v1.0.8 backfill.
export function rowToItem(row) {
  const validContainers = ["fridge", "pantry", "freezer"];
  const container = row.container && validContainers.includes(row.container)
    ? row.container
    : (row.section === "cupboard" ? "pantry"
      : validContainers.includes(row.section) ? row.section
      : "fridge");
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    emoji: row.emoji,
    quantity: row.quantity,
    unit: row.unit || "",
    addedDate: row.added_date,
    expiryDate: row.expiry_date,
    barcode: row.barcode,
    container,
    section: row.section || "fridge",
    householdId: row.household_id || null,
    isOpened: row.is_opened || false,
    openedAt: row.opened_at || null,
    expiryOpenedDays: row.expiry_opened_days || null,
    expiryUnopened: row.expiry_unopened || null,
  };
}
