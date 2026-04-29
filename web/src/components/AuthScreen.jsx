import { useState } from "react";
import { supabase } from "../lib/supabase.js";

// Minimal email + password auth. Sign-in is the primary action. Sign-up is
// in the same form, toggled. Apple Sign In on web is a v1.1 follow-up — for
// now an iOS user with Apple Sign In can do email + password reset to set
// their password, then sign in here.
export default function AuthScreen() {
  const [mode, setMode]     = useState("signin"); // "signin" | "signup" | "reset"
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
      if (mode === "signin") {
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
    signin: "Sign in to ok2eat",
    signup: "Create your account",
    reset:  "Reset your password",
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
          <p className="text-textSoft text-sm mb-5">
            {mode === "signin" && "Use the same email + password as your iPhone app."}
            {mode === "signup" && "We'll create your household automatically — sign in on iPhone too with the same login."}
            {mode === "reset"  && "We'll email you a link to set a new password."}
          </p>

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
            {mode !== "reset" && (
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
              {busy ? "Working…" :
                mode === "signin" ? "Sign in" :
                mode === "signup" ? "Create account" :
                "Send reset link"}
            </button>
          </form>

          <div className="mt-5 text-xs text-textSoft flex flex-col items-center gap-2">
            {mode === "signin" && (
              <>
                <button onClick={() => setMode("signup")} className="text-accent">
                  No account yet? Sign up
                </button>
                <button onClick={() => setMode("reset")} className="text-textSoft">
                  Forgot password?
                </button>
              </>
            )}
            {mode === "signup" && (
              <button onClick={() => setMode("signin")} className="text-accent">
                Already have an account? Sign in
              </button>
            )}
            {mode === "reset" && (
              <button onClick={() => setMode("signin")} className="text-accent">
                Back to sign in
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-muted mt-6">
          Less waste, more savings.
        </p>
      </div>
    </div>
  );
}
