-- Capture the contact's phone number on WhatsApp-sourced inbox rows so
-- the chat-pane header can show "Fons · +31 6 12 34 56 78" instead of
-- just "Fons" (Roy 2026-06-16: WhatsApp threads need the phone for
-- phishing/wrong-recipient verification, same reason email rows already
-- show email_from). The webhook + polling cron pull this from
-- `ticket.contact.phone` at ingest; legacy rows stay NULL and the UI
-- falls back gracefully.
--
-- Nullable — email and Slack rows leave it NULL; the chat-pane header
-- conditionally renders the block only when the value is present.

ALTER TABLE inbox_events
  ADD COLUMN IF NOT EXISTS contact_phone TEXT;
