-- Triage affordances for chat-substrate rows (Roy 2026-06-13 audit):
--   - starred: per-row star toggle, mirrored at the thread level by
--     the chat-pane "is any row in this thread starred?" check.
--   - archived_at: timestamp marking the row as moved out of the
--     active inbox without deleting it. NULL = active. The Channels
--     tab default filter excludes archived rows; a separate "Archived"
--     tab surfaces them.
--
-- `snoozed_until` already exists from migration 20240023 (tasks) and
-- is reused as-is for chat rows. listChatThreads now treats
-- snoozed_until > now() as "hidden until the snooze passes" and the
-- "Snoozed" filter inverts that gate.

ALTER TABLE inbox_events
  ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Index for the active-inbox filter (the dominant read path: "show me
-- chat events where I haven't archived them"). Partial because the
-- archived bucket is tiny and gets its own scan.
CREATE INDEX IF NOT EXISTS idx_inbox_events_active_chat
  ON inbox_events(thread_key)
  WHERE archived_at IS NULL AND thread_key IS NOT NULL;

-- Index supporting the Starred filter.
CREATE INDEX IF NOT EXISTS idx_inbox_events_starred
  ON inbox_events(thread_key)
  WHERE starred = TRUE AND thread_key IS NOT NULL;
