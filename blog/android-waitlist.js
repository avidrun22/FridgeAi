// Wires the Android waitlist link + inline form on ok2eat.com.
// v1.19 — companion to /blog/newsletter.js, but POSTs to a different
// Edge Function (subscribe-android-waitlist) so the email lands in both
// our `android_waitlist` Supabase table AND a dedicated Resend audience.
//
// Markup it expects on the page:
//   <div data-android-waitlist>
//     <button data-android-toggle>...</button>
//     <form data-android-form hidden>
//       <input type="email">
//       <button type="submit">...</button>
//     </form>
//     <p data-android-msg></p>
//   </div>

(function () {
  const ENDPOINT = "https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/subscribe-android-waitlist";

  // Same public anon key the iOS + web apps + newsletter form use. Safe in
  // client code — RLS + the Edge Function's own validation are the actual
  // protection. Sharing one key keeps key-rotation surface area minimal.
  const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlbWFyaHZnZXV6aGx3eWJtYmllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2Njc2NTgsImV4cCI6MjA5MDI0MzY1OH0.ejYeJkucIwAWZ7Rf0hcmpIENSnnmXMh4V_nhjXlDQk4";

  document.querySelectorAll("[data-android-waitlist]").forEach((root) => {
    const toggle = root.querySelector("[data-android-toggle]");
    const form   = root.querySelector("[data-android-form]");
    const input  = form && form.querySelector('input[type="email"]');
    const button = form && form.querySelector('button[type="submit"]');
    const msgEl  = root.querySelector("[data-android-msg]");

    if (!toggle || !form || !input || !button) return;

    // Tap the link → reveal the form, focus the input.
    toggle.addEventListener("click", () => {
      if (form.hidden) {
        form.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        toggle.hidden = true;     // hide the link once the form is showing
        setTimeout(() => input.focus(), 30);
        // PostHog funnel hit: someone showed intent past CTA view.
        if (window.posthog && window.posthog.capture) {
          try { window.posthog.capture("android_waitlist_opened", { source: location.pathname }); } catch (_) {}
        }
      }
    });

    // Submit handler.
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = (input.value || "").trim().toLowerCase();
      if (!email) return;

      button.disabled = true;
      const originalLabel = button.textContent;
      button.textContent = "Adding…";
      if (msgEl) { msgEl.textContent = ""; msgEl.className = "android-waitlist-msg"; }

      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + ANON_KEY,
            "apikey": ANON_KEY,
          },
          body: JSON.stringify({ email, source: window.location.pathname }),
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || ("HTTP " + res.status));
        }

        const data = await res.json().catch(() => ({}));
        if (msgEl) {
          msgEl.textContent = data.already_on_list
            ? "✓ You're already on the list — we'll email you when Android launches."
            : "✓ You're on the list. We'll email you when Android launches.";
          msgEl.className = "android-waitlist-msg is-success";
        }
        input.value = "";
        button.textContent = "On the list";

        // PostHog conversion event — pairs with android_waitlist_opened
        // for the funnel: viewed CTA → opened form → submitted.
        if (window.posthog && window.posthog.capture) {
          try {
            window.posthog.capture("android_waitlist_signup", {
              source: location.pathname,
              already_on_list: !!data.already_on_list,
            });
          } catch (_) {}
        }
      } catch (err) {
        if (msgEl) {
          msgEl.textContent = "Couldn't save your email — try again or write to hello@ok2eat.com.";
          msgEl.className = "android-waitlist-msg is-error";
        }
        button.disabled = false;
        button.textContent = originalLabel;
        // eslint-disable-next-line no-console
        console.warn("[ok2eat] android-waitlist signup failed:", err);
      }
    });
  });
})();
