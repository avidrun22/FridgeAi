import { useState } from "react";
import { NavLink } from "react-router-dom";
import { supabase } from "../lib/supabase.js";
import HouseholdShareModal from "./HouseholdShareModal.jsx";

// Shared layout for every authenticated screen. Single source of truth for
// the header brand, the top nav (Fridge / Alerts / Plan / How To), and the
// sign-out button. Mirrors the iOS bottom-nav structure (Fridge / Alerts /
// Plan / How To) on a top bar that fits desktop + mobile widths.
// v1.16 — adds a "Share" button that opens the household invite/redeem modal.
export default function Layout({ user, children }) {
  const [showShare, setShowShare] = useState(false);

  const navLinkClass = ({ isActive }) =>
    isActive
      ? "text-accent font-semibold"
      : "text-textSoft hover:text-accent";

  // After someone redeems a code, force a hard reload so every screen
  // re-fetches against the new household_id. Cheaper than threading a
  // refetch callback through every screen.
  function handleJoined() {
    window.location.reload();
  }

  return (
    <div className="min-h-full bg-bg">
      <header className="sticky top-0 bg-card border-b border-border px-6 py-3 flex items-center justify-between z-30">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white text-xs font-bold">o</div>
          <span className="text-accent font-extrabold tracking-tight text-sm">ok2eat</span>
          <nav className="ml-6 flex gap-4 text-sm">
            <NavLink to="/fridge" className={navLinkClass}>Fridge</NavLink>
            <NavLink to="/alerts" className={navLinkClass}>Alerts</NavLink>
            <NavLink to="/plan" className={navLinkClass}>Plan</NavLink>
            <NavLink to="/how-to" className={navLinkClass}>How To</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowShare(true)}
            className="px-3 py-1 rounded-full border border-border text-xs font-semibold text-textSoft hover:border-accent hover:text-accent transition flex items-center gap-1"
            title="Share fridge + lists with someone in your household"
          >
            <span>👥</span>
            <span className="hidden sm:inline">Share</span>
          </button>
          {user?.email && (
            <span className="text-muted text-xs hidden md:inline">{user.email}</span>
          )}
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-textSoft text-xs hover:text-danger"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {children}
      </main>

      <HouseholdShareModal
        open={showShare}
        onClose={() => setShowShare(false)}
        onJoined={handleJoined}
      />
    </div>
  );
}
