import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { rowToItem, daysUntil } from "../lib/helpers.js";
import { CATEGORY_EMOJI } from "../lib/constants.js";
import { track } from "../lib/analytics.js";
import Layout from "../components/Layout.jsx";

// Alerts tab — mirrors the iOS Reminders tab. Shows expiring items + expired
// items + the email-digest toggle. Click an item to jump to its row in the
// Fridge tab (TODO when item-detail-by-id deep linking is wired; for now
// just navigates to /fridge).
//
// What's deferred: push-notification settings (web push has different UX
// and lower value vs. the email digest we already have); custom reminders
// list (iOS supports these but they're rarely used).
export default function Alerts({ user }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // Email digest toggle (reads/writes user_settings.daily_digest_enabled).
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestLoading, setDigestLoading] = useState(false);

  // v1.16 Tier 2 — dietary prefs, allergens, household size. Mirrors iOS
  // RemindersScreen. Each toggle/change upserts to user_settings immediately.
  const [dietary, setDietary]             = useState([]);
  const [allergens, setAllergens]         = useState([]);
  const [householdSize, setHouseholdSize] = useState(1);

  // Kept in sync with the matching maps in iOS App.js + the generate-recipes
  // Edge Function. Change one, change the others.
  const DIETARY_OPTIONS = [
    { id: "vegetarian",  label: "Vegetarian",  emoji: "🥗" },
    { id: "vegan",       label: "Vegan",       emoji: "🌱" },
    { id: "pescatarian", label: "Pescatarian", emoji: "🐟" },
    { id: "gluten_free", label: "Gluten-free", emoji: "🌾" },
    { id: "dairy_free",  label: "Dairy-free",  emoji: "🥛" },
    { id: "nut_free",    label: "Nut-free",    emoji: "🥜" },
    { id: "low_carb",    label: "Low-carb",    emoji: "🥩" },
    { id: "keto",        label: "Keto",        emoji: "🥑" },
  ];
  const ALLERGEN_OPTIONS = [
    { id: "peanut",    label: "Peanut" },
    { id: "tree_nut",  label: "Tree nuts" },
    { id: "shellfish", label: "Shellfish" },
    { id: "fish",      label: "Fish" },
    { id: "egg",       label: "Egg" },
    { id: "milk",      label: "Milk" },
    { id: "soy",       label: "Soy" },
    { id: "wheat",     label: "Wheat" },
    { id: "sesame",    label: "Sesame" },
  ];

  async function persistProfile(patch) {
    try {
      await supabase.from("user_settings").upsert({
        user_id: user.id,
        dietary_restrictions: patch.dietary ?? dietary,
        allergens: patch.allergens ?? allergens,
        household_size: patch.householdSize ?? householdSize,
      }, { onConflict: "user_id" });
      track("profile_updated", {
        surface: "web_alerts",
        dietary_count: (patch.dietary ?? dietary).length,
        allergen_count: (patch.allergens ?? allergens).length,
        household_size: patch.householdSize ?? householdSize,
      });
    } catch (e) {
      console.warn("user_settings upsert failed:", e?.message || e);
    }
  }
  function toggleDietary(id) {
    const next = dietary.includes(id) ? dietary.filter(d => d !== id) : [...dietary, id];
    setDietary(next);
    persistProfile({ dietary: next });
  }
  function toggleAllergen(id) {
    const next = allergens.includes(id) ? allergens.filter(a => a !== id) : [...allergens, id];
    setAllergens(next);
    persistProfile({ allergens: next });
  }
  function changeHouseholdSize(delta) {
    const next = Math.max(1, Math.min(20, householdSize + delta));
    if (next === householdSize) return;
    setHouseholdSize(next);
    persistProfile({ householdSize: next });
  }

  async function loadAll() {
    try {
      setErr(null);
      const { data, error } = await supabase
        .from("fridge_items")
        .select("*")
        .order("expiry_date", { ascending: true });
      if (error) throw error;
      setItems((data || []).map(rowToItem));

      // Load digest preference + dietary/allergen/household profile.
      const { data: settings } = await supabase
        .from("user_settings")
        .select("daily_digest_enabled, dietary_restrictions, allergens, household_size")
        .eq("user_id", user.id)
        .maybeSingle();
      setDigestEnabled(!!settings?.daily_digest_enabled);
      setDietary(Array.isArray(settings?.dietary_restrictions) ? settings.dietary_restrictions : []);
      setAllergens(Array.isArray(settings?.allergens) ? settings.allergens : []);
      setHouseholdSize(
        Number.isFinite(Number(settings?.household_size))
          ? Math.max(1, Math.min(20, Number(settings.household_size)))
          : 1
      );
    } catch (e) {
      setErr(e?.message || "Couldn't load alerts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); /* eslint-disable-line */ }, []);

  async function toggleDigest() {
    setDigestLoading(true);
    const next = !digestEnabled;
    setDigestEnabled(next);
    try {
      const { error } = await supabase
        .from("user_settings")
        .upsert({ user_id: user.id, daily_digest_enabled: next }, { onConflict: "user_id" });
      if (error) throw error;
    } catch (e) {
      setDigestEnabled(!next); // revert
      setErr(e?.message || "Couldn't update digest setting.");
    } finally {
      setDigestLoading(false);
    }
  }

  // ─── Bucket items by urgency ──────────────────────────────────────────────
  const expired = items.filter(i => daysUntil(i.expiryDate) <= 0);
  const expiringToday = items.filter(i => daysUntil(i.expiryDate) === 1);
  const expiringSoon = items.filter(i => {
    const d = daysUntil(i.expiryDate);
    return d > 1 && d <= 3;
  });

  function ItemRow({ item, urgencyColor }) {
    const days = daysUntil(item.expiryDate);
    const urgencyText =
      days <= 0 ? "Expired"
      : days === 1 ? "Expires tomorrow"
      : `Expires in ${days} days`;
    return (
      <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-bg flex items-center justify-center text-lg flex-shrink-0">
          {item.emoji || CATEGORY_EMOJI[item.category] || "📦"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-text font-semibold truncate">{item.name}</p>
          <p className="text-textSoft text-xs mt-0.5">{item.category}</p>
        </div>
        <div className="text-xs font-semibold whitespace-nowrap" style={{ color: urgencyColor }}>
          {urgencyText}
        </div>
      </div>
    );
  }

  return (
    <Layout user={user}>
      <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text tracking-tight">Alerts</h1>
        <p className="text-textSoft text-sm mt-0.5">
          {loading ? "Loading…" :
           expired.length + expiringToday.length + expiringSoon.length === 0 ?
             "Nothing expiring in the next 3 days." :
             `${expired.length} expired · ${expiringToday.length + expiringSoon.length} expiring soon`}
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger mb-4">
          {err}
        </div>
      )}

      {/* ─── Expired ────────────────────────────────────────────────────── */}
      {expired.length > 0 && (
        <section className="mb-6">
          <h2 className="text-[11px] font-bold tracking-widest text-danger uppercase mb-3">
            Expired ({expired.length})
          </h2>
          <div className="space-y-1.5">
            {expired.map(it => <ItemRow key={it.id} item={it} urgencyColor="#DC2626" />)}
          </div>
        </section>
      )}

      {/* ─── Expiring today/tomorrow ─────────────────────────────────────── */}
      {expiringToday.length > 0 && (
        <section className="mb-6">
          <h2 className="text-[11px] font-bold tracking-widest text-warn uppercase mb-3">
            Use today or tomorrow ({expiringToday.length})
          </h2>
          <div className="space-y-1.5">
            {expiringToday.map(it => <ItemRow key={it.id} item={it} urgencyColor="#EA580C" />)}
          </div>
        </section>
      )}

      {/* ─── Expiring within 3 days ──────────────────────────────────────── */}
      {expiringSoon.length > 0 && (
        <section className="mb-6">
          <h2 className="text-[11px] font-bold tracking-widest text-textSoft uppercase mb-3">
            Expiring soon ({expiringSoon.length})
          </h2>
          <div className="space-y-1.5">
            {expiringSoon.map(it => <ItemRow key={it.id} item={it} urgencyColor="#16A34A" />)}
          </div>
        </section>
      )}

      {/* ─── All-clear empty state ───────────────────────────────────────── */}
      {!loading && expired.length === 0 && expiringToday.length === 0 && expiringSoon.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-10 text-center mb-6">
          <div className="text-5xl mb-3">✨</div>
          <p className="text-text font-semibold">All clear</p>
          <p className="text-textSoft text-sm mt-1">
            Nothing in your fridge is expiring in the next 3 days.
          </p>
        </div>
      )}

      {/* ─── Household size ──────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-[11px] font-bold tracking-widest text-textSoft uppercase mb-3">
          Household
        </h2>
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent text-lg flex-shrink-0">
            👥
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-text font-semibold text-sm">Household size</p>
            <p className="text-textSoft text-xs mt-0.5">
              Recipes will be scaled to feed this many people.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => changeHouseholdSize(-1)}
              disabled={householdSize <= 1}
              className="w-8 h-8 rounded-full border border-border bg-bg text-text font-bold disabled:opacity-40 hover:bg-card transition"
              aria-label="Decrease household size"
            >
              −
            </button>
            <span className="text-text font-semibold w-6 text-center">{householdSize}</span>
            <button
              onClick={() => changeHouseholdSize(1)}
              disabled={householdSize >= 20}
              className="w-8 h-8 rounded-full border border-border bg-bg text-text font-bold disabled:opacity-40 hover:bg-card transition"
              aria-label="Increase household size"
            >
              +
            </button>
          </div>
        </div>
      </section>

      {/* ─── Dietary preferences ─────────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="text-[11px] font-bold tracking-widest text-textSoft uppercase mb-3">
          Dietary preferences
        </h2>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-textSoft text-xs mb-3">
            Recipe suggestions will respect these. Tap to toggle.
          </p>
          <div className="flex flex-wrap gap-2">
            {DIETARY_OPTIONS.map(opt => {
              const active = dietary.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  onClick={() => toggleDietary(opt.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition flex items-center gap-1.5 ${
                    active
                      ? "bg-accent text-white border-accent"
                      : "bg-bg text-text border-border hover:border-accent/40"
                  }`}
                >
                  <span>{opt.emoji}</span>
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Allergies (safety-critical) ─────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="text-[11px] font-bold tracking-widest text-textSoft uppercase mb-3">
          Allergies
        </h2>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-textSoft text-xs mb-3">
            Recipes will never include these ingredients.
          </p>
          <div className="flex flex-wrap gap-2">
            {ALLERGEN_OPTIONS.map(opt => {
              const active = allergens.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  onClick={() => toggleAllergen(opt.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                    active
                      ? "bg-danger text-white border-danger"
                      : "bg-bg text-text border-border hover:border-danger/40"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Email digest toggle ─────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-[11px] font-bold tracking-widest text-textSoft uppercase mb-3">
          Notifications
        </h2>
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent text-lg flex-shrink-0">
            ✉️
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-text font-semibold text-sm">Daily email digest</p>
            <p className="text-textSoft text-xs mt-0.5">
              Once-a-day summary of what's expiring, sent to {user.email}
            </p>
          </div>
          <button
            onClick={toggleDigest}
            disabled={digestLoading}
            className={`w-11 h-6 rounded-full transition flex-shrink-0 ${
              digestEnabled ? "bg-accent" : "bg-border"
            } ${digestLoading ? "opacity-50" : ""}`}
            aria-label={digestEnabled ? "Disable daily digest" : "Enable daily digest"}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                digestEnabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </section>
      </>
    </Layout>
  );
}
