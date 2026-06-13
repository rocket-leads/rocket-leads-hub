-- The polling cron upserts inbox_events on (source, source_msg_id),
-- which requires a UNIQUE constraint (or unique index) at that key.
-- Migration 20240017 created the corresponding index but as plain
-- `CREATE INDEX` rather than `CREATE UNIQUE INDEX`, so PostgREST refuses
-- the conflict target ("there is no unique or exclusion constraint
-- matching the ON CONFLICT specification") and the cron writes nothing.
--
-- Webhook + polling cron both dedupe before insert, so no duplicate rows
-- can exist at this key today - the constraint will succeed on apply.
-- Wrapped in a DO block: if a partial unique index already exists from
-- a previous attempt or out-of-band patch, skip cleanly.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'uq_inbox_events_source_msg'
  ) THEN
    CREATE UNIQUE INDEX uq_inbox_events_source_msg
      ON inbox_events(source, source_msg_id)
      WHERE source_msg_id IS NOT NULL;
  END IF;
END
$$;
