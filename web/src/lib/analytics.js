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
// v1.22 — Route ingestion through our PostHog Managed Proxy (Cloudflare
// edge in front of PostHog). The proxy lives at e.ok2eat.com via CNAME →
// cf-prod-us-proxy.proxyhog.com. Bypasses ad-blockers since requests
// look first-party. Privacy policy updated 2026-05-17 to disclose
// Cloudflare as a subprocessor.
const POSTHOG_HOST = "https://e.ok2eat.com"; // ingestion via managed proxy

// App version for the web client. Surfaced via Vite at build time — set in
// vite.config when we deploy. Falls back to "web" if the env var isn't
// present (older deploys or local dev) so version-breakdown queries still
// have a stable bucket to count against. iOS uses semantic versions like
// "1.17"; web buckets are tagged "web-YYYY-MM-DD" or "web" so we can tell
// the two surfaces apart in the same chart without complex joins.
const APP_VERSION =
  (typeof import.meta !== "undefined" && import.meta?.env?.VITE_APP_VERSION) ||
  "web";

let _initialized = false;

export function initAnalytics() {
  if (_initialized) return;
  if (typeof window === "undefined") return; // SSR / build-time guard
  try {
    posthog.init(POSTHOG_PROJECT_KEY, {
      api_host: POSTHOG_HOST,
      // ui_host points back at the real PostHog UI so toolbar links and
      // "view recording" deep-links land in the dashboard (api_host is the
      // ingestion proxy at e.ok2eat.com).
      ui_host: "https://us.posthog.com",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: false, // explicit events only — keeps the dashboard clean
      // We want tagged events to merge cleanly with iOS, so use the same
      // person_profiles model: identified_only means anonymous visitors
      // don't bloat the user count until they actually sign in.
      person_profiles: "identified_only",
    });
    // Register platform + app_version as super-properties so they attach to
    // EVERY event posthog-js sends — including the auto-fired $pageview,
    // $pageleave, and $identify. Without this, only events that go through
    // track() would carry the tag (the wrapper adds it explicitly), leaving
    // auto-events with platform=null and breaking version-distribution
    // queries that join iOS + web.
    posthog.register({ platform: "web", app_version: APP_VERSION });
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
    posthog.capture(event, { ...(properties || {}), platform: "web", app_version: APP_VERSION });
  } catch (e) { /* never crash the app on a track call */ }
}

export function identify(userId, properties) {
  try {
    if (!_initialized || !userId) return;
    // $set pushes the latest known version onto the person profile so we
    // can query "what version is user X on RIGHT NOW?" — different from
    // the per-event view. $set_once preserves the first version a user
    // ever signed in on for acquisition-cohort analysis.
    posthog.identify(userId, {
      ...(properties || {}),
      $set: {
        ...(properties?.$set || {}),
        app_version: APP_VERSION,
        platform: "web",
      },
      $set_once: {
        ...(properties?.$set_once || {}),
        first_seen_app_version: APP_VERSION,
        first_seen_at: new Date().toISOString(),
      },
    });
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
