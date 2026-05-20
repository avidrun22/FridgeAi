import { useEffect, useState } from "react";
import { supabase } from "./supabase.js";
import { track } from "./analytics.js";

// v1.25 #284 — Onboarding gate hook. Mirror of the gate logic in App.js.
//
// Until the user has crossed the 4-item threshold at least once, the
// Eat Me First / Plan / Dashboard tabs are disabled and direct-URL
// navigation to those routes redirects to /fridge. Once they hit 4 items,
// the unlock is persisted (user_settings.onboarding_4_items_unlocked_at)
// and never resets — even if they later delete items down to 0.
//
// Settings stays unlocked regardless so users can sign out / change account
// / see version info; locking Settings would be a trap.
//
// Fail-open default: any read error (network, missing row, RLS hiccup) sets
// locked=false. Better to let someone through than lock them out.
//
// Returns: { locked, itemsRemaining }
//   - locked: true ⇒ disable nav + redirect from gated routes
//   - itemsRemaining: count needed to unlock (4 - current items, clamped at 0)
export function useOnboardingGate(userId) {
  const [locked, setLocked]                 = useState(false);
  const [itemsRemaining, setItemsRemaining] = useState(0);

  useEffect(() => {
    if (!userId) { setLocked(false); return; }
    let cancelled = false;

    async function evaluate() {
      try {
        // Two parallel queries: (1) the unlock timestamp from user_settings,
        // (2) the current item count from fridge_items. If either says
        // "unlocked", we're done.
        const [settingsRes, itemsRes] = await Promise.all([
          supabase
            .from("user_settings")
            .select("onboarding_4_items_unlocked_at")
            .eq("user_id", userId)
            .maybeSingle(),
          supabase
            .from("fridge_items")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId),
        ]);
        if (cancelled) return;

        const alreadyUnlocked = !!settingsRes?.data?.onboarding_4_items_unlocked_at;
        const itemCount = itemsRes?.count ?? 0;

        if (alreadyUnlocked) {
          setLocked(false);
          setItemsRemaining(0);
          return;
        }

        if (itemCount >= 4) {
          // First time crossing the threshold this session. Persist + unlock.
          await supabase.from("user_settings").upsert({
            user_id: userId,
            onboarding_4_items_unlocked_at: new Date().toISOString(),
          }, { onConflict: "user_id" });
          if (!cancelled) {
            setLocked(false);
            setItemsRemaining(0);
            track("onboarding_gate_unlocked", { item_count: itemCount, surface: "web" });
          }
          return;
        }

        // Still locked.
        setLocked(true);
        setItemsRemaining(Math.max(0, 4 - itemCount));
      } catch (e) {
        // Fail open — don't lock out a paying user over a transient query failure.
        console.warn("[gate] read failed:", e?.message || e);
        if (!cancelled) {
          setLocked(false);
          setItemsRemaining(0);
        }
      }
    }

    evaluate();
    return () => { cancelled = true; };
  }, [userId]);

  return { locked, itemsRemaining };
}
