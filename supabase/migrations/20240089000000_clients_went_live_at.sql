-- Go-live timestamp per client. Stamped the moment a client crosses from the
-- onboarding board to the current-clients board (see syncClientToSupabase). This
-- is the precise New-Business vs MRR boundary: invoices dated before went_live_at
-- are onboarding revenue (New Business), on/after are recurring (MRR).
--
-- Nullable by design: clients that were already 'current' before this shipped
-- have no captured date and fall back to board-membership classification
-- (current board = MRR), which is correct for every current/future period.

alter table clients add column if not exists went_live_at timestamptz;
