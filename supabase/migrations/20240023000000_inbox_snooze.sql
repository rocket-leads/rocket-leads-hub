-- Phase D.2 — snooze support on inbox events.
--
-- A snoozed task stays `status='open'` semantically (it's still on someone's
-- plate). We just hide it from the active list view until `snoozed_until`
-- passes, at which point it reappears on its own. No cron needed: the list
-- query filters on `snoozed_until IS NULL OR snoozed_until <= NOW()`.
--
-- Used to push tasks like "Stuur factuur naar X" out to the actual due date
-- without prematurely closing them or leaving them as visual clutter today.

ALTER TABLE inbox_events
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;

-- Partial index — most rows are NOT snoozed, so the lookup we care about is
-- "anyone snoozed past this moment?" which only touches the slice with a
-- non-null value.
CREATE INDEX IF NOT EXISTS inbox_events_snoozed_until_idx
  ON inbox_events (snoozed_until)
  WHERE snoozed_until IS NOT NULL;
