-- Phase 2 — Reply / Comment composer.
--
-- Adds a discriminator for internal notes inside a chat thread. An internal
-- note is rendered in the same thread as external messages (so AM and CM
-- have one combined per-client conversation history), but is never sent to
-- the client — it routes to Trengo as `internal_note: true` and rides on
-- the Trengo ticket as a team-only annotation.
--
-- Visually: external messages keep the existing bubble treatment; internal
-- notes get a yellow bubble (Trengo-style), so the AM can tell at a glance
-- which posts the client can see and which are team chatter.
--
-- Backwards-compatible: defaults to false, so every existing chat row is
-- treated as external. No data backfill needed.
ALTER TABLE inbox_events
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;
