-- Per-user test recipient for client-update dry runs.
--
-- The send-client-update dialog has a "Send as test" toggle that swaps
-- the outbound recipient with the AM's own test contact, so the message
-- goes to the AM (or admin running the test) instead of the actual
-- client. Everything else — body, AM's email channel, AM's WA template,
-- AM's Trengo token — stays real, so the test is end-to-end faithful.
--
-- Stored as a single Trengo contact id rather than separate email +
-- phone fields: each AM creates one "test contact" in Trengo holding
-- both their personal email and WhatsApp number, drops the contact id
-- here, and the route derives the right address per channel from that
-- contact at send time.
--
-- Nullable: when unset, the test toggle hard-fails with a clear
-- "configure your test contact in Settings → Users first" message.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS test_trengo_contact_id integer NULL;
