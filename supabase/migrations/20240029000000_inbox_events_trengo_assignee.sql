-- Trengo assignee tracking on inbox events.
--
-- Roy's rule: the Hub inbox should ONLY show Trengo tickets that are NOT
-- assigned to anyone in Trengo. The moment a teammate (or Roy) claims a
-- ticket in Trengo, the Hub should drop it from the inbox — Trengo is the
-- system of record for "who's handling this", and the Hub is the queue of
-- "still up for grabs". This avoids the inbox flooding with tickets like
-- "Kobe Koffie & Performance" that another AM is already on.
--
-- We capture the assignee user id at webhook ingest by fetching the ticket
-- from Trengo's API. Null = unassigned (eligible for Hub display).
ALTER TABLE inbox_events
  ADD COLUMN IF NOT EXISTS trengo_assignee_user_id BIGINT;

-- Partial index — most events are non-Trengo or already assigned. The
-- "show me unassigned Trengo events" filter touches a small slice, and
-- this keeps it indexed.
CREATE INDEX IF NOT EXISTS inbox_events_trengo_unassigned_idx
  ON inbox_events (trengo_assignee_user_id)
  WHERE source = 'trengo' AND trengo_assignee_user_id IS NULL;
