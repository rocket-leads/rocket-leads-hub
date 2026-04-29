-- Per-user Slack user ID for DM delivery.
-- We don't auto-resolve via email since Hub login emails differ from Slack
-- workspace emails. Admins fill this in manually in Settings → Users.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS slack_user_id text;

COMMENT ON COLUMN users.slack_user_id IS
  'Slack workspace user ID (e.g. U01ABC234XY). Used as the channel arg to chat.postMessage for DMs.';
