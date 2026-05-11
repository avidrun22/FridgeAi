import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { rowToItem, daysUntil } from "../lib/helpers.js";
import Layout from "../components/Layout.jsx";

// Dashboard tab — v1.16 strategic-reposition supporting feature.
//
// Single-glance view of the value the app has actually delivered to this
// household: money saved, items rescued, CO2 avoided. Sourced from the
// money_saved_events table (every "use it up" creates a row) + the current
// fridge inventory.
//
// Cold-start framing: when a user has 0 events logged, we show an
// aspirational number ("avg US household wastes $1,866/yr in food — yours
// rescued so far: $0") so the empty state still communicates the value
// proposition rather than feeling broken.

const AVG_HOUSEHOLD_WASTE_YEAR = 1866;          // USD — USDA food-waste data
const CO2_KG_PER_DOLLAR_RESCUED = 1.4;          // ~ 5.6kg CO2/kg food × $4/lb avg
const POUNDS_PER_DOLLAR_RESCUED = 0.5;          // grocery $4/lb avg → 0.25 lb/$; using 0.5 to capture the broader basket

function fmt$(cents) {
  const dollars = (cents || 0) / 100;
  return dollars >= 100
    ? `$${Math.round(dollars).toLocaleString()}`
    : `$${dollars.toFixed(2)}`;
}

function fmtN(n) {
  return Math.round(n).toLocaleString();
}

function StatCard({ label, value, hint, tone = "default" }) {
  const toneClass = {
    default: "text-text",
    accent: "text-accent",
    danger: "text-danger",
    warn: "text-warn",
  }[tone] || "text-text";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-textSoft text-[11px] font-bold uppercase tracking-widest">{label}</p>
      <p className={`text-3xl font-extrabold mt-2 ${toneClass}`}>{value}</p>
      {hint && <p className="text-textSoft text-xs mt-1">{hint}</p>}
    </div>
  );
}

