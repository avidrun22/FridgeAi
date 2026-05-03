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
    body: "Click + Add item on the Fridge tab. Start typing a name and ok2eat will search a catalog of 800,000+ US grocery products in real time — pick a result and the category, expiration, and nutrition fields fill in automatically. Or skip the search and type the details manually for items that aren't in the catalog (deli, produce, leftovers).",
  },
  {
    icon: "🔍",
    title: "Smart product search",
    body: "The Add Item search box is powered by Open Food Facts, a free open product database, and our own community-captured scans. As you type, you'll see matching products with brands and categories. Faster than typing, more accurate than guessing. Future updates will add semantic search and personal-history ranking so the items you buy most are always at the top.",
  },
  {
    icon: "🤝",
    title: "Sharing your fridge + lists",
    body: "Everything in ok2eat is household-shared. On the iPhone app, tap the share icon at the top of the Fridge tab and send the invite code to anyone you live with. Once they join, you both see the same fridge AND the same shopping lists in real time — add an item on one phone, it appears on the other within seconds. Each item shows a small initial badge so you can tell who added what.",
  },
  {
    icon: "📋",
    title: "Shared shopping lists",
    body: 'The Plan tab is multi-list. Create separate lists for "Costco trip", "Trader Joe\'s", "Birthday party" — whatever helps you keep things organized. Each list shows real-time additions from your household. Hit "Order N items" to open Instacart, Amazon, or Walmart with everything pre-loaded into search. When a trip is done, archive the list to Past Lists; next time, clone it in one tap to reuse the same items.',
  },
  {
    icon: "🔔",
    title: "Reminders + alerts",
    body: "The Alerts tab buckets items by urgency: Expired, Use today/tomorrow, Expiring within 3 days. Toggle the daily email digest on to get a once-a-day summary delivered to your inbox at 9am. iPhone users also get push notifications.",
  },
  {
    icon: "🍽️",
    title: "Recipe ideas",
    body: "The top of the Plan tab links out to AllRecipes, NYT Cooking, and Epicurious — seeded with what's actually in your fridge right now. One tap to find recipes built around what you have, instead of buying more groceries you don't need.",
  },
  {
    icon: "📱",
    title: "Get the iPhone app",
    body: "ok2eat works best with the iPhone companion. Barcode scanning, receipt scanning (snap a photo, AI extracts every line item with prices), and push notifications all live there. Search 'ok2eat' in the App Store or visit ok2eat.com — same household, same data, just different surfaces.",
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
