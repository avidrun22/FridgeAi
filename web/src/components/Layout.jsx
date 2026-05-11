import { NavLink } from "react-router-dom";

// Shared layout for every authenticated screen.
//
// v1.16 nav consolidation: Fridge / Eat Me First / Plan / Dashboard / Settings.
//   * "Alerts" retired — its urgency lists became Eat Me First, its toggles
//     moved into Settings.
//   * Share button moved out of the header into Settings → Household section.
//   * Sign-out moved into Settings → Account section.
//   * "How to" link retired — the v1.15 first-run tour + the in-context
//     empty-state copy on Fridge cover the same ground without burning a
//     nav slot.
//
// Header stays single-line on every viewport; the underlying screens scroll
// inside <main>.
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
            <NavLink to="/fridge"        className={navLinkClass}>Fridge</NavLink>
            <NavLink to="/eat-me-first"  className={navLinkClass}>Eat Me First</NavLink>
            <NavLink to="/plan"          className={navLinkClass}>Plan</NavLink>
            <NavLink to="/dashboard"     className={navLinkClass}>Dashboard</NavLink>
            <NavLink to="/settings"      className={navLinkClass}>Settings</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {user?.email && (
            <span className="text-muted text-xs hidden md:inline">{user.email}</span>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  );
}
