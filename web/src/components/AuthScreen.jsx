import { useState } from "react";
import { supabase } from "../lib/supabase.js";

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

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
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
        setMsg("Check your email — we sent a sign-in link. Tap it from any device on the same network as this browser.");
      } else if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Session change will flip the App component into routes.
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("Account created. Check your email to confirm, then sign in.");
        setMode("signin");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/",
        });
        if (error) throw error;
        setMsg("Password reset link sent — check your email.");
        setMode("signin");
      }
    } catch (e) {
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

        {/* Apple Sign In hint — drives the few users who signed up via Apple
            on iOS to use the relay email if that's what shows on their iPhone. */}
        {mode === "magic" && (
          <p className="text-center text-xs text-muted mt-4 leading-relaxed">
            Signed up with "Sign in with Apple" on iPhone? Use the email shown on your <span className="text-textSoft">iPhone Settings → Apple Account → ok2eat</span>. The relay address forwards to your real inbox.
          </p>
        )}

        <p className="text-center text-xs text-muted mt-6">
          Less waste, more savings.
        </p>
      </div>
    </div>
  );
}
