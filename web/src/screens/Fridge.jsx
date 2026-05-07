import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { rowToItem, daysUntil, expiryColor, expiryLabel, formatQty } from "../lib/helpers.js";
import { CONTAINERS, CATEGORIES, CATEGORY_EMOJI } from "../lib/constants.js";
import { track } from "../lib/analytics.js";
import AddItemModal from "../components/AddItemModal.jsx";
import BulkAddItemsModal from "../components/BulkAddItemsModal.jsx";
import ItemDetailModal from "../components/ItemDetailModal.jsx";
import Layout from "../components/Layout.jsx";

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
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  // v1.16 — search + category filter for the active container
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState("All"); // "All" | "Dairy" | "Protein" | … | "expiring" | "expired"

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

  // v1.15 — expiring_soon_viewed mirrors the iOS event. Fires once per
  // load when items are present so we can correlate retention with
  // whether users actually hit the value moment.
  const expiringSeenRef = useRef(false);
  useEffect(() => {
    if (loading || expiringSeenRef.current) return;
    if (items.length === 0) return;
    const exp = items.filter(i => { const d = daysUntil(i.expiryDate); return d > 0 && d <= 3; }).length;
    const expd = items.filter(i => daysUntil(i.expiryDate) <= 0).length;
    track("expiring_soon_viewed", {
      total_items: items.length,
      expiring_count: exp,
      expired_count: expd,
      has_actionable: exp > 0 || expd > 0,
    });
    expiringSeenRef.current = true;
  }, [loading, items.length]);

  // v1.15 — debounced search_used (mirrors the iOS instrumentation).
  // Fires 600ms after the user stops typing if the query has >=2 chars.
  const lastSearchFiredRef = useRef("");
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2 || q === lastSearchFiredRef.current) return;
    const t = setTimeout(() => {
      track("search_used", { query_length: q.length, container: activeContainer });
      lastSearchFiredRef.current = q;
    }, 600);
    return () => clearTimeout(t);
  }, [searchQuery, activeContainer]);

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

  // v1.16 — apply category filter then text search to the in-container set.
  const categoryFiltered = filter === "All"
    ? inContainer
    : filter === "expiring"
      ? inContainer.filter(i => { const d = daysUntil(i.expiryDate); return d > 0 && d <= 3; })
      : filter === "expired"
        ? inContainer.filter(i => daysUntil(i.expiryDate) <= 0)
        : inContainer.filter(i => i.category === filter);
  const searchTerm = searchQuery.trim().toLowerCase();
  const visible = searchTerm
    ? categoryFiltered.filter(i => (i.name || "").toLowerCase().includes(searchTerm))
    : categoryFiltered;

  return (
    <Layout user={user}>
      <>
        <div className="flex items-baseline justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text tracking-tight">My Fridge</h1>
            <p className="text-textSoft text-sm mt-0.5">
              {loading ? "Loading…" : `${items.length} items tracked across containers`}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <button
              onClick={() => setShowAdd(true)}
              className="px-4 py-2 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent/90 flex items-center gap-1.5 whitespace-nowrap"
            >
              <span className="text-lg leading-none">+</span> Add item
            </button>
            <button
              onClick={() => setShowBulkAdd(true)}
              className="text-xs text-accent hover:underline whitespace-nowrap"
            >
              + Add multiple
            </button>
          </div>
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
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="rounded-lg border border-border bg-card p-3 text-center">
              <p className="text-xl font-bold text-text">{containerCount}</p>
              <p className="text-[10px] text-textSoft uppercase tracking-wide">Total</p>
            </div>
            <button
              onClick={() => setFilter(filter === "expiring" ? "All" : "expiring")}
              className={`rounded-lg border p-3 text-center transition ${
                filter === "expiring" ? "border-warn bg-warn/5" : "border-border bg-card hover:border-warn/50"
              }`}
            >
              <p className="text-xl font-bold" style={{ color: expiringSoon > 0 ? "#EA580C" : "#1C261C" }}>{expiringSoon}</p>
              <p className="text-[10px] text-textSoft uppercase tracking-wide">Expiring soon</p>
            </button>
            <button
              onClick={() => setFilter(filter === "expired" ? "All" : "expired")}
              className={`rounded-lg border p-3 text-center transition ${
                filter === "expired" ? "border-danger bg-danger/5" : "border-border bg-card hover:border-danger/50"
              }`}
            >
              <p className="text-xl font-bold" style={{ color: expired > 0 ? "#DC2626" : "#1C261C" }}>{expired}</p>
              <p className="text-[10px] text-textSoft uppercase tracking-wide">Expired</p>
            </button>
          </div>
        )}

        {/* v1.16 — search bar + category filter chips. Mirrors iOS v1.0.10. */}
        {!loading && containerCount > 0 && (
          <>
            <div className="relative mb-3">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">🔍</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${CONTAINERS.find(c => c.id === activeContainer)?.label.toLowerCase() || "items"}…`}
                className="w-full rounded-full border border-border bg-card pl-9 pr-9 py-2 text-sm focus:outline-none focus:border-accent"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-danger text-sm"
                  aria-label="Clear search"
                >✕</button>
              )}
            </div>
            <div className="flex gap-1.5 mb-4 flex-wrap">
              {["All", ...CATEGORIES].map(c => (
                <button
                  key={c}
                  onClick={() => setFilter(c)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                    filter === c
                      ? "bg-accent/10 border-accent text-accent"
                      : "bg-card border-border text-textSoft hover:border-accent"
                  }`}
                >
                  {c === "All" ? "All" : `${CATEGORY_EMOJI[c]} ${c}`}
                </button>
              ))}
            </div>
          </>
        )}

        {err && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger mb-4">
            {err}
          </div>
        )}

        {!loading && visible.length === 0 && !err && (
          <div className="rounded-xl border border-border bg-card p-10 text-center">
            <div className="text-5xl mb-3">{searchQuery || filter !== "All" ? "🔍" : "🧊"}</div>
            <p className="text-text font-semibold">
              {searchQuery
                ? `No items match "${searchQuery}"`
                : filter !== "All"
                  ? `Nothing matches the ${filter} filter`
                  : items.length === 0
                    ? "Your fridge is empty"
                    : `Nothing in ${CONTAINERS.find(c => c.id === activeContainer)?.label}`}
            </p>
            <p className="text-textSoft text-sm mt-1 mb-4">
              {searchQuery || filter !== "All"
                ? "Try clearing the filter."
                : 'Tap "Add item" above to add something.'}
            </p>
            {searchQuery || filter !== "All" ? (
              <button
                onClick={() => { setSearchQuery(""); setFilter("All"); }}
                className="px-5 py-2 rounded-full border border-border text-sm font-semibold text-textSoft hover:bg-card"
              >
                Clear filters
              </button>
            ) : (
              <button
                onClick={() => setShowAdd(true)}
                className="px-5 py-2 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent/90"
              >
                + Add item
              </button>
            )}
          </div>
        )}

        <div className="space-y-2">
          {visible.map(it => {
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

        <AddItemModal
          open={showAdd}
          onClose={() => setShowAdd(false)}
          onAdded={handleAdded}
          householdId={householdId}
          defaultContainer={activeContainer}
        />

        <BulkAddItemsModal
          open={showBulkAdd}
          onClose={() => setShowBulkAdd(false)}
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
      </>
    </Layout>
  );
}
