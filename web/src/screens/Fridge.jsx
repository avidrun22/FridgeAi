import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { rowToItem, daysUntil, expiryColor, expiryLabel, formatQty } from "../lib/helpers.js";
import { CONTAINERS, CATEGORY_EMOJI } from "../lib/constants.js";
import AddItemModal from "../components/AddItemModal.jsx";
import ItemDetailModal from "../components/ItemDetailModal.jsx";

// Round 3 — full CRUD. Click any row to open the detail modal (edit / use /
// mark-as-opened / delete). Click the "+ Add item" button to insert a new
// row. Mutations are optimistic where it's safe; errors revert via refetch.
export default function Fridge({ user }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);
  const [activeContainer, setActiveContainer] = useState("fridge");
  const [householdId, setHouseholdId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  async function refetch() {
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return;
      const { data: hhId } = await supabase.rpc("ensure_household_for_user");
      if (hhId) setHouseholdId(hhId);
      const { data, error } = await supabase
        .from("fridge_items")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setItems((data || []).map(rowToItem));
      setErr(null);
    } catch (e) {
      setErr(e?.message || "Couldn't load fridge.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refetch(); }, []);

  async function signOut() {
    await supabase.auth.signOut();
  }

  function handleAdded(row) {
    // New rows go to the top — same ordering as the fetched list (created_at desc)
    setItems(prev => [rowToItem(row), ...prev]);
  }

  function handleUpdated(row) {
    setItems(prev => prev.map(i => i.id === row.id ? rowToItem(row) : i));
    setSelectedItem(rowToItem(row));
  }

  function handleRemoved(id) {
    setItems(prev => prev.filter(i => i.id !== id));
    setSelectedItem(null);
  }

  const inContainer = items.filter(i => (i.container || "fridge") === activeContainer);

  // Stat tiles for the active container
  const containerCount = inContainer.length;
  const expiringSoon = inContainer.filter(i => {
    const d = daysUntil(i.expiryDate); return d > 0 && d <= 3;
  }).length;
  const expired = inContainer.filter(i => daysUntil(i.expiryDate) <= 0).length;

  return (
    <div className="min-h-full bg-bg">
      <header className="sticky top-0 bg-card border-b border-border px-6 py-3 flex items-center justify-between z-30">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white text-xs font-bold">o</div>
          <span className="text-accent font-extrabold tracking-tight text-sm">ok2eat</span>
          <span className="text-muted text-xs ml-3 hidden sm:inline">{user?.email}</span>
        </div>
        <button onClick={signOut} className="text-textSoft text-xs hover:text-danger">
          Sign out
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-baseline justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text tracking-tight">My Fridge</h1>
            <p className="text-textSoft text-sm mt-0.5">
              {loading ? "Loading…" : `${items.length} items tracked across containers`}
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent/90 flex items-center gap-1.5 whitespace-nowrap"
          >
            <span className="text-lg leading-none">+</span> Add item
          </button>
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
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

        {!loading && containerCount > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-6">
            <div className="rounded-lg border border-border bg-card p-3 text-center">
              <p className="text-xl font-bold text-text">{containerCount}</p>
              <p className="text-[10px] text-textSoft uppercase tracking-wide">Total</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 text-center">
              <p className="text-xl font-bold" style={{ color: expiringSoon > 0 ? "#EA580C" : "#1C261C" }}>{expiringSoon}</p>
              <p className="text-[10px] text-textSoft uppercase tracking-wide">Expiring soon</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 text-center">
              <p className="text-xl font-bold" style={{ color: expired > 0 ? "#DC2626" : "#1C261C" }}>{expired}</p>
              <p className="text-[10px] text-textSoft uppercase tracking-wide">Expired</p>
            </div>
          </div>
        )}

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
            <p className="text-textSoft text-sm mt-1 mb-4">
              Tap "Add item" above to add something.
            </p>
            <button
              onClick={() => setShowAdd(true)}
              className="px-5 py-2 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent/90"
            >
              + Add item
            </button>
          </div>
        )}

        <div className="space-y-2">
          {inContainer.map(it => {
            const days = daysUntil(it.expiryDate);
            const color = expiryColor(days);
            return (
              <button
                key={it.id}
                onClick={() => setSelectedItem(it)}
                className="w-full rounded-xl border border-border bg-card p-4 flex items-center gap-3 text-left hover:border-accent/60 transition"
              >
                <div className="w-10 h-10 rounded-lg bg-bg flex items-center justify-center text-xl flex-shrink-0">
                  {it.emoji || CATEGORY_EMOJI[it.category] || "📦"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-text font-semibold truncate">{it.name}</p>
                  <p className="text-textSoft text-xs mt-0.5">
                    {formatQty(it)} · {it.category}
                    {it.isOpened && <span className="ml-1 text-warn">· opened</span>}
                  </p>
                </div>
                <div className="text-xs font-semibold whitespace-nowrap" style={{ color }}>
                  {expiryLabel(days)}
                </div>
              </button>
            );
          })}
        </div>
      </main>

      <AddItemModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={handleAdded}
        householdId={householdId}
        defaultContainer={activeContainer}
      />

      <ItemDetailModal
        open={!!selectedItem}
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onUpdated={handleUpdated}
        onRemoved={handleRemoved}
      />
    </div>
  );
}
