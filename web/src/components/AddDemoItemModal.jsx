import { useState } from "react";
import Modal from "./Modal.jsx";
import { inferEmoji } from "../lib/constants.js";

// AddDemoItemModal — lets demo visitors add an item to the in-memory
// demo fridge so they get the "I added an item, it slotted into the
// ranking" experience without needing an account.
//
// Zero cost: no API call, no Supabase write, no Anthropic. The item
// lives in React state and disappears on refresh — which we tell the
// user explicitly, so the disappearing isn't a confusing bug. The
// real upsell happens at conversion gates that DO have cost (scan a
// receipt) or that require persistence (add-to-list, save-recipe).
//
// Shelf life: default 5 days. We don't hit Supabase for FoodKeeper
// lookup because that'd require an anon-readable RLS policy on the
// shelf_life table — easier to just default and let the urgency
// ranking still make sense.

// Category inference from name. Mirrors the FOOD_EMOJI_RULES groupings
// in constants.js but maps to the 5 demo-relevant categories. Keeps
// urgencyScore()'s spoil weighting honest (Produce sinks, Dry goods
// floats) so the new row lands in roughly the right place in the
// ranking.
function inferCategory(name) {
  const lower = name.toLowerCase();
  if (/\b(milk|cream|yogurt|cheese|butter|kefir|buttermilk|ricotta|cottage)\b/.test(lower)) return "Dairy";
  if (/\b(salmon|chicken|turkey|beef|pork|bacon|fish|shrimp|tuna|cod|egg|tofu|tempeh|lamb|sausage|steak|ground)\b/.test(lower)) return "Protein";
  if (/\b(apple|banana|orange|berry|strawberr|spinach|kale|tomato|onion|garlic|carrot|cilantro|parsley|basil|herb|lettuce|cucumber|pepper|broccoli|cabbage|grape|lemon|lime|avocado|mushroom|celery|potato)\b/.test(lower)) return "Produce";
  if (/\b(rice|pasta|flour|sugar|cereal|oat|bean|lentil|chickpea|noodle|cracker|chip|nut|peanut|almond)\b/.test(lower)) return "Dry goods";
  return "Other";
}

export default function AddDemoItemModal({ open, onClose, onAdd }) {
  const [name, setName] = useState("");

  function submit(e) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    // Build a demo item in the same shape rowToItem() produces. 5-day
    // default expiry; smart emoji from name; inferred category.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(today);
    expiry.setDate(today.getDate() + 5);
    const category = inferCategory(clean);
    onAdd({
      id: `demo-added-${Date.now()}`,
      name: clean,
      category,
      emoji: inferEmoji(clean, "📦"),
      quantity: 1,
      unit: "",
      addedDate: today.toISOString().slice(0, 10),
      expiryDate: expiry.toISOString().slice(0, 10),
      container: "fridge",
      section: "fridge",
      isOpened: false,
    });
    setName("");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} size="sm" title="Add an item">
      <p className="text-textSoft text-sm mb-4">
        Type any food. We'll guess an emoji, pick a category, and slot it
        into the urgency ranking. In the real app we pull a precise shelf
        life from USDA FoodKeeper — for the demo we'll use a 5-day default.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <input
          type="text"
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Greek yogurt, ciabatta, kale"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-card focus:outline-none focus:border-accent"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            className="flex-1 px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition"
          >
            Add to demo fridge
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border bg-card text-text text-sm font-semibold hover:bg-bg transition"
          >
            Cancel
          </button>
        </div>
      </form>
      <p className="text-center text-xs text-muted mt-4 leading-relaxed">
        This won't save when you reload. Sign up to keep your fridge between
        sessions and pull real expiry dates from USDA data.
      </p>
    </Modal>
  );
}
