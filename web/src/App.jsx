import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { supabase } from "./lib/supabase.js";
import { identify, resetAnalytics, track, trackPageView } from "./lib/analytics.js";
import AuthScreen from "./components/AuthScreen.jsx";
import Fridge from "./screens/Fridge.jsx";
import Plan from "./screens/Plan.jsx";
import EatMeFirst from "./screens/EatMeFirst.jsx";
import Dashboard from "./screens/Dashboard.jsx";
import Settings from "./screens/Settings.jsx";

// Root component. Wraps the auth state listener and the router.
// Single rule: if no session, show AuthScreen. Otherwise, render the routes.
//
// v1.16 routes — five top-level tabs (Fridge / Eat Me First / Plan /
// Dashboard / Settings). /alerts and /how-to redirect for back-compat with
// users who bookmarked the old routes.
export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    // Pull current session on mount, then subscribe to changes (sign-in,
    // sign-out, token refresh). Same pattern as the iOS app.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user?.id) identify(session.user.id);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // v1.15 — wire identify/reset to auth state changes so PostHog
      // events post-sign-in attach to the same person profile as iOS.
      if (s?.user?.id) {
        identify(s.user.id);
        if (event === "SIGNED_IN") track("user_signed_in", { method: "session" });
      } else if (event === "SIGNED_OUT") {
        track("user_signed_out");
        resetAnalytics();
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // v1.15 — react-router doesn't fire window navigation events, so the
  // posthog-js auto-pageview only catches the initial load. Fire on every
  // path change so the dashboard "Pageviews" insight reflects the SPA's
  // actual screen-to-screen flow.
  useEffect(() => {
    if (loading) return;
    trackPageView(location.pathname + location.search);
  }, [location.pathname, location.search, loading]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-textSoft text-sm">Loading…</div>
      </div>
    );
  }

  if (!session) return <AuthScreen />;

  return (
    <Routes>
      <Route path="/"              element={<Navigate to="/fridge" replace />} />
      <Route path="/fridge"        element={<Fridge       user={session.user} />} />
      <Route path="/eat-me-first"  element={<EatMeFirst   user={session.user} />} />
      <Route path="/plan"          element={<Plan         user={session.user} />} />
      <Route path="/dashboard"     element={<Dashboard    user={session.user} />} />
      <Route path="/settings"      element={<Settings     user={session.user} />} />
      {/* Back-compat redirects for v1.15 bookmarks. */}
      <Route path="/alerts"        element={<Navigate to="/eat-me-first" replace />} />
      <Route path="/how-to"        element={<Navigate to="/fridge"       replace />} />
      <Route path="*"              element={<Navigate to="/fridge"       replace />} />
    </Routes>
  );
}
