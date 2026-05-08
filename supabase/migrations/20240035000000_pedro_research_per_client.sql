-- Pedro research is now per-client. The original `pedro_research` table
-- (Phase 1) was a global library keyed by branche+klantnaam+timestamp —
-- not actually FK'd to a hub client. Roy's directive 2026-05-08:
-- "alles wat ik in Pedro doe behoort tot die specifieke klant".
--
-- Adds a nullable `client_id` FK so:
--  - new research saves include the active client when one is selected
--  - existing rows stay as-is (NULL client_id = legacy library entries)
--  - Pedro UI filters research by selected client when one is set,
--    falls back to the global library otherwise

alter table pedro_research
  add column if not exists client_id text references clients(monday_item_id) on delete set null;

create index if not exists pedro_research_client_idx
  on pedro_research (client_id, saved_at desc)
  where client_id is not null;
