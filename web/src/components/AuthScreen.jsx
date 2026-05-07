import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import { track } from "../lib/analytics.js";

// Auth screen with magic link as the default. iOS users who signed in via
// "Sign in with Apple" never set a password, so a password form alone would
// lock them out of the web. The magic-link flow works for everyone — Apple
// users, email/password users, anyone — with no friction.
//
// Modes:
//   "magic"   — email-only, sends a one-click sign-in link (default)
//   "signin"  — email + password (for users who set one)
//   "signup"  — email + password to create a new account
//   "reset"   — email-only, sends a password-reset link
export default function AuthScreen() {
  const [mode, setMode]     = useState("magic");
  const [email, setEmail]   = useState("");
  const [password, setPass] = useState("");
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState(null);
  const [err, setErr]       = useState(null);

  // v1.16 — Sign in with Apple via Supabase OAuth. Supabase brokers the
  // redirect to Apple, then bounces back to /. Same email as iOS Apple
  // sign-in lands on the same auth.users row (Supabase links identities
  // by email when the project setting is on).
  async function handleAppleSignIn() {
    setErr(null); setMsg(null); setBusy(true);
    try {
      track("auth_attempted", { method: "apple" });
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: {
          redirectTo: window.location.origin + "/",
        },
      });
      if (error) throw error;
      // Browser is redirecting to Apple now — no further UI needed.
    } catch (e) {
      track("auth_failed", { method: "apple", message: String(e?.message || "").slice(0, 80) });
      setErr(e?.message || "Couldn't start Apple sign-in.");
      setBusy(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      track("auth_attempted", { method: mode });
      if (mode === "magic") {
        // shouldCreateUser=true means a brand-new email gets an account
        // automatically. That removes the "do I sign up or sign in?" choice
        // — the link Just Works for everyone.
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: window.location.origin + "/",
            shouldCreateUser: true,
          },
        });
        if (error) throw error;
        track("auth_magic_link_sent");
        setMsg("Check your email — we sent a sign-in link. Tap it from any device on the same network as this browser.");
      } else if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Session change will flip the App component into routes.
        // user_signed_in fires from App's onAuthStateChange listener.
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        track("user_signed_up", { method: "email" });
        setMsg("Account created. Check your email to confirm, then sign in.");
        setMode("signin");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/",
        });
        if (error) throw error;
        track("password_reset_requested");
        setMsg("Password reset link sent — check your email.");
        setMode("signin");
      }
    } catch (e) {
      track("auth_failed", { method: mode, message: String(e?.message || "").slice(0, 80) });
      setErr(e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const titleByMode = {
    magic:  "Sign in to ok2eat",
    signin: "Sign in with password",
    signup: "Create your account",
    reset:  "Reset your password",
  };

  const subtitleByMode = {
    magic:  "We'll email you a one-tap sign-in link. Same email as your iPhone account.",
    signin: "Use the password you set for the web. Same email as your iPhone account.",
    signup: "Or use the iPhone app — same login works on both.",
    reset:  "We'll email you a link to set a new password.",
  };

  const submitLabelByMode = {
    magic:  "Email me a sign-in link",
    signin: "Sign in",
    signup: "Create account",
    reset:  "Send reset link",
  };

  return (
    <div className="min-h-full flex items-center justify-center p-6 bg-bg">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white text-sm font-bold">o</div>
          <span className="text-accent font-extrabold tracking-tight">ok2eat</span>
        </div>

        <div className="bg-card rounded-xl border border-border p-6">
          <h1 className="text-xl font-bold text-text mb-1">{titleByMode[mode]}</h1>
          <p className="text-textSoft text-sm mb-5">{subtitleByMode[mode]}</p>

          {/* Sign in with Apple — first-class option, matches iOS. Hidden on
              the password-reset flow to keep that screen single-purpose. */}
          {mode !== "reset" && (
            <>
              <button
                type="button"
                onClick={handleAppleSignIn}
                disabled={busy}
                className="w-full rounded-lg bg-black text-white text-sm font-semibold py-2.5 flex items-center justify-center gap-2 hover:bg-zinc-800 disabled:opacity-50 transition mb-3"
              >
                <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M11.624 8.475c-.02-2.043 1.668-3.024 1.745-3.07-.951-1.39-2.43-1.58-2.954-1.602-1.257-.128-2.453.74-3.092.74-.65 0-1.625-.722-2.674-.701-1.376.02-2.643.799-3.351 2.03-1.43 2.476-.366 6.143 1.027 8.155.682.985 1.494 2.09 2.557 2.05 1.027-.041 1.415-.665 2.656-.665 1.231 0 1.589.665 2.674.644 1.103-.02 1.802-1.005 2.476-1.99.78-1.142 1.103-2.247 1.122-2.304-.025-.011-2.155-.827-2.176-3.287zM9.6 2.481c.566-.687.95-1.643.846-2.594-.815.034-1.808.544-2.394 1.232-.524.61-.987 1.585-.864 2.519.911.07 1.844-.46 2.412-1.157z"/>
                </svg>
                Sign in with Apple
              </button>

              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted">or with email</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs text-textSoft mb-1">Email</label>
              <input
                type="email" required autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-card focus:outline-none focus:border-accent"
                placeholder="you@example.com"
              />
            </div>
            {(mode === "signin" || mode === "signup") && (
              <div>
                <label className="block text-xs text-textSoft mb-1">Password</label>
                <input
                  type="password" required
                  value={password}
                  onChange={(e) => setPass(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-card focus:outline-none focus:border-accent"
                  placeholder="••••••••"
                  minLength={6}
                />
              </div>
            )}
            {err && <p className="text-sm text-danger">{err}</p>}
            {msg && <p className="text-sm text-accent">{msg}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-accent text-white text-sm font-semibold py-2.5 disabled:opacity-50"
            >
              {busy ? "Working…" : submitLabelByMode[mode]}
            </button>
          </form>

          <div className="mt-5 text-xs text-textSoft flex flex-col items-center gap-2">
            {mode === "magic" && (
              <>
                <button onClick={() => { setMode("signin"); setErr(null); setMsg(null); }} className="text-textSoft hover:text-text">
                  Have a password? Use that instead
                </button>
              </>
            )}
            {mode === "signin" && (
              <>
                <button onClick={() => { setMode("magic"); setErr(null); setMsg(null); }} className="text-accent">
                  Email me a sign-in link instead
                </button>
                <button onClick={() => { setMode("reset"); setErr(null); setMsg(null); }} className="text-textSoft hover:text-text">
                  Forgot password?
                </button>
                <button onClick={() => { setMode("signup"); setErr(null); setMsg(null); }} className="text-textSoft hover:text-text">
                  No account yet? Sign up
                </button>
              </>
            )}
            {mode === "signup" && (
              <button onClick={() => { setMode("magic"); setErr(null); setMsg(null); }} className="text-accent">
                Back to sign in
              </button>
            )}
            {mode === "reset" && (
              <button onClick={() => { setMode("signin"); setErr(null); setMsg(null); }} className="text-accent">
                Back to sign in
              </button>
            )}
          </div>
        </div>

        {/* Apple Sign In hint — confirms the Apple button is the same identity
            as iOS Apple sign-in so iPhone users don't end up with two accounts. */}
        {mode === "magic" && (
          <p className="text-center text-xs text-muted mt-4 leading-relaxed">
            Signed up with "Sign in with Apple" on iPhone? Use the Apple button above — same account, no separate password needed.
          </p>
        )}

        <p className="text-center text-xs text-muted mt-6">
          Less waste, more savings.
        </p>
      </div>
    </div>
  );
}
