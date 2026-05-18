import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase.js";
import { track } from "../lib/analytics.js";

// v1.22 #261 — Password reset landing page.
//
// How Supabase password recovery works:
//   1. User taps "Forgot password?" on iOS / Android / web → calls
//      supabase.auth.resetPasswordForEmail(email, { redirectTo: ".../reset-password" })
//   2. Supabase emails a link like
//      https://app.ok2eat.com/reset-password#access_token=...&refresh_token=...&type=recovery
//   3. When the user clicks the link, the Supabase client picks up the
//      hash, exchanges it for a session, and fires the PASSWORD_RECOVERY
//      auth event.
//   4. THIS component renders the "Set new password" form. On submit it
//      calls supabase.auth.updateUser({ password }) which sets the new
//      password against the now-authenticated session.
//   5. We sign the user out so they go back through the normal login.
//      (Updating password leaves them authenticated, but UX-wise we want
//       them to confirm by signing in fresh with the new password — also
//       matches what iOS users will do when they come back to the iOS app
//       after resetting on web.)
//
// Two error states handled inline:
//   - No recovery token in the URL (user navigated to /reset-password
//     directly, or the token expired) → friendly message + link back to
//     auth screen.
//   - Password too short / weak → Supabase returns a clear error, we show
//     it under the input.
export default function ResetPassword() {
  // null = still checking the URL hash; true = recovery session present;
  // false = no token / expired / direct navigation. We can't show the form
  // until we know there's an authenticated recovery session to update
  // against — otherwise updateUser() would fail with "no user".
  const [hasRecoverySession, setHasRecoverySession] = useState(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState(null);
  const [done, setDone]         = useState(false);
  const navigate                = useNavigate();

  useEffect(() => {
    // Subscribe FIRST so we catch PASSWORD_RECOVERY when the client parses
    // the URL hash. If we only checked getSession() once, we'd race with
    // the hash-parse and probably get null on first paint.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setHasRecoverySession(true);
        track("password_reset_landing_loaded");
      } else if (event === "SIGNED_IN" && session) {
        // Some Supabase versions fire SIGNED_IN instead of PASSWORD_RECOVERY
        // when the recovery hash is parsed. Treat it the same way as long
        // as we're on this route — the user has an authenticated session
        // we can update against.
        setHasRecoverySession(true);
      }
    });

    // Fallback: if the hash was already processed before our listener
    // attached (rare but possible on a fast load), check current session.
    // A session here on /reset-password is interpreted as recovery context.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setHasRecoverySession(true);
      else {
        // Give the hash-parse a beat before deciding there's no token.
        // PASSWORD_RECOVERY can arrive 100-300ms after first paint.
        setTimeout(() => {
          supabase.auth.getSession().then(({ data: { session: s2 } }) => {
            if (s2) setHasRecoverySession(true);
            else setHasRecoverySession(false);
          });
        }, 600);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    if (password.length < 6) { setErr("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setErr("Passwords don't match."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      track("password_reset_completed");
      // Sign out so the user lands on the auth screen and signs in fresh
      // with the new password. Cleaner mental model than dropping them
      // straight into the app — and matches the iOS user who'll come back
      // to the iOS app to sign in with the new password anyway.
      await supabase.auth.signOut();
      setDone(true);
      // 3s grace so the user reads the confirmation, then bounce to auth.
      setTimeout(() => navigate("/", { replace: true }), 3000);
    } catch (e) {
      setErr(e?.message || "Couldn't update password. Try the reset link again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6 bg-bg">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white text-sm font-bold">o</div>
          <span className="text-accent font-extrabold tracking-tight">ok2eat</span>
        </div>

        <div className="bg-card rounded-xl border border-border p-6">
          {hasRecoverySession === null && (
            <p className="text-sm text-textSoft text-center py-6">Checking your reset link…</p>
          )}

          {hasRecoverySession === false && (
            <>
              <h1 className="text-xl font-bold text-text mb-2">Reset link not valid</h1>
              <p className="text-sm text-textSoft mb-4">
                This page only works when you arrive from a "Reset your password" email.
                The link may have expired (they're valid for one hour) or already been used.
              </p>
              <button
                onClick={() => navigate("/", { replace: true })}
                className="w-full rounded-lg bg-accent text-white text-sm font-semibold py-2.5"
              >
                Back to sign in
              </button>
            </>
          )}

          {hasRecoverySession === true && !done && (
            <>
              <h1 className="text-xl font-bold text-text mb-1">Set a new password</h1>
              <p className="text-textSoft text-sm mb-5">
                Pick a password you'll remember. At least 6 characters.
              </p>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="block text-xs text-textSoft mb-1">New password</label>
                  <input
                    type="password" required autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-card focus:outline-none focus:border-accent"
                    placeholder="••••••••"
                    minLength={6}
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label className="block text-xs text-textSoft mb-1">Confirm password</label>
                  <input
                    type="password" required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-card focus:outline-none focus:border-accent"
                    placeholder="••••••••"
                    minLength={6}
                    autoComplete="new-password"
                  />
                </div>
                {err && <p className="text-sm text-danger">{err}</p>}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-accent text-white text-sm font-semibold py-2.5 disabled:opacity-50"
                >
                  {busy ? "Setting password…" : "Set new password"}
                </button>
              </form>
            </>
          )}

          {done && (
            <div className="text-center py-4">
              <p className="text-3xl mb-2">✓</p>
              <p className="text-text font-semibold mb-1">Password updated</p>
              <p className="text-textSoft text-sm">
                You can now sign in with your new password — on iPhone, Android, or the web.
              </p>
              <p className="text-muted text-xs mt-4">Taking you to sign in…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
