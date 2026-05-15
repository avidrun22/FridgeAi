import Modal from "./Modal.jsx";

// DemoShoppingListModal — shows the accumulated list a demo visitor has
// built by tapping "Add missing ingredients to shopping list" inside one
// or more recipe sheets. This is where the moved-back conversion gates
// fire — visitors can browse and build freely, but the moment they want
// to PERSIST or SHARE that list, we ask them to sign up.
//
// Per #216: gating at save/share (not at add) means users have built
// something they care about before we ask anything. Much higher signup
// intent than the previous "block-at-add" behavior.

export default function DemoShoppingListModal({
  open,
  onClose,
  items,
  onClear,
  onSave,
  onShare,
}) {
  // Group items by source recipe so the visitor sees "this came from
  // Cilantro-lime salmon" and not a flat anonymous list.
  const grouped = items.reduce((acc, it) => {
    const key = it.recipeName || "Added directly";
    (acc[key] = acc[key] || []).push(it);
    return acc;
  }, {});

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Your shopping list">
      <div className="max-h-[75vh] overflow-y-auto">
        {items.length === 0 ? (
          <div className="py-10 text-center text-textSoft text-sm">
            Your list is empty. Tap into a recipe and add its missing ingredients to start building.
          </div>
        ) : (
          <>
            <p className="text-textSoft text-sm mb-4">
              {items.length} {items.length === 1 ? "item" : "items"} pulled from {Object.keys(grouped).length} {Object.keys(grouped).length === 1 ? "recipe" : "recipes"}.
            </p>

            <div className="space-y-4 mb-6">
              {Object.entries(grouped).map(([recipeName, recipeItems]) => (
                <div key={recipeName} className="rounded-xl border border-border bg-bg p-4">
                  <p className="text-text font-bold text-sm mb-2">{recipeName}</p>
                  <ul className="text-text text-sm space-y-1">
                    {recipeItems.map((it, j) => (
                      <li key={j} className="flex items-baseline gap-2">
                        <span className="text-textSoft">•</span>
                        <span className="flex-1">{it.item}{it.amount ? <span className="text-textSoft"> — {it.amount}</span> : null}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* Save + Share — these are the conversion gates. Visitors
                can tap either; each triggers a different SignupPromptModal
                reason in Demo.jsx with bespoke copy. */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                onClick={onSave}
                className="px-4 py-3 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90 transition"
              >
                Save this list
              </button>
              <button
                onClick={onShare}
                className="px-4 py-3 rounded-xl border-2 border-accent text-accent text-sm font-semibold hover:bg-accent/10 transition"
              >
                Share with someone
              </button>
            </div>
            <button
              onClick={onClear}
              className="block w-full text-center text-textSoft text-xs font-medium py-2 hover:text-text transition"
            >
              Clear demo list
            </button>
          </>
        )}

        <button
          onClick={onClose}
          className="mt-4 w-full px-4 py-2 rounded-lg border border-border bg-card text-text text-sm font-semibold hover:bg-bg transition"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}
