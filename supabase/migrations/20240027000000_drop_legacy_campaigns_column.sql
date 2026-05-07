-- Drop the legacy `campaigns` JSONB column from client_agreements.
--
-- Migration 20240026 added the flat columns (ad_budget, platforms,
-- platform_fees, follow_up, follow_up_fee) and backfilled them from
-- campaigns[0]. Since then, every code path that touches client_agreements
-- reads/writes the flat columns — agreement.ts, billing/page.tsx, the
-- agreements-summary route, the agreement-section editor, the inline
-- billing-page editor. The JSONB column has been dead weight for a release
-- cycle; safe to drop.
--
-- Idempotent via IF EXISTS — safe to re-run after the column is gone.

ALTER TABLE client_agreements DROP COLUMN IF EXISTS campaigns;
