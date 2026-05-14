import { Link } from "react-router-dom";
import Modal from "./Modal.jsx";

// SignupPromptModal — the conversion moment in the /demo flow.
//
// Shown when a demo visitor tries an action that requires persistence:
// adding an item to a shopping list, saving a recipe, editing the fridge.
// Pattern follows the iOS "save your progress" sheet — the demo never
// blocks reading or browsing, only saving.
//
// The `reason` prop drives the copy so each conversion moment can have a
// specific hook ("Save this recipe", "Build your own shopping list", etc.)
// rather than one generic blocker.
export default function SignupPromptModal({ open, onClose, reason }) {
  const copy = REASONS[reason] || REASONS.default;

  return (
    <Modal open={open} onClose={onClose} size="sm" title={copy.title}>
      <p className="text-textSoft text-sm mb-5">{copy.body}</p>

      <div className="space-y-2">
        <Link
          to="/"
          className="block w-full text-center rounded-lg bg-accent text-white text-sm font-semibold py-2.5 hover:opacity-90 transition"
          onClick={onClose}
        >
          Create your account — free
        </Link>
        <button
          onClick={onClose}
          className="block w-full text-center rounded-lg border border-border bg-card text-text text-sm font-semibold py-2.5 hover:bg-bg transition"
        >
          Keep exploring the demo
        </button>
      </div>

      <p className="text-center text-xs text-muted mt-4 leading-relaxed">
        No credit card. Magic-link sign-in — no password to remember. Same
        account works on iPhone too.
      </p>
    </Modal>
  );
}

// Conversion-specific copy. The title tells the user what they tried to do,
// the body tells them what they get by signing up — benefit-led, not
// feature-led. Matches Greg's brand voice doc ("Your fridge knows what's
// expiring" framing, second-person).
const REASONS = {
  default: {
    title: "Sign up to save",
    body: "This action saves to your fridge. Create a free account so your items, recipes, and lists stick around.",
  },
  add_to_list: {
    title: "Build your own shopping list",
    body: "Add this recipe's missing ingredients to your shopping list — and bring your real fridge in so we can tell you what to cook tonight.",
  },
  save_recipe: {
    title: "Save this recipe",
    body: "Sign up to save recipes you like. We'll surface them again next time you have the same ingredients about to spoil.",
  },
  add_item: {
    title: "Add your own items",
    body: "The demo fridge is fixed so you can see how Eat Me First ranks. Sign up to add real items — by hand or by receipt scan — and we'll rank what's actually in your kitchen.",
  },
  scan_receipt: {
    title: "Scan your grocery receipt",
    body: "Snap a picture of any receipt and we'll fill your fridge in seconds — every line categorized, every expiry date set from USDA shelf-life data. Sign up free to try it on your next grocery run.",
  },
};
