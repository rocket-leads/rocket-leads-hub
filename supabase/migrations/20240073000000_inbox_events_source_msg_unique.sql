-- The polling cron upserts inbox_events on (source, source_msg_id),
-- which requires a UNIQUE constraint (or unique index) at that key.
-- Migration 20240017 created the corresponding index but as plain
-- `CREATE INDEX` rather than `CREATE UNIQUE INDEX`, so PostgREST refuses
-- the conflict target ("there is no unique or exclusion constraint
-- matching the ON CONFLICT specification") and the cron writes nothing.
--
-- Step 1 - dedupe before adding the constraint.
--   Past races between the Trengo webhook + earlier polling-cron
--   versions left a handful of (source, source_msg_id) duplicates on
--   prod. We keep one row per key, preferring:
--     a. webhook-origin (raw IS NOT NULL) over polling-origin
--     b. row with the oldest created_at (the original ingest)
--   Anything else gets dropped. ROW_NUMBER ranks per group; we delete
--   everything ranked > 1.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY source, source_msg_id
      ORDER BY
        (raw IS NOT NULL) DESC,
        created_at ASC
    ) AS rk
  FROM inbox_events
  WHERE source_msg_id IS NOT NULL
)
DELETE FROM inbox_events
WHERE id IN (SELECT id FROM ranked WHERE rk > 1);

-- Step 2 - create the partial unique index PostgREST needs as the
-- upsert conflict target. Wrapped to a no-op if it already exists
-- from a prior partial-apply attempt.
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
