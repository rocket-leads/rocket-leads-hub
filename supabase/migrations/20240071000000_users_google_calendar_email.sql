-- Track which Google account the stored Calendar tokens belong to.
--
-- Users sign in with one Google account but can connect a *different*
-- account to read calendar events from (e.g. roelharst@gmail.com signs
-- into the Hub but his actual work calendar lives on contact@rocket-
-- leads.nl). The connect flow at /api/auth/google-calendar/* writes the
-- new tokens onto the existing google_access_token / google_refresh_token
-- / google_token_expires_at columns AND stamps this column with the
-- email of the account those tokens belong to. The sign-in callback
-- treats this as the source of truth: if it's set to an email other
-- than the sign-in email, the sign-in flow will NOT overwrite the
-- stored tokens — protecting the user's deliberately-chosen calendar
-- connection from being clobbered on every login.
--
-- Null = no override; calendar tokens are owned by the sign-in account.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_calendar_email TEXT;
