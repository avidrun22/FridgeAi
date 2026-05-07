// PostHog wrapper for the web app. Mirrors the iOS App.js helper so events
// land in the same project (382774) and can be cohorted across iOS + web.
//
// Why a wrapper instead of importing posthog-js everywhere:
//   - Single init call, single source of truth for the project key.
//   - track() never throws — analytics should never crash a render.
//   - identify() / reset() are wired into the auth state listener once,
//     so feature code just calls track() and forgets.
//   - Easy to swap to a different vendor later without grep-and-replace
//     across every component.
//
// Usage:
//   import { initAnalytics, track, identify, resetAnalytics } from "./lib/analytics.js";
//   initAnalytics();                          // call once on app boot
//   track("event_name", { prop: "value" });   // call from anywhere
//   identify(user.id);                        // on sign-in
//   resetAnalytics();                         // on sign-out
//
// The PostHog project key below MUST match the one in App.js (the
// React Native app) so iOS + web events are unified. Public client-side
// keys are designed to be embedded — no secret rotation needed.
import posthog from "posthog-js";

const POSTHOG_PROJECT_KEY = "phc_szxhjw2eQmYYhNGicX3kmNXxdz47Sj7evqx5Quqw8dTY";
const POSTHOG_HOST = "https://us.i.posthog.com"; // ingestion endpoint

let _initialized = false;

export function initAnalytics() {
  if (_initialized) return;
  if (typeof window === "undefined") return; // SSR / build-time guard
  try {
    posthog.init(POSTHOG_PROJECT_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: false, // explicit events only — keeps the dashboard clean
      // We want tagged events to merge cleanly with iOS, so use the same
      // person_profiles model: identified_only means anonymous visitors
      // don't bloat the user count until they actually sign in.
      person_profiles: "identified_only",
    });
    _initialized = true;
  } catch (e) {
    // Failures here are silent on purpose — analytics never blocks the app.
    // Common causes: ad-blockers, privacy extensions, network errors. If
    // PostHog is unreachable, every track() call below is a no-op.
    if (typeof console !== "undefined") console.warn("[ok2eat] analytics init failed:", e);
  }
}

export function track(event, properties) {
  try {
    if (!_initialized) return;
    posthog.capture(event, { ...(properties || {}), platform: "web" });
  } catch (e) { /* never crash the app on a track call */ }
}

export function identify(userId, properties) {
  try {
    if (!_initialized || !userId) return;
    posthog.identify(userId, properties);
  } catch (e) { /* noop */ }
}

export function resetAnalytics() {
  try {
    if (!_initialized) return;
    posthog.reset();
  } catch (e) { /* noop */ }
}

// Used for client-side route changes (react-router doesn't trigger full
// navigations, so PostHog's automatic pageview tracker only catches the
// first one). Call this in a useEffect that depends on the current path.
export function trackPageView(path) {
  try {
    if (!_initialized) return;
    posthog.capture("$pageview", { $current_url: path || (typeof window !== "undefined" ? window.location.href : ""), platform: "web" });
  } catch (e) { /* noop */ }
}
