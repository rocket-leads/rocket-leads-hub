-- Per-user Trengo channel subscriptions.
--
-- Lets each Hub user pick which Trengo channels (Email, WhatsApp, Voice, etc.)
-- they want surfaced in their Client Inbox. Without this, only contacts that
-- match a known client.trengo_contact_ids row are visible — unmatched contacts
-- (prospects, ex-clients, leads not yet in Monday) stay invisible to non-admins.
--
-- The selection works as a visibility *expansion*: a user always sees events
-- linked to a client they have access to (existing rule), AND additionally
-- sees any event whose trengo_channel_id is in their selected set.
--
-- Storage:
--   - inbox_events.trengo_channel_id : populated by the Trengo webhook from
--     ticket.channel.id at ingest time. Nullable so non-Trengo events don't
--     need to care.
--   - users.trengo_channel_ids       : the user's current selection. Empty
--     array = no extra subscriptions (default).

ALTER TABLE inbox_events
  ADD COLUMN IF NOT EXISTS trengo_channel_id integer;

CREATE INDEX IF NOT EXISTS idx_inbox_events_trengo_channel
  ON inbox_events(trengo_channel_id)
  WHERE trengo_channel_id IS NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS trengo_channel_ids integer[] NOT NULL DEFAULT '{}';
