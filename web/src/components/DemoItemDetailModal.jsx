import { Link } from "react-router-dom";
import Modal from "./Modal.jsx";
import { CATEGORY_EMOJI, CONTAINERS, inferEmoji } from "../lib/constants.js";
import { daysUntil, expiryColor, expiryLabel, formatQty } from "../lib/helpers.js";

// DemoItemDetailModal — read-only view of a single demo item.
//
// Why this exists: visitors who only see the Eat Me First list don't
// understand the DEPTH of what ok2eat tracks per item — quantity, unit,
// category, container, expiry date, opened/sealed status. Showing that
// detail page paints a clearer picture of what they'd get with a real
// account. The Edit / Use / Delete / Mark-opened actions from the
// authenticated ItemDetailModal are stripped — every "do something to
// this item" button drops out, replaced with a single sign-up CTA.
//
// Visual structure intentionally mirrors ItemDetailModal's view mode
// (big emoji + name + urgency pill + 2x2 detail grid) so demo visitors
// see EXACTLY what authenticated users see, minus the editing chrome.

// Helper — pretty-print a YYYY-MM-DD ISO date as "May 15, 2026" style,
// matching what a logged-in user sees in their fridge.
function formatLongDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function DemoItemDetailModal({ open, onClose, item }) {
  if (!item) return null;
  const days = daysUntil(item.expiryDate);
  const color = expiryColor(days);
  const containerLabel = CONTAINERS.find(c => c.id === item.container)?.label || "Fridge";

  return (
    <Modal open={open} onClose={onClose} title="Item details" size="md">
      <div className="space-y-5">
        {/* Hero — same shape as the real ItemDetailModal so demo visitors
            see the authentic layout. */}
        <div className="text-center">
          <div className="text-6xl mb-2">
            {inferEmoji(item.name, CATEGORY_EMOJI[item.category] || item.emoji || "📦")}
          </div>
          <h3 className="text-xl font-bold text-text">{item.name}</h3>
          <p
            className="inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold"
            style={{ background: color + "22", color }}
          >
            {expiryLabel(days)}
          </p>
        </div>

        {/* 2x2 grid mirrors the authenticated view exactly. Quantity,
            Category, Container, Status — these are the four fields a
            real user sees the moment they tap an item. */}
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
            <p className="text-text font-medium">{containerLabel}</p>
          </div>
          <div>
            <p className="text-xs text-textSoft uppercase tracking-wide">Status</p>
            <p className="text-text font-medium">
              {item.isOpened ? "Opened" : "Sealed"}
            </p>
          </div>
          {/* Full-width rows below the grid — added/expiry dates need
              more room than the 2-column layout allows. */}
          <div className="col-span-2">
            <p className="text-xs text-textSoft uppercase tracking-wide">Added</p>
            <p className="text-text font-medium">{formatLongDate(item.addedDate)}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs text-textSoft uppercase tracking-wide">Expires</p>
            <p className="text-text font-medium">{formatLongDate(item.expiryDate)}</p>
          </div>
        </div>

        {/* What the real app does with this data. Sells the depth without
            burying it in feature copy. */}
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
          <p className="text-text text-sm font-semibold mb-2">What ok2eat does with this</p>
          <ul className="text-textSoft text-xs space-y-1">
            <li>• Ranks every item by urgency, so the soonest-to-spoil bubbles to the top.</li>
            <li>• Pulls a per-item shelf life from USDA FoodKeeper data — 950+ foods.</li>
            <li>• Suggests recipes that use what's about to expire together.</li>
            <li>• Tracks opened/sealed status — opened milk recalculates from its opened date.</li>
          </ul>
        </div>

        <div className="space-y-2">
          <Link
            to="/"
            onClick={onClose}
            className="block w-full text-center rounded-full bg-accent text-white text-sm font-semibold py-2.5 hover:opacity-90 transition"
          >
            Sign up to add your own items
          </Link>
          <button
            onClick={onClose}
            className="block w-full text-center rounded-full border border-border bg-card text-text text-sm font-semibold py-2.5 hover:bg-bg transition"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
