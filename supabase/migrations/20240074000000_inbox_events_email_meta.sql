-- Capture email subject + sender address so the chat pane can show them
-- prominently on each email card (Roy 2026-06-13 audit: "Vueling" alone
-- isn't enough; you need the subject "Bevestiging van je reservering
-- ONUTYA" + the From address so phishing vs legit is obvious at a
-- glance). The Trengo /messages endpoint already returns these on
-- `email_message.subject` / `email_message.from` - the cron just
-- wasn't reading them.
--
-- Both nullable - non-email rows (WhatsApp, Slack) leave them NULL and
-- the UI hides the relevant block.

ALTER TABLE inbox_events
  ADD COLUMN IF NOT EXISTS email_subject TEXT,
  ADD COLUMN IF NOT EXISTS email_from TEXT;
