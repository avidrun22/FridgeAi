import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { rowToItem, daysUntil } from "../lib/helpers.js";
import { CATEGORY_EMOJI } from "../lib/constants.js";
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

  async function loadAll() {
    try {
      setErr(null);
      const { data, error } = await supabase
        .from("fridge_items")
        .select("*")
        .order("expiry_date", { ascending: true });
      if (error) throw error;
      setItems((data || []).map(rowToItem));

      // Load digest preference
      const { data: settings } = await supabase
        .from("user_settings")
        .select("daily_digest_enabled")
        .eq("user_id", user.id)
        .maybeSingle();
      setDigestEnabled(!!settings?.daily_digest_enabled);
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
