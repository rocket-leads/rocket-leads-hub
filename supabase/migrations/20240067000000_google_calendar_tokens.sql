-- Persist Google OAuth tokens per user so we can call Google Calendar v3
-- server-side without forcing a fresh sign-in every hour.
--
-- access_token expires in ~1h (Google convention) and is refreshed using
-- refresh_token, which is only granted once per user when the auth flow
-- requests `access_type=offline` with `prompt=consent`. Both tokens are
-- secrets, so we encrypt them with the same AES-256-GCM helper used for
-- api_tokens (`src/lib/encryption.ts`). expires_at is plaintext — it's a
-- timestamp, not a secret, and we need to compare it in SQL/JS to decide
-- whether to refresh.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_access_token TEXT,
  ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS google_token_expires_at TIMESTAMPTZ;
