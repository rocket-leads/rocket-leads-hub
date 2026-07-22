-- Trengo contact registry.
--
-- Thread display names were derived from whichever cached message-author name
-- happened to be on an inbound row. Outbound-only threads (e.g. a weekly-update
-- push to a contact who never replied inside the window) had no inbound row, so
-- they rendered as "Unknown" — even though Trengo returns the contact name on
-- EVERY ticket (Roy 2026-07-22: Sylwester Nawara | ProSteel showing as Unknown).
--
-- This table is a small registry keyed by Trengo contact id, upserted from
-- every ticket.contact the poll + webhook see. Thread naming looks the contact
-- up by the id embedded in its thread_key, so a thread is named after the real
-- Trengo contact regardless of message direction or client linkage.
--
-- `phone` is nullable and reserved for the follow-up: deduping/merging the
-- multiple Trengo contact records that can exist for the same WhatsApp number.
create table if not exists trengo_contacts (
  id bigint primary key,
  name text,
  email text,
  phone text,
  updated_at timestamptz not null default now()
);

-- Group duplicate contacts by their phone number (WhatsApp identity) once we
-- backfill phones — the basis for merging split threads.
create index if not exists idx_trengo_contacts_phone
  on trengo_contacts(phone) where phone is not null;
