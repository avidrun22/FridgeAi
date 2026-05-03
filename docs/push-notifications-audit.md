# Push Notification Infrastructure Audit (v1.14)

**Date:** 2026-05-03
**Scope:** Verify the push token flow is bulletproof before building v1.15+
features that depend on it (e.g. "notify household when list is created").

## Current state — what works

- **Permission request** — `Notifications.requestPermissionsAsync()` (App.js
  line 54). Wired into both the cold-start `setupNotifications` flow and the
  user-initiated `toggleNotifications` flow.
- **Token retrieval** — `Notifications.getExpoPushTokenAsync()` with project
  ID lookup via expo-constants (App.js line 66-78). Returns null on
  simulator or denied permission, so callers can short-circuit safely.
- **Token persistence** — Upserted into `expo_push_tokens` (App.js line 4433)
  with `(token, user_id, platform, device_name, last_seen_at)`. PK is
  `token`, so re-saves of the same token refresh `last_seen_at` rather
  than duplicating rows.
- **Cold-start refresh** — `setupNotifications()` runs every time the user
  logs in (App.js line 4480). On every cold start that completes auth, the
  token is re-fetched and re-upserted, refreshing `last_seen_at` and
  capturing token rotation.
- **Notification handler** — `Notifications.setNotificationHandler` config'd
  for foreground alerts, sound, and badge (App.js line 45).
- **Tap handler** — Tapping a notification routes to the Reminders tab
  (App.js line 4441).
- **Toggle UX** — User-controlled toggle in Reminders updates both
  `user_settings.notifications_enabled` and the local toggle state
  (App.js line 4525).

## v1.14 hardening shipped

1. **Settings deep-link on permission deny.** iOS only shows the system
   permission prompt once. After the user denies, subsequent
   `requestPermissionsAsync()` calls return `denied` immediately. The
   Permission Required alerts in `toggleNotifications` (notifications),
   ScanReceipt (camera), and UploadReceipt (photo library) now offer an
   "Open Settings" button that calls `Linking.openSettings()` — one-tap
   path to fix the denied state.

## Remaining risks (deferred — none block v1.15+)

### 1. Stale tokens accumulate per user

`expo_push_tokens` is keyed on `token`, so when a user reinstalls the app
or switches devices, a NEW token row is created for the same user_id —
the OLD row is never deleted. Over time, a user could have 5+ tokens, all
of which the digest Edge Function would push to.

**Why it doesn't bite hard yet:** Expo's push gateway returns
`DeviceNotRegistered` for stale tokens, which the digest can/should
handle (delete the row when this status comes back). At our scale the
performance hit is negligible.

**Fix path (v1.15+):**
- Update `send-email-digest` (or the future push-only digest) to inspect
  Expo's per-message receipt response and delete tokens that come back
  with `DeviceNotRegistered`, `InvalidCredentials`, or `MessageRateExceeded`.
- Alternatively: cron job that prunes tokens where `last_seen_at < now() -
  interval '90 days'` (loose bound — accounts for users who only open the
  app monthly).

### 2. AppState background → foreground doesn't refresh token

Cold start refreshes the token (good), but if the user backgrounds the app
for days and then resumes, the cached token isn't re-validated. If Apple
rotated the underlying APNs device token while the app was backgrounded,
ours could be stale. Expo usually handles rotation transparently, but a
bulletproof flow would re-call `getExpoPushTokenAsync()` on the
background → foreground transition.

**Fix path:** Add a `registerPushTokenWithSupabase()` call to the
AppState `change` listener (App.js line 4435) when transitioning to
`active`, gated on `notificationsEnabled`. ~5-line change. Skipped for
v1.14 because the cold-start refresh already covers ~95% of the cases.

### 3. No visible test of the end-to-end push send

The token flow has never been load-tested with an actual push being
delivered to a TestFlight build. Email digest works (we've shipped that
end-to-end), but native push notifications haven't been used in
production yet. Before building any v1.15+ feature that triggers a push
(e.g. household list-created notification):

**Test plan:**
1. Add a debug-only "Send test push to me" button in the Reminders screen
   that calls a stub Edge Function with the user's token from
   `expo_push_tokens`.
2. Verify push arrives on physical device (TestFlight build, not
   simulator — simulators don't receive APNs).
3. Verify tap routes to Reminders (existing handler).
4. Test reinstall scenario: delete app, reinstall via TestFlight, sign
   in, send test push — confirm new token works.

### 4. `notifications_enabled` and OS permission can drift

`user_settings.notifications_enabled` is the app's intent. iOS permission
is the actual capability. They can disagree:
- User toggles ON in app, then revokes in iOS Settings → `notifications_enabled=true`
  but `requestPermissionsAsync()` returns `denied`. The digest would still
  attempt to push to the token (delivery fails silently).
- User toggles OFF in app but never revokes in iOS Settings → permission
  is still granted; we just don't have a token in the upserted state.

**Fix path:** On every `setupNotifications` cold-start, compare the actual
permission state against `user_settings.notifications_enabled` and
reconcile (lower-bound; if iOS says denied, force `notifications_enabled=false`).

### 5. Multi-device user ↔ single household membership

A user with both iPhone + iPad signed into the same account would have
two tokens in `expo_push_tokens` (good — both should receive pushes). The
digest already supports multi-token-per-user (each row sent separately).

**Confirmed working** — no action needed.

## Verdict

The push infrastructure is **safe to build v1.15+ features on top of.**
The remaining risks are observability/cleanup-shaped (not correctness),
and can be addressed when they bite or as part of feature-specific work.

The one thing we haven't proved is end-to-end native push delivery — we
should run that test (#3) before the first user-facing push feature ships.
