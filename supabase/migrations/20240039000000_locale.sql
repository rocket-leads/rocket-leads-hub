-- Per-user UI locale + workspace AI locale.
--
-- Two separate locale concepts because they have different semantics:
--
--   1. users.locale (per-user)    — controls UI strings + date/currency
--      formatting for that user. Each team member can pick their own.
--      Default 'nl' since the team is Dutch; English remains supported
--      for new hires / external observers.
--
--   2. settings 'ai_locale' row   — the language Pedro generates AI
--      output in. Workspace-level (not per-user) because the cron
--      generates once and writes to pedro_insights, which all users
--      read. Defaults to 'nl' so generations match the team's working
--      language. Settable by admins via Settings → Account / Workspace.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'nl'
    CHECK (locale IN ('nl', 'en'));

INSERT INTO settings (key, value)
VALUES ('ai_locale', '{"locale":"nl"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
