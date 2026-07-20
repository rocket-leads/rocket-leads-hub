-- Durable Trengo↔Hub user mapping.
--
-- Mention resolution + assignment sync currently match a Trengo agent to a Hub
-- user by display name (with a first-name fallback). That breaks on renames,
-- .nl-vs-.com email drift, and ambiguous first names. Persisting the Trengo
-- user id on the Hub user makes the mapping id-based and rename-proof once
-- seeded; the name match remains a fallback for unseeded/new users.
alter table users add column if not exists trengo_user_id integer;

create index if not exists idx_users_trengo_user_id
  on users(trengo_user_id) where trengo_user_id is not null;
