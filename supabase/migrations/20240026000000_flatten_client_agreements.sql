-- Flatten the agreement model: one Monday row = one campaign.
--
-- Background: each Monday client row already represents a single campaign
-- (e.g. "O2 Plus | B2B" and "O2 Plus | B2C" are separate rows). The original
-- agreement schema stored a JSONB `campaigns[]` array per client to model
-- multi-campaign deals from the Monday sub-item era. That era is over —
-- sub-items were dropped and every campaign got its own top-level row, so the
-- array always has length 1 in practice.
--
-- Carrying the array forward causes real bugs: when a client's Stripe customer
-- is shared across two Monday rows (B2B + B2C), each row owns its own fee,
-- but the legacy seed copied the whole parent fee onto one row and left the
-- sibling at €0. The fix is structural: store ad_budget / platforms /
-- platform_fees / follow_up fields directly on the agreement row and drop the
-- array entirely.
--
-- Consolidation across siblings (e.g. "one invoice covers B2B + B2C") happens
-- at the billing UI layer by grouping rows on stripe_customer_id — not in the
-- data model. Keeps the data model boring and the UI smart.
--
-- This migration:
--   1. Adds flat columns next to the JSONB `campaigns` column.
--   2. Backfills from campaigns[0] (the only entry in 99% of rows).
--   3. Leaves `campaigns` in place as a safety net — a follow-up migration
--      will drop it once we've verified nothing reads it. Non-destructive.

ALTER TABLE client_agreements
  ADD COLUMN IF NOT EXISTS ad_budget NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platforms TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS platform_fees JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS follow_up BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS follow_up_fee NUMERIC NOT NULL DEFAULT 0;

-- Backfill from the first campaign in the array. Runs once — the WHERE clause
-- guards against re-running (skips rows that already have any flat data set,
-- so re-applying the migration is a no-op on already-migrated rows).
UPDATE client_agreements ca
SET
  ad_budget = COALESCE((ca.campaigns->0->>'ad_budget')::numeric, 0),
  platforms = COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(ca.campaigns->0->'platforms')),
    '{}'::text[]
  ),
  platform_fees = COALESCE(ca.campaigns->0->'platform_fees', '{}'::jsonb),
  follow_up = COALESCE((ca.campaigns->0->>'follow_up')::boolean, false),
  follow_up_fee = COALESCE((ca.campaigns->0->>'follow_up_fee')::numeric, 0),
  -- Per-campaign notes win over agreement-level notes when both exist —
  -- the UI only ever exposed per-campaign notes, so that's where edits live.
  notes = COALESCE(NULLIF(ca.campaigns->0->>'notes', ''), ca.notes)
WHERE
  jsonb_array_length(ca.campaigns) > 0
  AND ad_budget = 0
  AND follow_up = false
  AND follow_up_fee = 0
  AND platforms = '{}'::text[]
  AND platform_fees = '{}'::jsonb;
