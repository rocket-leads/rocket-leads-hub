-- Email-style messages need to render with formatting, images, and
-- inline links instead of the flat stripped-text bubble we currently
-- show. To do that we have to keep the original HTML around alongside
-- the stripped plain-text body that drives previews / search.
--
-- `body` stays the source of truth for the chat bubble and inbox row
-- preview (cheap to read, no script tags). `body_html` is the raw mail
-- body the polling cron + Trengo webhook receive, used only by the
-- email-thread renderer (sandboxed iframe). Nullable - WhatsApp and
-- Slack messages don't have a meaningful HTML representation and
-- continue to render straight from `body`.

ALTER TABLE inbox_events
  ADD COLUMN IF NOT EXISTS body_html TEXT;
