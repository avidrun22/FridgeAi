import { useEffect, useRef, useState } from "react";
import { daysUntil, formatQty } from "../lib/helpers.js";
import { CATEGORY_EMOJI, inferEmoji } from "../lib/constants.js";
import { track } from "../lib/analytics.js";
import { getDemoItems, DEMO_RECIPES_TOP5, DEMO_RECIPES_BY_LEAD } from "../lib/demoData.js";
import DemoLayout from "../components/DemoLayout.jsx";
import Modal from "../components/Modal.jsx";
import SignupPromptModal from "../components/SignupPromptModal.jsx";
import AddDemoItemModal from "../components/AddDemoItemModal.jsx";
import DemoItemDetailModal from "../components/DemoItemDetailModal.jsx";
import DemoShoppingListModal from "../components/DemoShoppingListModal.jsx";

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
  // computed at mount so dates roll forward each day (see #217 fix
  // in demoData.js — the prior static array baked dates into the JS
  // bundle, causing items to drift into "Expired" as the bundle aged).
  const [items, setItems]             = useState(() => getDemoItems());
  const [recipeModal, setRecipeModal] = useState(null); // {leadItem, items, recipes}
  const [promptOpen, setPromptOpen]   = useState(false);
  const [promptReason, setPromptReason] = useState("default");
  const [addOpen, setAddOpen]         = useState(false);
  // v1.20 — clicking an item row opens a read-only details modal showing
  // the full per-item field set (quantity, unit, category, container,
  // dates, opened status). Sells the product's depth without forcing the
  // visitor to sign up to see it.
  const [detailItem, setDetailItem]   = useState(null);
  // v1.20 #216 — Demo shopping list lives in local state so visitors can
  // build it freely without an account. The signup gate moved from
  // "add to list" → "save/share the list" (much higher intent moment).
  // Each row: { recipeName, item, amount } — preserving the source so
  // the list view groups items under the recipe they came from.
  const [demoShoppingList, setDemoShoppingList] = useState([]);
  const [listOpen, setListOpen]       = useState(false);
  // Tiny ephemeral toast confirming "Added N items" after each add.
  const [addedToast, setAddedToast]   = useState(null);

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

  // v1.20 #216 — Adding a recipe's missing ingredients to the shopping
  // list. NO LONGER GATES ON SIGNUP — visitors build freely; signup is
  // gated at save/share instead. Simple "missing" heuristic: an
  // ingredient is missing if no current fridge item's name contains
  // (or is contained in) the ingredient's first word. Substring-only,
  // case-insensitive — good enough for a 5-item demo.
  function handleAddRecipeToList(recipe) {
    const fridgeNames = items.map(i => i.name.toLowerCase());
    const missing = (recipe.ingredients || []).filter(ing => {
      const token = (ing.item || "").toLowerCase().split(/\s+/)[0];
      if (!token) return false;
      return !fridgeNames.some(n => n.includes(token) || token.includes(n.split(/\s+/)[0]));
    });
    if (missing.length === 0) {
      setAddedToast("You already have everything for this recipe.");
      setTimeout(() => setAddedToast(null), 2500);
      return;
    }
    track("demo_list_items_added", {
      recipe_name: recipe.name,
      missing_count: missing.length,
      total_ingredients: (recipe.ingredients || []).length,
    });
    setDemoShoppingList(prev => [
      ...prev,
      ...missing.map(ing => ({
        recipeName: recipe.name,
        item: ing.item,
        amount: ing.amount || "",
      })),
    ]);
    setAddedToast(`Added ${missing.length} ${missing.length === 1 ? "item" : "items"} from ${recipe.name}.`);
    setTimeout(() => setAddedToast(null), 2500);
  }

  // v1.20 #216 — Save + Share are the new conversion gates. Each fires
  // a SignupPromptModal with bespoke copy (see SignupPromptModal.jsx
  // reasons map).
  function handleSaveList() {
    track("demo_list_save_tapped", { item_count: demoShoppingList.length });
    setListOpen(false);
    triggerSignupPrompt("save_list");
  }
  function handleShareList() {
    track("demo_list_share_tapped", { item_count: demoShoppingList.length });
    setListOpen(false);
    triggerSignupPrompt("share_list");
  }
  function handleClearList() {
    track("demo_list_cleared", { item_count: demoShoppingList.length });
    setDemoShoppingList([]);
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
            // v1.20 — Whole row is clickable: tapping it opens the
            // read-only DemoItemDetailModal so visitors can see the
            // full per-item field set (quantity, unit, category,
            // container, expiry date, opened status). Get-recipes
            // button stops propagation so it keeps its existing
            // recipe-modal behavior.
            <div
              key={item.id}
              onClick={() => {
                track("demo_item_detail_opened", { name: item.name, category: item.category });
                setDetailItem(item);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setDetailItem(item);
                }
              }}
              role="button"
              tabIndex={0}
              className="rounded-xl border border-border bg-card p-3 flex items-center gap-3 cursor-pointer hover:border-accent/40 hover:bg-accent/[0.03] transition"
            >
              <div className="w-7 text-center text-textSoft text-xs font-bold flex-shrink-0">
                {idx + 1}
              </div>
              <div className="w-10 h-10 rounded-lg bg-bg flex items-center justify-center text-xl flex-shrink-0">
                {inferEmoji(item.name, item.emoji || CATEGORY_EMOJI[item.category] || "📦")}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-text font-semibold truncate">{item.name}</p>
                {/* v1.20 — Show category + quantity on the meta line so
                    the row reflects what they'll see in the detail
                    modal. Matches the "Produce · 1 bunch" pattern from
                    the homepage mockup. Skip the qty suffix when the
                    item has no unit (avoids awkward "Produce · 1"). */}
                <p className="text-textSoft text-xs mt-0.5 truncate">
                  {item.category}{item.unit ? ` · ${formatQty(item)}` : ""}
                </p>
              </div>
              {/* v1.20 — Stack urgency badge above the "Get recipes" button.
                  Mirrors the iOS Eat Me First row, which sacrifices a bit of
                  horizontal density to keep item names from truncating to
                  "Who..." on narrow viewports. Right column now sizes to
                  max(badge, button) instead of badge + button. */}
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                <span
                  className="text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap"
                  style={{ color: badge.color, backgroundColor: badge.bg }}
                >
                  {badge.text}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); openRecipesForLead(item); }}
                  className="px-3 py-1.5 rounded-full bg-accent/10 text-accent text-xs font-semibold hover:bg-accent hover:text-white transition whitespace-nowrap"
                >
                  Get recipes
                </button>
              </div>
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

                  {/* v1.20 #216 — Add-to-list is now FREE (builds the
                      local demo shopping list); Save-recipe still gates
                      on signup because saved-recipes persistence requires
                      an account. The save/share gates fire when the
                      visitor opens the list modal and taps either of
                      those buttons. */}
                  <div className="flex gap-2 pt-3 border-t border-border">
                    <button
                      onClick={() => handleAddRecipeToList(r)}
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
      <DemoItemDetailModal
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
        item={detailItem}
      />
      <DemoShoppingListModal
        open={listOpen}
        onClose={() => setListOpen(false)}
        items={demoShoppingList}
        onClear={handleClearList}
        onSave={handleSaveList}
        onShare={handleShareList}
      />

      {/* v1.20 #216 — Floating "View list" pill, bottom-right of viewport.
          Only renders when there's something in the list, so the visitor
          isn't pestered until they've actually built something. Tapping
          it opens the list modal where save/share fire signup prompts. */}
      {demoShoppingList.length > 0 && (
        <button
          onClick={() => {
            track("demo_list_viewed", { item_count: demoShoppingList.length });
            setListOpen(true);
          }}
          className="fixed bottom-6 right-6 z-40 px-5 py-3 rounded-full bg-accent text-white text-sm font-semibold shadow-lg hover:opacity-90 transition flex items-center gap-2"
          aria-label={`View your shopping list (${demoShoppingList.length} items)`}
        >
          <span aria-hidden="true">🛒</span>
          <span>Your list ({demoShoppingList.length})</span>
        </button>
      )}

      {/* Ephemeral toast confirming "Added N items from {recipe}." after
          each add. Auto-dismisses after 2.5s. Centered horizontally at
          the top so it doesn't collide with the floating list pill. */}
      {addedToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-24 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-text text-white text-sm font-medium shadow-lg max-w-[90vw] text-center"
        >
          {addedToast}
        </div>
      )}
    </DemoLayout>
  );
}
