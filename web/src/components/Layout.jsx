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
      {/* Bryan Leboff (2026-05-14) reported horizontal page-scroll on Android
          Chrome at narrow widths. Root cause: the 5-tab nav (~500px) didn't
          fit in a 360px viewport, and there was no overflow clamp on the
          outer header. Fix: outer header is min-w-0 so it can shrink; the
          nav itself becomes a horizontal-scroll strip when it overflows
          (overflow-x:auto + whitespace-nowrap + shrink-0 on the brand
          column so the nav gets the available room first). Result: page
          stops scrolling sideways; nav strip scrolls within itself if
          needed. */}
      <header className="sticky top-0 bg-card border-b border-border px-4 sm:px-6 py-3 flex items-center justify-between z-30 gap-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white text-xs font-bold flex-shrink-0">o</div>
          <span className="text-accent font-extrabold tracking-tight text-sm flex-shrink-0">ok2eat</span>
          <nav className="ml-4 sm:ml-6 flex gap-4 text-sm overflow-x-auto whitespace-nowrap min-w-0 [-ms-overflow-style:none] [scrollbar-width:none] [&amp;::-webkit-scrollbar]:hidden">
            <NavLink to="/fridge"        className={navLinkClass}>Fridge</NavLink>
            <NavLink to="/eat-me-first"  className={navLinkClass}>Eat Me First</NavLink>
            <NavLink to="/plan"          className={navLinkClass}>Plan</NavLink>
            <NavLink to="/dashboard"     className={navLinkClass}>Dashboard</NavLink>
            <NavLink to="/settings"      className={navLinkClass}>Settings</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
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
