-- Phase F — browser push subscriptions per user.
--
-- One row per (user_id, endpoint) so a user can have multiple devices
-- subscribed (laptop + phone). Endpoint is the FCM/Mozilla push URL
-- the browser hands us when the user grants permission. p256dh + auth
-- are the encryption keys the browser uses to decrypt our payloads.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON push_subscriptions (user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "No anon access to push_subscriptions" ON push_subscriptions;
CREATE POLICY "No anon access to push_subscriptions"
  ON push_subscriptions FOR ALL TO anon USING (false);
