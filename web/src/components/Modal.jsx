import { useEffect } from "react";

// Centered overlay modal. Click outside or press Escape to close. Body
// scrolls inside the card when content overflows. Reusable for AddItem,
// ItemDetail, confirmation prompts, etc.
export default function Modal({ open, onClose, title, children, size = "md" }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === "Escape") onClose?.(); }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg" };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-surface rounded-2xl border border-border w-full ${widths[size] || widths.md} max-h-[90vh] overflow-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border sticky top-0 bg-surface z-10">
            <h2 className="text-lg font-bold text-text tracking-tight">{title}</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-bg hover:bg-card text-textSoft hover:text-text flex items-center justify-center text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        )}
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
