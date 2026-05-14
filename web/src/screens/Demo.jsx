import { useEffect, useRef, useState } from "react";
import { daysUntil } from "../lib/helpers.js";
import { CATEGORY_EMOJI, inferEmoji } from "../lib/constants.js";
import { track } from "../lib/analytics.js";
import { DEMO_ITEMS, DEMO_RECIPES_TOP5, DEMO_RECIPES_BY_LEAD } from "../lib/demoData.js";
import DemoLayout from "../components/DemoLayout.jsx";
import Modal from "../components/Modal.jsx";
import SignupPromptModal from "../components/SignupPromptModal.jsx";
import AddDemoItemModal from "../components/AddDemoItemModal.jsx";

// Demo screen — v1.20 no-auth onboarding.
//
// Stripped-down clone of EatMeFirst.jsx that uses hard-coded demo data
// instead of fetching from Supabase. Reuses the same urgencyScore() math
// + urgencyBadge() pills + recipe modal layout so the demo IS the product,
// not a marketing mock-up.
//
// Conversion moments — every save/add action opens SignupPromptModal:
//   * "Add to shopping list" inside the recipe sheet
//   * "Save recipe" inside the recipe sheet
//   * "+ Add item" (we don't even render the button, but if we ever do)
//
// View + tap + browse actions are free — no friction on the parts of the
// product that demonstrate value.

function urgencyScore(item) {
  const d = daysUntil(item.expiryDate);
  if (d <= 0) return -1000 + d;
  const spoil = {
    Produce: -0.5,
    Dairy:   -0.4,
    Protein: -0.3,
    Bakery:  -0.2,
    Frozen:   0.5,
    "Dry goods": 0.8,
    Beverages: 0.2,
  }[item.category] ?? 0;
  return d + spoil;
}

function urgencyBadge(days) {
  if (days <= 0)  return { text: "Expired",            color: "#DC2626", bg: "#FEE2E2" };
  if (days === 1) return { text: "Expires tomorrow",   color: "#DC2626", bg: "#FEE2E2" };
  if (days <= 3)  return { text: `${days} days left`,  color: "#EA580C", bg: "#FFEDD5" };
  if (days <= 7)  return { text: `${days} days left`,  color: "#CA8A04", bg: "#FEF9C3" };
  return            { text: `${days} days left`,  color: "#16A34A", bg: "#DCFCE7" };
}