export default function Dashboard({ user }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);

  // Headline numbers
  const [lifetimeCents, setLifetimeCents] = useState(0);
  const [weekCents,     setWeekCents]     = useState(0);
  const [lifetimeCount, setLifetimeCount] = useState(0);
  const [weekCount,     setWeekCount]     = useState(0);

  // Top "saved categories" (for the bar chart later — for v1.16 we just list them)
  const [topCategories, setTopCategories] = useState([]);

  // Current at-risk inventory (informational — shows where the next savings
  // are sitting and gently nudges the Eat Me First tab).
  const [atRiskCount, setAtRiskCount] = useState(0);
  const [atRiskValueCents, setAtRiskValueCents] = useState(0);

  async function load() {
    try {
      setErr(null);

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoIso = weekAgo.toISOString();

      // Money saved events (lifetime + last 7d).
      const { data: events, error: evErr } = await supabase
        .from("money_saved_events")
        .select("value_cents, category, saved_at")
        .order("saved_at", { ascending: false });
      if (evErr) throw evErr;

      const allEvents = events || [];
      let lifeC = 0, weekC = 0, lifeN = 0, weekN = 0;
      const byCat = new Map();
      for (const e of allEvents) {
        lifeC += e.value_cents || 0;
        lifeN += 1;
        if (e.saved_at && e.saved_at >= weekAgoIso) {
          weekC += e.value_cents || 0;
          weekN += 1;
        }
        const c = e.category || "Other";
        byCat.set(c, (byCat.get(c) || 0) + (e.value_cents || 0));
      }
      setLifetimeCents(lifeC);
      setWeekCents(weekC);
      setLifetimeCount(lifeN);
      setWeekCount(weekN);
      setTopCategories(
        Array.from(byCat.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([category, cents]) => ({ category, cents }))
      );

      // Current at-risk inventory — anything expiring in <=3 days. value_cents
      // is the per-item estimate stored at add-time (NULL for pre-v1.10 rows
      // and items added without a price).
      const { data: items, error: itErr } = await supabase
        .from("fridge_items")
        .select("expiry_date, value_cents");
      if (itErr) throw itErr;
      const atRisk = (items || []).map(rowToItem).filter(i => {
        const d = daysUntil(i.expiryDate);
        return d <= 3; // includes expired
      });
      setAtRiskCount(atRisk.length);
      setAtRiskValueCents(
        (items || [])
          .filter(r => {
            const d = daysUntil(r.expiry_date);
            return d <= 3;
          })
          .reduce((sum, r) => sum + (r.value_cents || 0), 0)
      );
    } catch (e) {
      setErr(e?.message || "Couldn't load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  // Derived metrics.
  const lifetimeDollars = (lifetimeCents || 0) / 100;
  const lbsRescued = lifetimeDollars * POUNDS_PER_DOLLAR_RESCUED;
  const co2Kg = lifetimeDollars * CO2_KG_PER_DOLLAR_RESCUED;

  // Cold-start hero — different copy when user has $0 saved yet vs. some.
  const isColdStart = lifetimeCents === 0;

  return (
    <Layout user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text tracking-tight">Your impact</h1>
        <p className="text-textSoft text-sm mt-0.5">
          {loading ? "Loading…" :
           isColdStart
             ? `The average US household wastes $${AVG_HOUSEHOLD_WASTE_YEAR.toLocaleString()}/yr in food. Yours so far: $0.`
             : `${lifetimeCount} ${lifetimeCount === 1 ? "item" : "items"} rescued — keep it up.`}
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger mb-4">
          {err}
        </div>
      )}

      {/* Hero: money saved */}
      <div className="mb-5 rounded-xl border border-accent/30 bg-gradient-to-br from-accent/10 to-accent/5 p-5">
        <p className="text-textSoft text-[11px] font-bold uppercase tracking-widest">
          Lifetime money saved
        </p>
        <p className="text-5xl font-extrabold text-accent mt-2">
          {fmt$(lifetimeCents)}
        </p>
        <p className="text-textSoft text-sm mt-1">
          {isColdStart
            ? "Mark items as \"used\" before they expire to start counting."
            : `${fmt$(weekCents)} saved in the last 7 days`}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <StatCard
          label="This week"
          value={fmt$(weekCents)}
          hint={`${weekCount} ${weekCount === 1 ? "item" : "items"} rescued`}
          tone="accent"
        />
        <StatCard
          label="Pounds rescued"
          value={fmtN(lbsRescued)}
          hint="Lifetime, estimated"
        />
        <StatCard
          label="CO₂ avoided"
          value={`${fmtN(co2Kg)} kg`}
          hint="Lifetime, estimated"
        />
        <StatCard
          label="At risk now"
          value={atRiskCount}
          hint={
            atRiskCount === 0
              ? "Nothing expiring soon — nice."
              : `${fmt$(atRiskValueCents)} expiring in 3 days`
          }
          tone={atRiskCount > 0 ? "warn" : "default"}
        />
      </div>

      {/* Top saved categories */}
      {topCategories.length > 0 && (
        <section className="mb-5">
          <h2 className="text-[11px] font-bold tracking-widest text-textSoft uppercase mb-3">
            Top rescued categories
          </h2>
          <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
            {topCategories.map((row, idx) => {
              const pct = lifetimeCents > 0
                ? Math.round((row.cents / lifetimeCents) * 100)
                : 0;
              return (
                <div key={row.category}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-text font-semibold">{row.category}</span>
                    <span className="text-textSoft">{fmt$(row.cents)} · {pct}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-bg overflow-hidden">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Pointer back to Eat Me First when there's at-risk stuff */}
      {atRiskCount > 0 && (
        <div className="rounded-xl border border-warn/30 bg-warn/5 p-4 flex items-center gap-3">
          <div className="text-2xl flex-shrink-0">⏳</div>
          <div className="flex-1 min-w-0">
            <p className="text-text font-semibold text-sm">
              {atRiskCount} {atRiskCount === 1 ? "item is" : "items are"} expiring in the next 3 days
            </p>
            <p className="text-textSoft text-xs mt-0.5">
              Open <a href="/eat-me-first" className="text-accent font-semibold hover:underline">Eat Me First</a> to see what to use first.
            </p>
          </div>
        </div>
      )}

      <p className="text-muted text-[11px] mt-6">
        Estimates use USDA food-waste averages — ~$4/lb basket value, 5.6kg CO₂ per kg of food
        wasted (Project Drawdown).
      </p>
    </Layout>
  );
}
