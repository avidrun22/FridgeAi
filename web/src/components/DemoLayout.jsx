import { Link } from "react-router-dom";

// DemoLayout — variant of Layout.jsx for the no-auth /demo route.
//
// Differences from Layout:
//   * No NavLink tabs — demo only has Eat Me First. (Once a user signs up
//     they get the full 5-tab nav back via Layout.)
//   * Persistent "Trying ok2eat without an account" banner under the header
//     so it stays visible while the user scrolls the list.
//   * Header "Sign up" CTA on the right, prominent — every screen should
//     have an obvious exit ramp to the auth flow.
//
// The auth screen lives at /, so the CTA just navigates there.
export default function DemoLayout({ children }) {
  return (
    <div className="min-h-full bg-bg">
      <header className="sticky top-0 bg-card border-b border-border px-6 py-3 flex items-center justify-between z-30">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white text-xs font-bold">o</div>
          <span className="text-accent font-extrabold tracking-tight text-sm">ok2eat</span>
          <span className="ml-3 text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent/10 text-accent uppercase tracking-wide hidden sm:inline">
            Demo
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="px-3 py-1.5 rounded-full bg-accent text-white text-xs font-semibold hover:opacity-90 transition"
          >
            Sign up to start cooking
          </Link>
        </div>
      </header>

      {/* Persistent demo banner — keeps the "this is a tour, not real data"
          context in front of the user while they scroll. The CTA at the end
          is a backup for the header button on small screens. */}
      <div className="bg-accent/10 border-b border-accent/20 px-6 py-2.5 text-xs text-text">
        <div className="max-w-3xl mx-auto flex items-center gap-2 flex-wrap">
          <span className="font-semibold">You're in demo mode.</span>
          <span className="text-textSoft">
            This fridge isn't real — it's here so you can see how ok2eat ranks what to cook first.
          </span>
          <Link to="/" className="text-accent font-semibold underline-offset-2 hover:underline">
            Sign up →
          </Link>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  );
}
