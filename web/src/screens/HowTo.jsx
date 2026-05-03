import Layout from "../components/Layout.jsx";

// How To tab — static onboarding/help content. Mirrors the iOS HOWTO_SECTIONS
// array from App.js. Update the iOS array and this list together so iOS and
// web stay in sync.
//
// What's different from iOS:
//  - "Scanning receipts" is hidden because the web app doesn't have a camera
//    integration (yet). Future: add a "scan via QR-handoff to phone" tip
//    once Universal Links + the QR handoff feature ship (see BACKLOG).
const SECTIONS = [
  {
    icon: "📦",
    title: "Adding items",
    body: "Click the + Add item button on the Fridge tab. Type a name, pick a category, set how many days it lasts. The web app currently supports manual entry; for receipt and barcode scanning, use the iPhone app — items sync to your fridge here automatically.",
  },
  {
    icon: "🤝",
    title: "Sharing your fridge",
    body: "Open ok2eat on your iPhone, tap the share icon at the top of the Fridge tab, and invite a household member with the code. Once they enter it, you both see the same fridge in real time across all devices — phone or web.",
  },
  {
    icon: "🔔",
    title: "Reminders",
    body: 'The Alerts tab shows what\'s expired, what to use today, and what\'s expiring within 3 days. Toggle "Daily email digest" on to get a once-a-day summary delivered to your inbox.',
  },
  {
    icon: "📋",
    title: "Shopping lists",
    body: 'The Plan tab is your household\'s shared shopping list. Create as many lists as you want — "Costco", "This week", "Birthday party" — and they sync across phones and the web. Tap "Order N items" to open Instacart, Amazon, or Walmart with everything pre-loaded.',
  },
  {
    icon: "🍽️",
    title: "Recipe ideas",
    body: "The top of the Plan tab links out to AllRecipes, NYT Cooking, and Epicurious, seeded with what's in your fridge. Tap any source to get recipes built around what you already have.",
  },
  {
    icon: "📱",
    title: "Get the iPhone app",
    body: "ok2eat works best with the iPhone companion: barcode scanning, receipt scanning, and push notifications. Search 'ok2eat' in the App Store or visit ok2eat.com.",
  },
];

export default function HowTo({ user }) {
  return (
    <Layout user={user}>
      <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text tracking-tight">How To</h1>
        <p className="text-textSoft text-sm mt-0.5">
          Quick guide to getting the most out of ok2eat on the web.
        </p>
      </div>

      <div className="space-y-3">
        {SECTIONS.map(s => (
          <div key={s.title} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-xl flex-shrink-0">
                {s.icon}
              </div>
              <div className="flex-1">
                <h2 className="text-text font-semibold text-base">{s.title}</h2>
                <p className="text-textSoft text-sm mt-1.5 leading-relaxed">{s.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-xl border border-accent/30 bg-accent/5 p-5 text-center">
        <p className="text-text font-semibold text-sm">Have a question we didn't cover?</p>
        <p className="text-textSoft text-xs mt-1.5">
          Email{" "}
          <a href="mailto:support@ok2eat.com" className="text-accent underline">
            support@ok2eat.com
          </a>
          {" "}— Greg reads every message.
        </p>
      </div>
      </>
    </Layout>
  );
}
