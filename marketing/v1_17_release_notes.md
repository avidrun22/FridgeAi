# v1.17 — App Store Connect copy

Paste these into the version-info form when App Store Connect lets you edit
v1.17 metadata (typically when the build hits "Prepare for Submission" state).
Two fields below: **What's New in This Version** (user-facing, ≤4000 chars)
and **Notes for Review** (reviewer-only, ≤4000 chars).

---

## What's New in This Version

Audience: any iOS user looking at the update screen. Conversational, customer-
benefit framing. Matches the brand voice you've used in past release notes.

```
v1.17 — Cleaner add flow + a real recovery path if you ever lose the welcome email.

• Multi-add is now front-and-center. "Add a List" sits alongside Scan Barcode and Scan Receipt at the top of the + screen — no more digging.

• Pick where it goes. Manual-add now has a Fridge / Pantry / Freezer picker, same as the receipt-scan and barcode flows. Pick once, the shelf-life lookup adapts.

• Recipe sheets close on tap-outside, or the new X button. No more feeling trapped.

• Tap any ok2eat link from Mail, Messages, or X and the app opens to the right screen. Universal Links wired up.

• Forgot to confirm your email? New "Resend confirmation" button on signup + login. No more starting over from scratch.

• Cleaner emails. Bigger type, sharper headers, the avocado where you'd expect it.

Free on iPhone and the web. Reply to any of our emails with anything broken or confusing — read same day.
— Greg
```

Char count ≈ 920. Well under the 4000 limit.

---

## Notes for Review

Audience: Apple's app reviewer. Gets them to the right screens fast so the
review pass takes minutes instead of hours.

```
Thanks for reviewing v1.17. The changes in this build are mostly UX polish plus a few flow fixes around the signup/email-confirmation path. Quick test plan below.

CHANGES SINCE v1.16:

1. AddModal (tap + on Fridge tab)
   - Three top tiles now: Scan Barcode, Scan Receipt, and Add a List (previously the third was hidden lower in the flow).
   - Below the OR ADD MANUALLY divider, the manual-add form has a new Fridge / Pantry / Freezer chip picker. Selecting one drives the USDA-FoodKeeper shelf-life lookup (different windows per container) and routes the new item to the right section.

2. Recipe sheet (Eat Me First tab → tap any item → tap "Get recipes")
   - X button in the top-right closes the sheet.
   - Tapping outside the sheet (backdrop) also closes it.

3. Universal Links
   - Tap an ok2eat.com link from Mail, Messages, or any app — ok2eat opens to the appropriate screen.
   - Apple App Site Association is hosted at https://ok2eat.com/.well-known/apple-app-site-association

4. Auth flow improvements
   - After Create Account, the user lands on a "Check your email" screen with a "Resend confirmation" button (previously bounced them back to Sign In via an Alert).
   - Login error for an unconfirmed email now surfaces an inline "Resend confirmation email" button. Both call supabase.auth.resend({ type: 'signup', email }).

DEMO ACCOUNT
   - Sign in with Apple is fully supported and is the fastest path to test. No demo email/password account required.
   - If you do prefer email signup: any address works; the build sends a verification email via Resend on signup.

KNOWN
   - App Preview video upload will follow this submission once metadata becomes editable.
   - No private API usage, no encryption beyond standard TLS, no third-party SDKs that require additional disclosures.

Backend changes (no UI footprint, just deliverability):
   - Onboarding email sequence (D0 / D2 / D5 / D10 since signup) wired via Supabase Edge Functions + pg_cron.
   - Behavioral nudges: users without a first item, users who've never used receipt scan.
   - auth.users trigger now auto-creates user_settings on signup so email-digest defaults apply universally.

Contact: hello@ok2eat.com if anything needs clarification mid-review.
```

Char count ≈ 1,830. Well under the 4000 limit.

---

## Where to paste

App Store Connect → ok2eat → iOS App → v1.17 → Distribution. Scroll to:

- **"What's New in This Version"** (under Promotional Text)
- **"Notes"** (under App Review Information → bottom of the page)

Both can be edited up until you submit the listing for review. After
submission, only via "Reject this binary" and re-submit. Use the Save button
after each paste.
