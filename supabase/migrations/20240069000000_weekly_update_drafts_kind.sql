-- Mid-week ad-hoc updates vs. the Monday-morning weekly digest.
--
-- The Monday-morning cron seeds drafts that are a structured "what happened
-- last week" digest (KPI block, trend sentence, Pedro actions). That format
-- is intentionally repetitive — same shape every Monday so the AM scans
-- through 51 of them in 20 minutes.
--
-- Mid-week, AMs ask the Co-pilot for an update via natural language ("yo
-- schrijf even een update voor ZoomX"). Those updates need to read DIFFERENT
-- from the Monday digest: casual greeting, AM-voice phrasing, varied
-- structure, multi-window trends (7d / 14d / 30d vs prior periods), and
-- proactive context (what we just shipped, what we've been talking about,
-- last contact moment, overdue invoices). They share the same storage
-- (one queue surface), but compose + send differently — discriminated by
-- this column.
--
-- `weekly` keeps the Monday cron + manual "Update" button behaviour.
-- `midweek` is set by the Co-pilot queue endpoint and triggers the AI
-- composer in `build-midweek-update-draft.ts`.

ALTER TABLE weekly_update_drafts
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'weekly'
    CHECK (kind IN ('weekly', 'midweek'));
