import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import { supabase } from "../lib/supabase.js";
import { CONTAINERS } from "../lib/constants.js";

// v1.22 #257 — Web port of the iOS ManageInventoryModal (App.js around
// line 5398). One screen that bundles three household-level reads:
//   1. household name + member count in the header
//   2. container item counts (Fridge / Pantry / Freezer)
//   3. member list via list_household_members RPC (RLS only lets a user
//      read their own household_members row, so we need the RPC)
// Plus an "Invite a family member" button that closes this modal and
// pops the existing HouseholdShareModal (the invite/redeem flow).
//
// Intentionally read-only — no mutations live here. iOS uses this as a
// landing page for household-level context; if a user wants to add or
// remove items they go back to the fridge list. Matching that mental
// model on web keeps the surface area small.
export default function ManageInventoryModal({ open, onClose, items, householdName, onOpenInvite }) {
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingMembers(true);
      try {
        const { data, error } = await supabase.rpc("list_household_members");
        if (!cancelled) setMembers(error ? [] : (data || []));
      } catch {
        if (!cancelled) setMembers([]);
      } finally {
        if (!cancelled) setLoadingMembers(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Per-container item counts. Default any item with a missing container
  // to 'fridge' to match the iOS behavior + the fridge_items row default.
  const counts = { fridge: 0, pantry: 0, freezer: 0 };
  for (const i of items || []) {
    const c = i.container || "fridge";
    if (counts[c] !== undefined) counts[c] += 1;
  }

  function initials(email) {
    if (!email) return "·";
    const local = email.split("@")[0];
    return (local[0] || "?").toUpperCase();
  }

  const memberCount = members.length || 1;
  const subtitle = `${householdName || "Your household"} · ${memberCount} ${memberCount === 1 ? "member" : "members"}`;

  return (
    <Modal open={open} onClose={onClose} title="Manage inventory" size="md">
      {/* Subtitle row — Modal only takes a title prop, so render the
          household name + member count inside the body as a sub-header. */}
      <p className="text-xs text-textSoft -mt-1 mb-5">{subtitle}</p>

      {/* Containers section */}
      <p className="text-[11px] font-mono uppercase tracking-wider text-muted mb-2 mt-1">// Containers</p>
      <div className="space-y-2 mb-6">
        {CONTAINERS.map(c => (
          <div
            key={c.id}
            className="flex items-center gap-3 p-3.5 rounded-xl border border-border bg-card"
          >
            <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
              <span className="text-sm font-bold text-accent">{c.label[0]}</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-text">{c.label}</p>
              <p className="text-xs text-textSoft mt-0.5">
                {counts[c.id]} {counts[c.id] === 1 ? "item" : "items"}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Members section */}
      <p className="text-[11px] font-mono uppercase tracking-wider text-muted mb-2">// Members</p>
      <div className="space-y-2 mb-4">
        {loadingMembers ? (
          <div className="p-4 text-center text-sm text-textSoft">Loading members…</div>
        ) : members.length === 0 ? (
          <div className="p-3.5 rounded-xl border border-border bg-card">
            <p className="text-sm text-textSoft">Just you for now — invite someone to share your fridge.</p>
          </div>
        ) : (
          members.map(m => (
            <div key={m.user_id} className="flex items-center gap-3 p-3.5 rounded-xl border border-border bg-card">
              <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                <span className="text-xs font-bold text-accent">{initials(m.email)}</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-text">{m.email}</p>
                <p className="text-[11px] text-textSoft mt-0.5">{m.is_owner ? "Owner" : "Member"}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <button
        onClick={() => {
          // Match iOS: close this modal first, then pop the invite flow.
          // The setTimeout gives the close animation a beat so the next
          // modal doesn't fight it on lower-end devices.
          onClose();
          setTimeout(() => onOpenInvite?.(), 200);
        }}
        className="w-full rounded-full bg-accent text-white py-3 text-sm font-semibold hover:bg-accent/90 transition"
      >
        Invite a family member
      </button>
    </Modal>
  );
}
