-- The polling cron's upsert ON CONFLICT (source, source_msg_id) keeps
-- failing in production with "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification" even though migration
-- 20240073 created `uq_inbox_events_source_msg` as a UNIQUE INDEX on
-- exactly those columns.
--
-- Root cause: PostgREST builds the simple inference form
-- `ON CONFLICT (source, source_msg_id) DO UPDATE` without echoing the
-- partial index's WHERE clause. Postgres requires the WHERE to match
-- the inferred index, so a partial unique with
-- `WHERE source_msg_id IS NOT NULL` is rejected as a valid target.
--
-- Cure: replace the partial unique with a non-partial unique on
-- (source, source_msg_id). The Postgres default `NULLS DISTINCT`
-- treats multiple NULL source_msg_ids as non-clashing, so the few
-- rows the webhook/cron leave with NULL (manual creates, slack rows,
-- etc.) coexist as before.

DROP INDEX IF EXISTS uq_inbox_events_source_msg;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_events_source_msg
  ON inbox_events(source, source_msg_id);
