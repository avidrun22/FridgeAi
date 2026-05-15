# v1.22 Android — kickoff brief

**Status as of 2026-05-15:** ok2eat iOS v1.21 build 27 just submitted to App
Store (~11:18am PDT). Greg wants to start Android while v1.21 is in Apple
review.

When you come back to start Android, paste this whole file into a fresh
Claude session as the kickoff prompt. Everything below is self-contained
so the next Claude doesn't need this conversation's memory.

---

## Context to read first

1. `CLAUDE.md` — project conventions. Critical:
   - "Drive by default" — don't hand Greg lists of commands; do it yourself
     unless the action needs his terminal (eas build / supabase functions
     deploy / git push).
   - "Web ships in lockstep with iOS" since v1.20.
   - "Android (v1.21+) follows the same rule once it lands. Treat iOS +
     web + Android as three render targets for the same product."
   - Brand voice for any copy.

2. `BACKLOG.md` — task #189 ("v1.21+ — Android version (Expo build +
   Google Play submission)") and #199 ("Android waitlist on homepage").
   The waitlist is already collecting signups into the `android_waitlist`
   Supabase table — those users are who this is for.

3. `app.json` — Expo config. Android section has package id
   `com.gregorygoldberg.ok2eat`, adaptiveIcon, CAMERA + INTERNET
   permissions. iOS just shipped at version 1.21 / buildNumber 24
   (EAS auto-bumped to 27 on upload).

## What just shipped on iOS (v1.21) — Android needs eventual parity

- Sharable shopping lists (Plan tab Share pill → `share_token` → public
  page at `ok2eat.com/lists/?t={token}`)
- Sharable recipes (recipe sheet Share button → public page at
  `ok2eat.com/recipes/{slug}`)
- "Use today" copy on day-0 expiry items (vs. "Expired" only on
  negative-day items)
- The whole v1.18/v1.19 recipe browser + Eat Me First + Dashboard tabs
- Universal Links: `applinks:ok2eat.com` + `applinks:app.ok2eat.com`

Release notes draft: `marketing/v1_21_release_notes.md`.

## Phase plan for Android

### Phase 1 — Minimum viable build
- Sign-in / sign-up works
- Fridge tab loads + add/remove items works
- Internal distribution build via EAS, installed via QR code on Greg's
  Android device for smoke testing
- No push notifications, no Universal Links yet
- Target: 1-2 sessions

### Phase 2 — Feature parity with iOS
- Push notifications via FCM (different from iOS APNS)
- Universal Links via Digital Asset Links (`assetlinks.json` on
  `ok2eat.com/.well-known/`)
- Recipe browser, Eat Me First, Dashboard, sharing flows
- Audio polish (any Android-specific quirks)
- Target: 2-3 sessions

### Phase 3 — Google Play submission
- Google Play Console developer account ($25 one-time, Greg must do)
- Closed testing → open testing → production
- Same screenshot + listing copy refresh ritual as App Store
- Target: 1-2 sessions

## Discovery questions to ask Greg before writing code

These are blocking. Use the AskUserQuestion tool for each.

1. **Google Play Console account.** Does Greg already have a developer
   account registered ($25 one-time fee)? If not, that's a blocker for
   Phase 3 — he needs to sign up at `play.google.com/console`.

2. **Firebase / FCM setup.** Has Greg created a Firebase project for
   ok2eat? Android push notifications via Expo need FCM credentials and
   a `google-services.json` file at the project root. iOS uses APNS so
   none of this is set up yet.

3. **Distribution scope.** Phase 1 target: just Greg's personal Android
   device via EAS internal distribution? Or wider closed beta from the
   start?

4. **Branding refresh.** Same icon + splash as iOS, or anything to
   refresh for the Android adaptiveIcon (which has the foreground/
   background split that iOS doesn't)?

5. **Push notifications priority.** Phase 1 with no push OK, or is push
   a must-have? Push is the biggest source of cross-platform divergence.

## Codebase audit checklist (do this before writing code)

Grep App.js for iOS-only assumptions:

- `Platform.OS === "ios"` — see what branches exist
- `Linking.openURL` with `ok2eat://` — verify Android intent filter is
  in place in `app.json` (currently isn't)
- `Share.share` — `url` parameter is iOS-only; verify it's conditionally
  passed (or harmless on Android — RN ignores unknown fields)
- `expo-notifications` — needs FCM token registration on Android, which
  is different from APNS on iOS
- `react-native-vision-camera` — works on Android but config differs;
  check that the plugin is added in `app.json`
- `expo-haptics`, `expo-clipboard`, `expo-image-picker` — confirm
  Android compatibility
- Status bar / safe area handling — Android has notches + different
  insets

Also audit `app.json` for Android-specific config it's missing:
- `versionCode` (integer-incrementing, Android equivalent of buildNumber;
  start at 1)
- `intentFilters` for Universal Links (Phase 2)
- `googleServicesFile` path (Phase 2, when FCM is wired)
- Any permissions beyond CAMERA + INTERNET (e.g. POST_NOTIFICATIONS for
  Android 13+)

## Deliverable for the first session

- Status note: what's shipping on iOS v1.21 + what Android unlocks
  (66 email digest users today, X Android waitlist users in
  `android_waitlist` Supabase table)
- Ask the 5 discovery questions above (use AskUserQuestion, one at a
  time or batched).
- Pull the actual codebase audit results (grep + screenshot of
  `app.json`).
- Save a 1-page Phase 1 spec at `docs/v1_22_android_phase1.md` with the
  exact scope, files to touch, and EAS build command (don't run it
  yourself — Greg's `eas build` command needs his Mac and Apple/Google
  credentials).
- Don't promise feature parity in v1.22.0. iOS is on v1.21; Android starts
  from scratch and full parity will take a few releases.

## What NOT to do in the first Android session

- Don't run `eas build --platform android` without Greg's explicit
  approval of the Phase 1 scope.
- Don't create a Google Play account or Firebase project on Greg's
  behalf — both need his login.
- Don't reuse the iOS buildNumber (24) as Android versionCode — they're
  independent. Start versionCode at 1.
- Don't blast through code on the first session. Discovery questions
  first.
