import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { supabase } from "./lib/supabase.js";
import AuthScreen from "./components/AuthScreen.jsx";
import Fridge from "./screens/Fridge.jsx";
import Plan from "./screens/Plan.jsx";
import Alerts from "./screens/Alerts.jsx";
import HowTo from "./screens/HowTo.jsx";

// Root component. Wraps the auth state listener and the router.
// Single rule: if no session, show AuthScreen. Otherwise, render the routes.
export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Pull current session on mount, then subscribe to changes (sign-in,
    // sign-out, token refresh). Same pattern as the iOS app.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

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
      <Route path="/"        element={<Navigate to="/fridge" replace />} />
      <Route path="/fridge"  element={<Fridge user={session.user} />} />
      <Route path="/alerts"  element={<Alerts user={session.user} />} />
      <Route path="/plan"    element={<Plan user={session.user} />} />
      <Route path="/how-to"  element={<HowTo user={session.user} />} />
      <Route path="*"        element={<Navigate to="/fridge" replace />} />
    </Routes>
  );
}
