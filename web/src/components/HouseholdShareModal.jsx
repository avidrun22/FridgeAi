import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import { supabase } from "../lib/supabase.js";

// v1.16 — Household invite + redeem flow for the web. Mirrors the iOS
// InviteHouseholdModal: two paths in one modal:
//   1. "Invite someone" — calls create_household_invite() RPC to mint a
//      6-letter code that someone else can redeem. Code is shown once with
//      Copy + native Share affordances.
//   2. "Have a code?" — calls redeem_household_invite(code) which moves
//      the redeemer's items into the joined household and updates their
//      household_members row. Mirrors the iOS hotfix that moves orphaned
//      items so v1.0.8 redeemers don't lose history.
//
// RPCs are defined in the existing migrations (see supabase/migrations/
// for the v1.0.8 invite system + v1.0.9 hotfix).
export default function HouseholdShareModal({ open, onClose, onJoined }) {
  const [mode, setMode] = useState("menu"); // "menu" | "invite" | "redeem"

  // Invite state
  const [inviteCode, setInviteCode] = useState(null);
  const [creating, setCreating]     = useState(false);
  const [copied, setCopied]         = useState(false);
  // v1.22 #260 — Separate error state for the invite/create path. Previously
  // createInvite() wrote its error into setRedeemErr, which then bled onto
  // the redeem screen (Greg saw "could not find function create_household_invite"
  // appear under the redeem input — totally confusing). Splitting the states
  // also lets each screen render its own error inline without coupling.
  const [createErr, setCreateErr] = useState(null);

  // v1.22 #260 — Self-loaded household ID. Previously create_household_invite
  // was called without arguments, but the DB function signature is
  //   create_household_invite(p_household_id uuid)
  // — so the RPC failed with "Could not find function without parameters in
  // the schema cache." Loading our own household_id via the existing
  // ensure_household_for_user() RPC keeps the modal self-contained (Settings
  // and Fridge callers don't need to know to pass it in).
  const [householdId, setHouseholdId] = useState(null);

  // Redeem state
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming]   = useState(false);
  const [redeemErr, setRedeemErr]   = useState(null);
  const [redeemDone, setRedeemDone] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("menu");
      setInviteCode(null); setCreating(false); setCopied(false);
      setRedeemCode(""); setRedeeming(false); setRedeemErr(null); setRedeemDone(false);
      setCreateErr(null);
      // Load household_id when the modal opens. Fire-and-forget — if it fails,
      // createInvite will surface a clear error when the user taps Generate.
      (async () => {
        try {
          const { data, error } = await supabase.rpc("ensure_household_for_user");
          if (!error && data) setHouseholdId(data);
        } catch (_) { /* createInvite() will show the error if it tries to fire */ }
      })();
    }
  }, [open]);

  async function createInvite() {
    setCreating(true);
    setCreateErr(null);
    try {
      if (!householdId) {
        // Modal mount might have raced — refresh once before failing.
        const { data } = await supabase.rpc("ensure_household_for_user");
        if (data) setHouseholdId(data);
        if (!data) throw new Error("Couldn't load your household. Refresh and try again.");
      }
      const { data, error } = await supabase.rpc("create_household_invite", {
        p_household_id: householdId,
      });
      if (error) throw error;
      // RPC returns {code, expires_at} or just a code string. Handle both.
      const code = typeof data === "string" ? data : (data?.code || data?.invite_code);
      setInviteCode(code || null);
    } catch (e) {
      setInviteCode(null);
      setCreateErr(e?.message || "Couldn't create invite.");
    } finally {
      setCreating(false);
    }
  }

  async function copyCode() {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) { /* ignore */ }
  }

  async function shareCode() {
    if (!inviteCode || !navigator.share) {
      // Fallback: just copy
      copyCode();
      return;
    }
    try {
      await navigator.share({
        title: "Join my ok2eat household",
        text: `Use code ${inviteCode} to share my fridge + shopping list on ok2eat.`,
      });
    } catch (_) { /* user dismissed */ }
  }

  async function redeem() {
    const code = (redeemCode || "").trim().toUpperCase();
    if (!code || redeeming) return;
    setRedeeming(true); setRedeemErr(null);
    try {
      // v1.22 #260 — Param name was 'invite_code' but the DB function
      // signature is redeem_household_invite(p_code text). Wrong name made
      // every redeem call fail silently with a schema-cache miss.
      const { error } = await supabase.rpc("redeem_household_invite", { p_code: code });
      if (error) throw error;
      setRedeemDone(true);
      onJoined?.();
    } catch (e) {
      setRedeemErr(e?.message || "Couldn't redeem that code.");
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Share fridge + lists" size="md">
      {mode === "menu" && (
        <div className="space-y-3">
          <p className="text-sm text-textSoft">
            Households share fridges and shopping lists. Invite someone you live with so you both see + edit the same data in real time.
          </p>
          <button
            onClick={() => setMode("invite")}
            className="w-full rounded-xl border border-border bg-card p-4 flex items-center gap-3 hover:border-accent transition text-left"
          >
            <span className="text-2xl">📬</span>
            <div>
              <p className="text-text font-semibold text-sm">Invite someone</p>
              <p className="text-textSoft text-xs mt-0.5">Get a 6-letter code to share with a partner or roommate</p>
            </div>
          </button>
          <button
            onClick={() => setMode("redeem")}
            className="w-full rounded-xl border border-border bg-card p-4 flex items-center gap-3 hover:border-accent transition text-left"
          >
            <span className="text-2xl">🎟️</span>
            <div>
              <p className="text-text font-semibold text-sm">I have a code</p>
              <p className="text-textSoft text-xs mt-0.5">Join an existing household using a code someone shared with you</p>
            </div>
          </button>
        </div>
      )}

      {mode === "invite" && (
        <div className="space-y-3">
          {!inviteCode && !creating && (
            <>
              <p className="text-sm text-textSoft">
                Click below to generate a 6-letter code. Send it to your household member; they enter it on their phone or in the web app to join.
              </p>
              <button
                onClick={createInvite}
                className="w-full rounded-full bg-accent text-white py-2.5 text-sm font-semibold hover:bg-accent/90"
              >
                Generate invite code
              </button>
              {/* v1.22 #260 — Inline error for the create flow. Replaces the
                  previous behavior of leaking createInvite errors into
                  setRedeemErr (which surfaced them on the redeem screen). */}
              {createErr && <p className="text-sm text-danger">{createErr}</p>}
            </>
          )}
          {creating && (
            <p className="text-sm text-textSoft text-center py-4">Generating…</p>
          )}
          {inviteCode && (
            <>
              <p className="text-sm text-textSoft">Share this code:</p>
              <div className="rounded-xl border-2 border-accent bg-accent/5 p-6 text-center">
                <p className="text-3xl font-extrabold tracking-[0.3em] text-accent font-mono">{inviteCode}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={copyCode}
                  className="flex-1 rounded-full border border-border bg-card py-2 text-sm font-semibold text-text hover:border-accent transition"
                >
                  {copied ? "✓ Copied" : "Copy code"}
                </button>
                {typeof navigator.share === "function" && (
                  <button
                    onClick={shareCode}
                    className="flex-1 rounded-full bg-accent text-white py-2 text-sm font-semibold hover:bg-accent/90"
                  >
                    Share
                  </button>
                )}
              </div>
              <p className="text-textSoft text-xs">
                Codes are single-use. Generate a new one for each person.
              </p>
            </>
          )}
          <button
            onClick={() => setMode("menu")}
            className="block mx-auto text-xs text-muted hover:text-accent mt-2"
          >
            ← Back
          </button>
        </div>
      )}

      {mode === "redeem" && (
        <div className="space-y-3">
          {!redeemDone ? (
            <>
              <p className="text-sm text-textSoft">
                Enter the 6-letter code from your household member. After you redeem, your existing fridge items will move into the joined household.
              </p>
              <input
                autoFocus
                type="text"
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") redeem(); }}
                placeholder="ABC123"
                maxLength={10}
                className="w-full rounded-lg border border-border bg-card px-4 py-3 text-center text-xl font-extrabold tracking-[0.3em] font-mono focus:outline-none focus:border-accent"
              />
              {redeemErr && <p className="text-sm text-danger">{redeemErr}</p>}
              <button
                onClick={redeem}
                disabled={!redeemCode.trim() || redeeming}
                className="w-full rounded-full bg-accent text-white py-2.5 text-sm font-semibold hover:bg-accent/90 disabled:opacity-50"
              >
                {redeeming ? "Joining…" : "Join household"}
              </button>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-3xl mb-2">🎉</p>
              <p className="text-text font-semibold">You're in</p>
              <p className="text-textSoft text-sm mt-1.5">
                Your fridge and shopping lists are now shared with the household.
              </p>
              <button
                onClick={onClose}
                className="mt-4 px-5 py-2 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent/90"
              >
                Got it
              </button>
            </div>
          )}
          {!redeemDone && (
            <button
              onClick={() => setMode("menu")}
              className="block mx-auto text-xs text-muted hover:text-accent mt-2"
            >
              ← Back
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
