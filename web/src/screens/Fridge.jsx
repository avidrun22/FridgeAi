import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { rowToItem, daysUntil, expiryColor, expiryLabel, formatQty } from "../lib/helpers.js";
import { CONTAINERS, CATEGORY_EMOJI } from "../lib/constants.js";

// Round 1 placeholder — proves end-to-end that the web app:
//   1. Authenticated successfully
//   2. Can read fridge_items via RLS scoped by household
//   3. Renders something matching the iOS structure
// We'll flesh out a real layout (sidebar, header, container chips, stats,
// item rows + edit/delete) in Round 2.
export default function Fridge({ user }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);
  const [activeContainer, setActiveContainer] = useState("fridge");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // ensure_household_for_user is idempotent — it's a safety net for
        // edge cases where someone signs up via web and skips the iOS
        // onboarding. Returns the existing household_id either way.
        await supabase.rpc("ensure_household_for_user");
        const { data, error } = await supabase
          .from("fridge_items")
          .select("*")
          .order("created_at", { ascending: false });
        if (cancelled) return;
        if (error) throw error;
        setItems((data || []).map(rowToItem));
      } catch (e) {
        if (!cancelled) setErr(e?.message || "Couldn't load fridge.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
  }

  const inContainer = items.filter(i => i.container === activeContainer);

  return (
    <div className="min-h-full bg-bg">
      <header className="sticky top-0 bg-card border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white text-xs font-bold">o</div>
          <span className="text-accent font-extrabold tracking-tight text-sm">ok2eat</span>
          <span className="text-muted text-xs ml-3">{user?.email}</span>
        </div>
        <button onClick={signOut} className="text-textSoft text-xs hover:text-danger">
          Sign out
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text tracking-tight">My Fridge</h1>
            <p className="text-textSoft text-sm mt-0.5">
              {loading ? "Loading…" : `${items.length} items tracked across containers`}
            </p>
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          {CONTAINERS.map(c => (
            <button
              key={c.id}
              onClick={() => setActiveContainer(c.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition border ${
                activeContainer === c.id
                  ? "bg-accent text-white border-accent"
                  : "bg-card text-textSoft border-border hover:border-accent"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {err && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger mb-4">
            {err}
          </div>
        )}

        {!loading && inContainer.length === 0 && !err && (
          <div className="rounded-xl border border-border bg-card p-10 text-center">
            <div className="text-5xl mb-3">🧊</div>
            <p className="text-text font-semibold">
              {items.length === 0 ? "Your fridge is empty" : `Nothing in ${CONTAINERS.find(c => c.id === activeContainer)?.label}`}
            </p>
            <p className="text-textSoft text-sm mt-1">
              Add items from your iPhone for now — web add coming in Round 3.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {inContainer.map(it => {
            const days = daysUntil(it.expiryDate);
            const color = expiryColor(days);
            return (
              <div key={it.id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-bg flex items-center justify-center text-xl">
                  {it.emoji || CATEGORY_EMOJI[it.category] || "📦"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-text font-semibold truncate">{it.name}</p>
                  <p className="text-textSoft text-xs mt-0.5">
                    {formatQty(it)} · {it.category}
                  </p>
                </div>
                <div className="text-xs font-semibold" style={{ color }}>
                  {expiryLabel(days)}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-muted text-xs text-center mt-12">
          Round 1 — read-only view. Add / edit / delete + Plan + Share land in Rounds 2–4.
        </p>
      </main>
    </div>
  );
}
