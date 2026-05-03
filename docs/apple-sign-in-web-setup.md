# Sign in with Apple — Web Setup

The web AuthScreen has a "Sign in with Apple" button that calls
`supabase.auth.signInWithOAuth({ provider: 'apple' })`. Supabase brokers
the redirect to Apple. To make it actually work end-to-end, you need to
wire up two consoles: **Apple Developer** and **Supabase Dashboard**.

You only have to do this once. Total time: ~15 minutes.

---

## 1. Apple Developer Console

URL: https://developer.apple.com/account → **Certificates, Identifiers & Profiles**

### 1a. Create a Services ID (the "web" identifier)

The iOS app already uses an App ID like `com.ok2eat.app`. For the web flow,
Apple requires a separate **Services ID**. Think of the Services ID as
"the same product on the web."

1. Identifiers → click the **+** button.
2. Pick **Services IDs** → Continue.
3. Description: `ok2eat web`
4. Identifier: `com.ok2eat.app.web` (or `com.ok2eat.web` — anything that
   isn't the iOS bundle ID is fine; just keep it consistent).
5. Continue → Register.
6. After it's created, click on it from the list to edit it.
7. Check **Sign in with Apple** → click **Configure**.
8. Primary App ID: pick the existing iOS App ID (`com.ok2eat.app`). This
   tells Apple "this Services ID belongs to the same product as the iOS
   app," so users get one identity across both.
9. **Domains and Subdomains:** add `qemarhvgeuzhlwybmbie.supabase.co`
   (your Supabase project domain — the auth callback lives there).
10. **Return URLs:** add `https://qemarhvgeuzhlwybmbie.supabase.co/auth/v1/callback`
11. Save → Continue → Save.

### 1b. Create a private key (.p8)

Supabase needs to sign Apple requests on your behalf, so you generate a
private key.

1. **Keys** (left sidebar) → click the **+** button.
2. Key Name: `ok2eat web Apple Sign In`
3. Check **Sign in with Apple** → click **Configure** beside it.
4. Pick the same Primary App ID as before (`com.ok2eat.app`). Save.
5. Continue → Register.
6. **Download** the `.p8` file. ⚠️ You can only download it once — store
   it somewhere safe. (1Password, encrypted vault, etc.)
7. Note the **Key ID** shown on the same page (a 10-character string
   like `ABC1234DEF`).

### 1c. Note your Team ID

1. Top-right of the Apple Developer site → click your name → **Membership**.
2. Copy the **Team ID** (10 characters, e.g. `XYZ987WVU6`).

You should now have four pieces of info:

| Field        | Example                  | What is it?                                   |
|--------------|--------------------------|-----------------------------------------------|
| Services ID  | `com.ok2eat.app.web`     | The identifier you registered in step 1a      |
| Team ID      | `XYZ987WVU6`             | Your Apple Developer team identifier          |
| Key ID       | `ABC1234DEF`             | The key you generated in step 1b              |
| .p8 contents | `-----BEGIN PRIVATE KEY-----\n…` | Paste the full file contents             |

---

## 2. Supabase Dashboard

URL: https://supabase.com/dashboard/project/qemarhvgeuzhlwybmbie

1. **Authentication** (left sidebar) → **Providers**.
2. Find **Apple** → toggle it **on**.
3. **Client IDs:** paste the Services ID from above (`com.ok2eat.app.web`).
4. **Secret Key (for OAuth):** Supabase asks for the secret as a JWT it
   can sign on each request. There are two paths here — pick whichever
   the dashboard offers your project:
   - **Path A — paste the .p8 + metadata directly.** Newer Supabase
     versions accept Team ID, Key ID, and the .p8 contents as separate
     fields and generate the JWT for you. If you see those three fields,
     fill them in and skip Path B.
   - **Path B — generate the JWT yourself.** If Supabase only shows a
     single "Secret Key" field, you'll need to mint a 6-month JWT signed
     with the .p8. The script in `scripts/apple_sign_in_jwt.py`
     generates it. Run it, copy the output, paste it as the secret.
     Supabase will accept it for 6 months; you'll need to regenerate
     and paste again before it expires (a calendar reminder is
     scheduled for that — see step 4 below).
5. **Authorized Client IDs (for native apps):** paste your iOS bundle
   ID (`com.ok2eat.app`) so iOS Apple identity tokens are also accepted.
   This is what links the iOS Apple user and the web Apple user to one
   Supabase account.
6. Save.

### 2a. Check identity-linking-by-email

1. Authentication → **Settings** → scroll to **User Sessions** and
   **Identities**.
2. Make sure **"Allow users to link multiple identities"** (or
   "Automatically link identities by email") is **on**. This is what
   makes the iOS Apple user (with relay email `xyz@privaterelay.apple…`)
   and the web Apple user (with the same relay email) end up on a
   single `auth.users` row.

---

## 3. Site URL & Redirect URLs

URL: Authentication → **URL Configuration**.

1. **Site URL:** `https://app.ok2eat.com`
2. **Redirect URLs (allowlist):** make sure the following are in there:
   - `https://app.ok2eat.com/`
   - `https://app.ok2eat.com/*`
   - `http://localhost:5173/` (Vite dev)
   - `http://localhost:5173/*`

The OAuth flow won't redirect back unless the destination is in this
allowlist.

---

## 4. Test the flow

1. `cd web && npm run dev` → open `http://localhost:5173`.
2. Click **Sign in with Apple** → you should be redirected to Apple.
3. Pick the same Apple ID you use on the iOS app.
4. Apple bounces back to `localhost:5173/` with a Supabase session.
5. Confirm the web app loads your fridge — same items as iOS = success.

If the redirect lands on an error page:
- "invalid_client" → Services ID typo, or the return URL in Apple
  doesn't exactly match `https://qemarhvgeuzhlwybmbie.supabase.co/auth/v1/callback`.
- "redirect_uri_mismatch" → `redirectTo` in the JS code doesn't match
  one of the allowlist entries in Supabase Auth → URL Configuration.
- "invalid_grant" → JWT secret expired or wrong Team ID/Key ID.

---

## 5. Reminders

The Apple JWT secret (Path B) expires every 6 months. A scheduled task
should be created to remind you 5 months out so you can regenerate
without users seeing a broken Apple button.

If you used Path A (Supabase generates the JWT for you), no reminder
needed — Supabase auto-rotates internally.
