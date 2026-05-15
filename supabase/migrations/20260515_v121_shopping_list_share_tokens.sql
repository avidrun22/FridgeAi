-- v1.21 — Sharable shopping lists
-- ==============================================================
-- Add a public read-only share token to shopping_lists. When a household
-- member taps "Share" on a list, the client generates a UUID, flips
-- is_public_shareable=true, and copies a `ok2eat.com/lists?t={token}` link.
-- Anyone with the link can read the list via the get-shared-list Edge
-- Function (no auth, service-role bypass keyed by the token). Existing
-- users opening the link deep-link to the editor; non-users get a CTA
-- to either sign up (Phase 2: claim list as collaborator) or download
-- the iOS app.
--
-- The token only enables READS. Edits still require a household_members
-- row (existing v1.10 RLS).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS before
-- CREATE POLICY. Safe to re-run.
-- ==============================================================

-- ─── 1. Add columns ─────────────────────────────────────────────────────────

ALTER TABLE public.shopping_lists
  ADD COLUMN IF NOT EXISTS share_token uuid,
  ADD COLUMN IF NOT EXISTS is_public_shareable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS share_token_created_at timestamptz;

-- Unique index on the token so the Edge Function can look up by token in
-- O(log n). NULL values are allowed (most lists won't have a token until
-- their owner taps Share).
CREATE UNIQUE INDEX IF NOT EXISTS idx_shopping_lists_share_token
  ON public.shopping_lists(share_token)
  WHERE share_token IS NOT NULL;

-- ─── 2. RLS — household members can read/write the share fields ────────────
-- Existing v1.10 policies already cover read/insert/update/delete on
-- shopping_lists for household members. No additional policies needed
-- for the new columns because they're plain columns on the same row.
-- The Edge Function uses the service-role key to bypass RLS, validating
-- the token instead (token IS the authorization for the public read).

-- ─── 3. Sanity-check queries (run manually after applying) ─────────────────
--   SELECT id, name, share_token, is_public_shareable
--   FROM shopping_lists WHERE is_public_shareable = true;
--
--   -- Revoke a leaked link (NULL the token, set is_public_shareable=false):
--   UPDATE shopping_lists
--   SET share_token = NULL, is_public_shareable = false
--   WHERE id = '...';
