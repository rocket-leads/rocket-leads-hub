-- Mark Trengo internal notes (team-only annotations posted into a
-- conversation thread) so the Hub can render them with a distinct bubble
-- and so the @-mention pipeline can route them as Update notifications
-- to the tagged teammates.
--
-- The column already exists in production — added manually before this
-- migration was written — so we add it idempotently so a fresh local
-- DB ends up in the same shape.

ALTER TABLE inbox_events
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;
