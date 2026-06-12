-- Add an optional scheduled_at TIMESTAMPTZ to inbox_events so tasks can
-- be pinned to a specific time-of-day on the calendar.
--
-- Why a separate column from due_date:
--   - due_date is a DATE — the "this is due by" deadline, set in the
--     Inbox by the AM/CM. It stays the source of truth for "is this
--     overdue", "what shipped this week", etc.
--   - scheduled_at is the AM/CM's plan for *when* during the day they
--     intend to actually do the work. Set by dragging a task chip onto
--     the time grid in /calendar. NULL means "no specific time yet" —
--     the task renders in the all-day strip on its due_date.
--
-- Only tasks (kind='task') ever get scheduled_at set; the column lives
-- on inbox_events alongside everything else just to avoid an extra
-- join. Updates already pass through the existing PATCH /api/inbox/[id]
-- endpoint.

ALTER TABLE inbox_events
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- Index for the calendar window query — same shape as the existing
-- due_date range filter, just for scheduled_at instead. Only worth
-- indexing once tasks-on-time-grid sees real use; keeping it explicit
-- so the migration self-documents the access pattern.
CREATE INDEX IF NOT EXISTS idx_inbox_events_scheduled_at
  ON inbox_events (assignee_id, scheduled_at)
  WHERE kind = 'task' AND scheduled_at IS NOT NULL;
