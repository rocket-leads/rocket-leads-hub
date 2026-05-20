-- Per-user primary outbound Trengo channels.
--
-- Solves the Roel-vs-`rocket-lea-mail.*@trengomail.com` bug: when an
-- admin (Roy) triggers a client-update email for an AM's (Roel's)
-- client, the outbound mail used to leave via `findFirstEmailChannel`
-- — the workspace's first email channel, which is Trengo's generic
-- catch-all. The mail went out from the wrong address.
--
-- We previously repurposed `users.trengo_channel_ids` (an array meant
-- for inbox VISIBILITY) as a "send-from" hint. Two problems:
--   1. Overloaded semantics — an AM may want to SEE a colleague's
--      channel without ever wanting to SEND from it.
--   2. Ambiguous when an AM subscribed to multiple email channels.
--
-- This migration splits the two concepts cleanly:
--   - `trengo_channel_ids`         (existing) = visibility set
--   - `primary_email_channel_id`   (new)      = outbound email FROM
--   - `primary_wa_channel_id`      (new)      = outbound WA channel for
--                                               bootstrap sends (no
--                                               existing thread yet)
--
-- Both nullable: an AM who hasn't picked one yet gets a hard error
-- at send-time rather than a silent fallback to the workspace's
-- catch-all (the old failure mode). UI in /account → Trengo lets
-- the AM pick one from their visible channels.
--
-- No foreign key to a `trengo_channels` table because we don't mirror
-- Trengo channels into Supabase (channels are workspace metadata
-- fetched on demand via the Trengo API + 5-min cache). The send path
-- resolves the id against `GET /channels` at use time.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS primary_email_channel_id integer NULL,
  ADD COLUMN IF NOT EXISTS primary_wa_channel_id    integer NULL;
