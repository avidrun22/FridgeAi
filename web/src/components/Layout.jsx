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
// v1.22 #258 — Settings moved out of the scrolling nav strip into the
// right-side header slot as a gear icon. Greg reported (2026-05-17) that
// mobile users couldn't see Settings: the Leboff overflow-scroll fix
// pushed Settings off-screen at narrow viewports with no visual cue. The
// gear icon is always visible regardless of viewport, doesn't compete with
// the screen tabs for nav real estate, and is the conventional placement
// for account-level entry points.
//
// Header stays single-line on every viewport; the underlying screens scroll
// inside <main>.
export default function Layout({ user, children }) {
  const navLinkClass = ({ isActive }) =>
    isActive
      ? "text-accent font-semibold"
      : "text-textSoft hover:text-accent";

  // Settings icon button uses the same active-state visual cue as the
  // nav links (accent color, slight bg tint) so users get feedback that
  // they're on the settings page.
  const settingsIconClass = ({ isActive }) =>
    `inline-flex items-center justify-center w-9 h-9 rounded-full transition ${
      isActive
        ? "bg-accent/10 text-accent"
        : "text-textSoft hover:bg-bg hover:text-accent"
    }`;

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
          </nav>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {user?.email && (
            <span className="text-muted text-xs hidden md:inline">{user.email}</span>
          )}
          {/* Settings — gear icon, always visible. 36px target meets iOS
              HIG; the icon itself is 18px so it has visual breathing room
              inside the hit area. */}
          <NavLink to="/settings" className={settingsIconClass} aria-label="Settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </NavLink>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  );
}
