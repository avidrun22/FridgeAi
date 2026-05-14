-- v1.19 — App-version notification dedupe table
-- =============================================================================
-- Tracks which (platform, version) pairs we've already pushed a "new version
-- is live" notification about, so the daily check doesn't re-spam users with
-- the same version notification every 24 hours.
--
-- The companion send-app-version-notify Edge Function:
--   1. Polls iTunes Lookup for the latest published version
--   2. Looks up (platform="ios", version=<that>) in this table
--   3. If row exists, no-op (already notified)
--   4. If row doesn't exist:
--      a. Fetches all expo_push_tokens
--      b. Sends a push: "ok2eat v{X} is live · tap to update"
--         with deep-link itms-apps://itunes.apple.com/app/id6761730687
--      c. Inserts the row with pushes_sent count
--
-- We DON'T filter recipients by their current version (we don't reliably know
-- it for most users — PostHog super-property only set after instrument was
-- added). Users already on the latest version see "v1.18 is live" briefly,
-- realize they have it, and dismiss. Net annoyance < net upgrade signal.
-- =============================================================================

CREATE TABLE IF NOT EXISTS app_version_notifications (
  platform        TEXT          NOT NULL,
  version         TEXT          NOT NULL,
  detected_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  pushes_sent     INTEGER       NOT NULL DEFAULT 0,
  last_pushed_at  TIMESTAMPTZ   NULL,
  PRIMARY KEY (platform, version)
);

COMMENT ON TABLE  app_version_notifications              IS 'v1.19 — Dedupe table for "new version is live" push notifications. One row per (platform, version).';
COMMENT ON COLUMN app_version_notifications.pushes_sent  IS 'How many Expo push messages we sent for this version. Useful for after-the-fact tally.';

-- No RLS — this is operational metadata, accessed only via service-role
-- by the send-app-version-notify Edge Function.
