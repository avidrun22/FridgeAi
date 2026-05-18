# v1.23 — Release Notes

Paste the body of "App Store version notes" into App Store Connect →
this version → "What's New in This Version". Paste Google Play version
notes into the Play Console release page. The reviewer-notes blocks go
into the "Notes" / "Reviewer instructions" fields.

v1.23 is a focused maintenance release — two user-visible changes:
self-serve password reset and an Android-only nav-bar fix. Smaller
than v1.22 by design; queue larger work for v1.24.

---

## App Store version notes (iOS users see this)

What's new in v1.23:

• Forgot your password? Fixed. The login screen now has a "Forgot
  password?" link — tap it, type your email, set a new password
  from the link we send. No more emailing support to get back in.

• Quiet bug fixes and polish under the hood.

Reply to any of our emails with anything broken or confusing — read
same day. — Greg

---

## Google Play version notes (Android users see this)

What's new in v1.23:

• Forgot your password? Fixed. The login screen has a "Forgot
  password?" link now — tap it, type your email, set a new password
  from the link we send.

• Bottom nav bar no longer hides behind the system gesture handle
  on Pixel 9 and Samsung S-series devices. Tapping FRIDGE, EAT FIRST,
  PLAN, DASHBOARD, and SETTINGS is back to a clean tap target.

Reply to any of our emails with anything broken or confusing — read
same day. — Greg

---

## App Store Connect — internal release notes (App Review team)

For Apple's reviewers, in the "Notes" field on the version page:

```
v1.23 — Password reset self-serve flow.

No new permissions, no new account types, no new external APIs.
Same auth pattern as v1.22. To verify the new flow:

1. Sign out (Settings tab → Sign out) or open the app on a device
   with no session.

2. On the Sign In tab, enter the demo email from the App Review
   credentials field, then tap "Forgot password?" (new link below
   the Sign In button).

3. A success message appears: "Reset link sent — check your email
   (and spam folder). Set your new password on the web, then come
   back here to sign in."

4. The reset email is sent via Supabase Auth (RFC-standard password
   recovery). The link in the email opens
   https://app.ok2eat.com/reset-password where the recovery token
   from the URL hash is exchanged for a short-lived session, the
   user types a new password, and the session is cleared — they
   sign back into iOS with the new password.

   This is identical to the standard "Forgot password" pattern used
   by every iOS app with email/password auth (Lyft, Strava, Notion).
   No iOS-side credential capture; the new password is set via the
   web component over HTTPS.

Other changes in this build are below the surface (logging cleanup,
analytics event naming consistency). No content or rating impact.
```

---

## Google Play — internal release notes (Play Console reviewers)

For Google Play's reviewers, in the "Release notes for reviewers"
field on the closed-testing or production track:

```
v1.23 — Password reset + bottom nav inset fix.

Changes since v1.21 (Play Console's last reviewed version):

1. Forgot password flow on the login screen (Sign In tab → Forgot
   password? link). Sends a Supabase Auth password recovery email
   that redirects to https://app.ok2eat.com/reset-password — user
   sets a new password on the web, then signs back into the Android
   app with the new password. No Android-side credential capture;
   reset happens via the web component over HTTPS.

2. Bottom navigation bar paddingBottom bumped from 24px to 36px on
   Android only (iOS unchanged). Earlier value was overlapping the
   system gesture handle on Pixel 9 and Samsung S-series in
   edge-to-edge gesture-nav mode, making FRIDGE / EAT FIRST / PLAN /
   DASHBOARD / SETTINGS tabs hard to tap. Tester report from
   internal testing track.

No new permissions, no new external APIs, no Data Safety section
changes. Same auth, same data access pattern as v1.21.

To verify: sign out, tap Forgot password? on the Sign In tab, check
that the email arrives, then confirm the reset flow lands in the
web page and updates the password.
```

---

## Promotional text (optional, 170 char limit)

For the App Store's separately-editable promotional text field
(does NOT require an Apple review when changed):

```
Forgot your password? Tap the new link on the login screen, set
a new one from the email we send. Plus quiet polish under the hood.
```

(155 chars)

---

## Brand voice checklist (from CLAUDE.md)

- ✅ Benefit-led ("Forgot your password? Fixed." not "Added password reset flow")
- ✅ Second-person ("Tap it", "Set a new password", "Type your email")
- ✅ Em-dashes preserved
- ✅ Closes with "Reply to any of our emails… — Greg" signoff
- ✅ No buzzwords ("revolutionary", "industry-leading", "AI-powered")
- ✅ No emoji-stuffed bullets
- ✅ Specific where helpful (Pixel 9, Samsung S-series, the actual tap path)
  over vague claims ("certain devices", "improved layout")

---

## Post-approval ritual (per CLAUDE.md)

Once Apple approves v1.23 and it goes live in the App Store:

1. Update `ok2eat.html` hero badge:
   `<div class="hero-badge">v1.23 · iOS + web</div>`

2. Update `ok2eat.html` JSON-LD `softwareVersion` to `"1.23"`

3. Deploy the marketing site:
   `python3 scripts/deploy_website.py`

DO NOT bump the hero badge or JSON-LD before approval — the badge
must always reflect what's actually live in the App Store, not what's
pending. Visitors who tap "Download on the App Store" get whatever
Apple is serving.

---

## What's in this build (for our reference, not the App Store)

Tasks closed in v1.23:

- #261 — Password reset flow across iOS / Android / web. App.js gets
  a visible "Forgot password?" link below the Sign In button in
  login mode; tap calls supabase.auth.resetPasswordForEmail with
  redirectTo=https://app.ok2eat.com/reset-password. The web side
  (already shipped pre-Apple-approval) handles the recovery token
  via a new /reset-password route and a ResetPassword component
  that listens for PASSWORD_RECOVERY auth events.

- #264 — Android nav bar bottom padding fix. paddingBottom on the
  bottom navBar bumped from 24px to 36px when Platform.OS ==='android';
  iOS unchanged (SafeAreaView handles the home indicator there).
  Reported by Android tester on Samsung S-series; reproduced on
  Pixel 9 emulator in gesture-nav mode.

Both changes live in App.js (shared by iOS + Android via Expo).

Supabase config that landed last session and that v1.23 depends on:

- The Reset Password email template was branded (#262). Sender
  swapped from noreply@ok2eat.com to hello@ok2eat.com to clear
  Gmail's "dangerous mail" classifier. Both changes are LIVE in
  Supabase already — no deploy needed.

- https://app.ok2eat.com/* is already in the redirect URL allowlist
  (wildcard covers /reset-password).