export default function Demo() {
  // v1.20 — items live in state so "Add by hand" can prepend new rows
  // and the urgency ranking re-sorts in real time. Initial value is
  // the 5 hard-coded demo items.
  const [items, setItems]             = useState(DEMO_ITEMS);
  const [recipeModal, setRecipeModal] = useState(null); // {leadItem, items, recipes}
  const [promptOpen, setPromptOpen]   = useState(false);
  const [promptReason, setPromptReason] = useState("default");
  const [addOpen, setAddOpen]         = useState(false);

  // Same sort + cap as the real Eat Me First.
  const ranked = items
    .filter(i => daysUntil(i.expiryDate) <= 14)
    .sort((a, b) => urgencyScore(a) - urgencyScore(b));

  const expiredCount = ranked.filter(i => daysUntil(i.expiryDate) <= 0).length;
  const soonCount    = ranked.filter(i => {
    const d = daysUntil(i.expiryDate);
    return d > 0 && d <= 3;
  }).length;

  // Fire a single "demo_viewed" event on mount so we can measure
  // demo → signup conversion in PostHog. Same instrumentation pattern as
  // EatMeFirst's viewedRef guard.
  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) return;
    track("demo_viewed", {
      surface: "web",
      total_items: ranked.length,
      expired_count: expiredCount,
      expiring_soon_count: soonCount,
    });
    viewedRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openRecipesForLead(leadItem) {
    const context = ranked.filter(i => i.id !== leadItem.id).slice(0, 4);
    const recipes = DEMO_RECIPES_BY_LEAD[leadItem.id] || DEMO_RECIPES_TOP5.slice(0, 2);
    track("demo_recipes_opened", {
      mode: "single_item",
      lead_item: leadItem.name,
      context_count: context.length,
    });
    setRecipeModal({ leadItem, items: context, recipes });
  }

  function openTop5() {
    const recipes = DEMO_RECIPES_TOP5;
    track("demo_recipes_opened", {
      mode: "top_5",
      context_count: Math.min(ranked.length, 5),
    });
    setRecipeModal({ leadItem: null, items: ranked.slice(0, 5), recipes });
  }

  function triggerSignupPrompt(reason) {
    track("demo_signup_prompt_shown", { reason });
    setPromptReason(reason);
    setPromptOpen(true);
  }

  // v1.20 — Real add. No API call, no Supabase write. The new row goes
  // straight into local state and re-sorts the ranking — so visitors
  // see their item slot in by urgency. Refresh drops it (we tell them).
  function handleAddDemoItem(newItem) {
    track("demo_item_added", { name: newItem.name, category: newItem.category });
    setItems(prev => [newItem, ...prev]);
  }

  return (
    <DemoLayout>
      {/* Hero — frames the demo so visitors don't think this is a sample
          screenshot. "This is the live app, with a fake fridge" is the
          subtext. */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text tracking-tight">Eat me first</h1>
        <p className="text-textSoft text-sm mt-0.5">
          {ranked.length} items ranked by urgency
          {expiredCount + soonCount > 0
            ? ` · ${expiredCount} expired · ${soonCount} expiring within 3 days`
            : ""}
        </p>
      </div>

      {/* v1.20 — "Add your own items" tiles. ORDER MATTERS: Add-by-hand
          on the LEFT because it's the no-auth-wall option — visitors
          who tap it get an immediate hit ("I added kale, it slotted
          into the ranking") with zero friction. Scan-receipt on the
          right gates on signup because real receipt scans cost Anthropic
          tokens per call and can fail, which tanks conversion. Putting
          the friction-free option first means a visitor's first tap
          gives them a win, not a wall. */}
      <div className="mb-5">
        <p className="text-textSoft text-xs mb-2 uppercase tracking-wide font-semibold">
          Add your own items
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => { track("demo_add_by_hand_opened"); setAddOpen(true); }}
            className="rounded-xl border-2 border-dashed border-accent/40 bg-accent/5 hover:bg-accent/10 hover:border-accent transition p-4 text-left"
          >
            <div className="text-2xl mb-1">✏️</div>
            <p className="text-text font-semibold text-sm">Add by hand</p>
            <p className="text-textSoft text-xs mt-0.5">
              Type an item — see it slot into the urgency ranking.
            </p>
          </button>
          <button
            onClick={() => triggerSignupPrompt("scan_receipt")}
            className="rounded-xl border-2 border-dashed border-border bg-card hover:bg-bg hover:border-accent/40 transition p-4 text-left"
          >
            <div className="text-2xl mb-1">📸</div>
            <p className="text-text font-semibold text-sm">Scan a receipt</p>
            <p className="text-textSoft text-xs mt-0.5">
              Snap your grocery slip — we fill your fridge in seconds.
            </p>
          </button>
        </div>
      </div>

      {/* Top-5-together CTA — exact same component shape as the real
          Eat Me First, intentionally. */}
      {ranked.length >= 3 && (
        <div className="mb-5 rounded-xl border border-accent/30 bg-accent/5 p-4 flex items-center gap-3">
          <div className="text-2xl">🍳</div>
          <div className="flex-1 min-w-0">
            <p className="text-text font-semibold text-sm">
              Cook with your top 5 expiring items together
            </p>
            <p className="text-textSoft text-xs mt-0.5">
              We'll suggest 3 recipes that use as many of them as possible.
            </p>
          </div>
          <button
            onClick={openTop5}
            className="px-3 py-1.5 rounded-full bg-accent text-white text-xs font-semibold hover:opacity-90 transition flex-shrink-0"
          >
            Suggest recipes
          </button>
        </div>
      )}

      <div className="space-y-2">
        {ranked.map((item, idx) => {
          const days = daysUntil(item.expiryDate);
          const badge = urgencyBadge(days);
          return (
            <div
              key={item.id}
              className="rounded-xl border border-border bg-card p-3 flex items-center gap-3"
            >
              <div className="w-7 text-center text-textSoft text-xs font-bold flex-shrink-0">
                {idx + 1}
              </div>
              <div className="w-10 h-10 rounded-lg bg-bg flex items-center justify-center text-xl flex-shrink-0">
                {inferEmoji(item.name, item.emoji || CATEGORY_EMOJI[item.category] || "📦")}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-text font-semibold truncate">{item.name}</p>
                <p className="text-textSoft text-xs mt-0.5">{item.category}</p>
              </div>
              <span
                className="text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap"
                style={{ color: badge.color, backgroundColor: badge.bg }}
              >
                {badge.text}
              </span>
              <button
                onClick={() => openRecipesForLead(item)}
                className="px-3 py-1.5 rounded-full bg-accent/10 text-accent text-xs font-semibold hover:bg-accent hover:text-white transition whitespace-nowrap flex-shrink-0"
              >
                Get recipes
              </button>
            </div>
          );
        })}
      </div>

      {/* Bottom CTA — second exit ramp after the user has scrolled all
          the way through the demo. Greg's brand voice: benefit-led, not
          feature-led. "Ready to start saving" hits the wallet-pain that
          drives most signups. Receipt-scan mentioned only — no barcode
          (web app doesn't support it). */}
      <div className="mt-8 rounded-xl border border-accent/30 bg-accent/5 p-6 text-center">
        <p className="text-text font-bold text-base mb-1">Ready to start saving?</p>
        <p className="text-textSoft text-sm mb-4">
          Snap a receipt and we'll rank what's actually in your kitchen —
          and tell you what to cook tonight before it spoils.
        </p>
        <a
          href="/"
          className="inline-block px-5 py-2.5 rounded-full bg-accent text-white text-sm font-semibold hover:opacity-90 transition"
        >
          Create your free account
        </a>
        <p className="text-xs text-muted mt-3">
          Magic-link sign-in · no password to remember
        </p>
      </div>

      {/* Recipe modal — identical layout to EatMeFirst's modal, but the
          Save / Add-to-list buttons trigger SignupPromptModal instead of
          calling Supabase. */}
      {recipeModal && (
        <Modal
          open={true}
          onClose={() => setRecipeModal(null)}
          size="lg"
          title={recipeModal.leadItem
            ? `Recipes using ${recipeModal.leadItem.name}`
            : "Recipes for your top expiring items"}
        >
          <div className="max-h-[75vh] overflow-y-auto">
            <p className="text-textSoft text-sm mb-4">
              Using: {[recipeModal.leadItem?.name, ...recipeModal.items.map(i => i.name)]
                .filter(Boolean).join(", ")}
            </p>

            <div className="space-y-3">
              {recipeModal.recipes.map((r, i) => (
                <div key={r.id || i} className="rounded-xl border border-border bg-bg p-4">
                  <div className="flex items-start gap-2 mb-2">
                    <div className="text-2xl flex-shrink-0">{r.emoji || "🍽️"}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-text font-bold">{r.name}</p>
                      <p className="text-textSoft text-xs mt-0.5">
                        {[r.time, r.difficulty].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                  {r.description && (
                    <p className="text-textSoft text-sm mb-3">{r.description}</p>
                  )}
                  {Array.isArray(r.ingredients) && r.ingredients.length > 0 && (
                    <div className="mb-2">
                      <p className="text-text text-xs font-bold mb-1">Ingredients</p>
                      <ul className="text-text text-sm space-y-0.5">
                        {r.ingredients.map((ing, j) => (
                          <li key={j}>• {ing.item}{ing.amount ? ` — ${ing.amount}` : ""}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Array.isArray(r.instructions) && r.instructions.length > 0 && (
                    <div className="mb-3">
                      <p className="text-text text-xs font-bold mb-1">Instructions</p>
                      <ol className="text-text text-sm space-y-0.5 list-decimal pl-5">
                        {r.instructions.map((step, j) => <li key={j}>{step}</li>)}
                      </ol>
                    </div>
                  )}
                  {r.tip && (
                    <p className="text-accent text-xs mb-3 italic">💡 {r.tip}</p>
                  )}

                  {/* Conversion-action row. Both buttons trip the signup
                      prompt — view-only is free, save-anything requires
                      an account. */}
                  <div className="flex gap-2 pt-3 border-t border-border">
                    <button
                      onClick={() => triggerSignupPrompt("add_to_list")}
                      className="flex-1 px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90 transition"
                    >
                      Add missing ingredients to shopping list
                    </button>
                    <button
                      onClick={() => triggerSignupPrompt("save_recipe")}
                      className="px-3 py-2 rounded-lg border border-border bg-card text-text text-xs font-semibold hover:bg-bg transition"
                    >
                      ♥ Save
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setRecipeModal(null)}
              className="mt-4 w-full px-4 py-2 rounded-lg border border-border bg-card text-text text-sm font-semibold hover:bg-bg transition"
            >
              Close
            </button>
          </div>
        </Modal>
      )}

      <SignupPromptModal
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        reason={promptReason}
      />
      <AddDemoItemModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={handleAddDemoItem}
      />
    </DemoLayout>
  );
}
