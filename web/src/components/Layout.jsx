import { NavLink } from "react-router-dom";
import { supabase } from "../lib/supabase.js";

// Shared layout for every authenticated screen. Single source of truth for
// the header brand, the top nav (Fridge / Alerts / Plan / How To), and the
// sign-out button. Mirrors the iOS bottom-nav structure (Fridge / Alerts /
// Plan / How To) on a top bar that fits desktop + mobile widths.
export default function Layout({ user, children }) {
  const navLinkClass = ({ isActive }) =>
    isActive
      ? "text-accent font-semibold"
      : "text-textSoft hover:text-accent";

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
    </div>
  );
}
