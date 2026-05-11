import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { rowToItem, daysUntil } from "../lib/helpers.js";
import { CATEGORY_EMOJI } from "../lib/constants.js";
import { track } from "../lib/analytics.js";
import Layout from "../components/Layout.jsx";
import Modal from "../components/Modal.jsx";

// Eat Me First — the headline tab for v1.16.
//
// What's the problem? Users open the app and don't know what to do. They see
// a long list of items in their fridge, and the most relevant decision —
// "what should I eat tonight before it goes bad?" — is buried 4 taps deep.
//
// This tab answers that question directly. It pulls the user's fridge, ranks
// every item by an urgency score (combining days-until-expiry with category
// spoil-risk weighting), and shows the top ~12 in priority order. Each row
// has a one-tap "Get recipes" button that calls generate-recipes with this
// item leading + the other 4 most-urgent items, so the recipes Claude
// suggests actually use what's about to spoil.
//
// Validates the Email 1 promise ("the day before something goes bad, we tell
// you what to make with it") and Cooklist's #1 differentiator (priority list
// instead of inventory list).

// Score lower = more urgent. Days-until-expiry dominates; category nudges
// faster-spoiling things up the list when expiry windows tie. Items >14 days
// out are dropped from the list entirely.
function urgencyScore(item) {
  const d = daysUntil(item.expiryDate);
  // Expired sits at the very top.
  if (d <= 0) return -1000 + d;
  // Per-category spoil factor — herbs/produce sink faster than dry goods even
  // at the same labeled date.
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

export default function EatMeFirst({ user }) {
  const [items, setItems]   = useState([]);
  const [loading, setLoad]  = useState(true);
  const [err, setErr]       = useState(null);

  // Recipe modal — opens when user taps "Get recipes" on a row, or the
  // header "Top 5 together" CTA.
  const [recipeModal, setRecipeModal] = useState(null); // {leadItem, items, recipes, loading, error}

  async function load() {
    try {
      setErr(null);
      const { data, error } = await supabase
        .from("fridge_items")
        .select("*")
        .order("expiry_date", { ascending: true });
      if (error) throw error;
      setItems((data || []).map(rowToItem));
    } catch (e) {
      setErr(e?.message || "Couldn't load your fridge.");
    } finally {
      setLoad(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  // v1.16 — fire once per mount when data finishes loading so we get a clean
  // "user actually saw the ranked list" signal (vs. "user navigated then
  // bounced before fetch returned"). Includes counts so we can correlate
  // with "do empty-state visitors retain less than populated-state ones".
  const viewedRef = useRef(false);
  useEffect(() => {
    if (loading || viewedRef.current) return;
    const expCount = items.filter(i => daysUntil(i.expiryDate) <= 0).length;
    const soonCount = items.filter(i => { const d = daysUntil(i.expiryDate); return d > 0 && d <= 3; }).length;
    track("eat_me_first_viewed", {
      surface: "web",
      total_items: items.length,
      expired_count: expCount,
      expiring_soon_count: soonCount,
      has_actionable: expCount + soonCount > 0,
    });
    viewedRef.current = true;
  }, [loading, items.length]);

  // Sort + cap. Anything past 14 days drops off — they're not "eat me first".
  const ranked = items
    .filter(i => daysUntil(i.expiryDate) <= 14)
    .sort((a, b) => urgencyScore(a) - urgencyScore(b))
    .slice(0, 12);

  const expiredCount = items.filter(i => daysUntil(i.expiryDate) <= 0).length;
  const soonCount    = items.filter(i => {
    const d = daysUntil(i.expiryDate);
    return d > 0 && d <= 3;
  }).length;

  async function fetchRecipes({ leadItem, contextItems }) {
    setRecipeModal({ leadItem, items: contextItems, recipes: [], loading: true, error: null });
    track("eat_me_first_recipes_requested", {
      lead_item: leadItem?.name || null,
      context_count: contextItems.length,
      surface: leadItem ? "row" : "header_top5",
    });
    try {
      // Send the lead item first so Claude knows what to anchor on, then the
      // other expiring items as the "and a few others you already have"
      // context promised in Email 3.
      const names = [
        ...(leadItem ? [leadItem.name] : []),
        ...contextItems.map(i => i.name).filter(n => n && n !== leadItem?.name),
      ].slice(0, 8);
      const { data, error } = await supabase.functions.invoke("generate-recipes", {
        body: { items: names },
      });
      if (error) throw error;
      setRecipeModal(m => m && { ...m, recipes: data?.recipes || [], loading: false });
    } catch (e) {
      setRecipeModal(m => m && { ...m, error: e?.message || "Couldn't generate recipes.", loading: false });
    }
  }

  function onUseLeading(leadItem) {
    // Find the 4 next-most-urgent items (excluding the lead) for context.
    const context = ranked
      .filter(i => i.id !== leadItem.id)
      .slice(0, 4);
    fetchRecipes({ leadItem, contextItems: context });
  }

  function onUseTop5() {
    fetchRecipes({ leadItem: null, contextItems: ranked.slice(0, 5) });
  }

  return (
    <Layout user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text tracking-tight">Eat me first</h1>
        <p className="text-textSoft text-sm mt-0.5">
          {loading ? "Loading…" :
           ranked.length === 0 ?
             "Nothing in your fridge is close to spoiling — nice." :
             `${ranked.length} ${ranked.length === 1 ? "item" : "items"} ranked by urgency` +
             (expiredCount + soonCount > 0
               ? ` · ${expiredCount} expired · ${soonCount} expiring within 3 days`
               : "")}
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger mb-4">
          {err}
        </div>
      )}

      {/* Top-5-together CTA. Only worth showing if we have at least 3
          urgent items — otherwise per-item recipes are cleaner. */}
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
            onClick={onUseTop5}
            className="px-3 py-1.5 rounded-full bg-accent text-white text-xs font-semibold hover:opacity-90 transition flex-shrink-0"
          >
            Suggest recipes
          </button>
        </div>
      )}

      {/* Ranked list */}
      {!loading && ranked.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <div className="text-5xl mb-3">✨</div>
          <p className="text-text font-semibold">All clear</p>
          <p className="text-textSoft text-sm mt-1">
            Nothing in your fridge is close to spoiling.
          </p>
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
                {item.emoji || CATEGORY_EMOJI[item.category] || "📦"}
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
                onClick={() => onUseLeading(item)}
                className="px-3 py-1.5 rounded-full bg-accent/10 text-accent text-xs font-semibold hover:bg-accent hover:text-white transition whitespace-nowrap flex-shrink-0"
              >
                Get recipes
              </button>
            </div>
          );
        })}
      </div>

      {/* Recipe modal */}
      {recipeModal && (
        <Modal open={true} onClose={() => setRecipeModal(null)}>
          <div className="p-5 max-h-[80vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-text mb-1">
              {recipeModal.leadItem
                ? `Recipes using ${recipeModal.leadItem.name}`
                : "Recipes for your top expiring items"}
            </h2>
            <p className="text-textSoft text-sm mb-4">
              Using: {[recipeModal.leadItem?.name, ...recipeModal.items.map(i => i.name)]
                .filter(Boolean).join(", ")}
            </p>

            {recipeModal.loading && (
              <div className="py-10 text-center text-textSoft text-sm">
                Generating recipes…
              </div>
            )}
            {recipeModal.error && (
              <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
                {recipeModal.error}
              </div>
            )}

            <div className="space-y-3">
              {(recipeModal.recipes || []).map((r, i) => (
                <div key={i} className="rounded-xl border border-border bg-bg p-4">
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
                    <div>
                      <p className="text-text text-xs font-bold mb-1">Instructions</p>
                      <ol className="text-text text-sm space-y-0.5 list-decimal pl-5">
                        {r.instructions.map((step, j) => <li key={j}>{step}</li>)}
                      </ol>
                    </div>
                  )}
                  {r.tip && (
                    <p className="text-accent text-xs mt-3 italic">💡 {r.tip}</p>
                  )}
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
    </Layout>
  );
}
