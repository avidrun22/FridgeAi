// Wires every <form data-newsletter> on the page to the subscribe-newsletter
// Supabase Edge Function. Disables the button while in flight, shows a
// success/error message inline. No external dependencies.

(function () {
  const ENDPOINT = "https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/subscribe-newsletter";

  // Same anon key the iOS + web apps use. Safe to ship in client code —
  // RLS + the Edge Function's own validation are what actually protect data.
  const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlbWFyaHZnZXV6aGx3eWJtYmllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2Njc2NTgsImV4cCI6MjA5MDI0MzY1OH0.ejYeJkucIwAWZ7Rf0hcmpIENSnnmXMh4V_nhjXlDQk4";

  document.querySelectorAll("form[data-newsletter]").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const button = form.querySelector("button");
      const input  = form.querySelector('input[type="email"]');
      const msgEl  = form.parentElement.querySelector("[data-newsletter-msg]");

      const email = (input.value || "").trim().toLowerCase();
      if (!email) return;

      button.disabled = true;
      const originalLabel = button.textContent;
      button.textContent = "Subscribing…";
      if (msgEl) { msgEl.textContent = ""; msgEl.className = "signup-msg"; }

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

        if (msgEl) {
          msgEl.textContent = "✓ You're in. Check your inbox to confirm.";
          msgEl.className = "signup-msg is-success";
        }
        input.value = "";
        button.textContent = "Subscribed";
      } catch (err) {
        if (msgEl) {
          msgEl.textContent = "Couldn't subscribe — try again or email digest@ok2eat.com.";
          msgEl.className = "signup-msg is-error";
        }
        button.disabled = false;
        button.textContent = originalLabel;
        // eslint-disable-next-line no-console
        console.warn("[ok2eat] newsletter signup failed:", err);
      }
    });
  });
})();
