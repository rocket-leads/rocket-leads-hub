-- Split the single "next invoice date" into a fee-invoice date and a
-- separate ad-budget-invoice date.
--
-- Background: clients who pay the service fee quarterly upfront still need
-- a monthly ad-budget invoice in the months in between — but only when
-- Rocket Leads runs the ads on its own ad account (the "RL ad account"
-- case where we front the spend and bill it back). With a single
-- `next_invoice_date` finance had to choose: push it 3 months out (and
-- forget the monthly ad-budget invoice) or keep it monthly (and risk
-- double-billing the fee). This column gives those two cadences their
-- own date.
--
-- Hub-only by design: there's no Monday column behind this, so all
-- writes go straight to Supabase. The existing `cycle_start_date` /
-- `next_invoice_date` Monday-mirrored columns continue to drive the fee
-- side. If we ever decide to surface this on Monday too, add the column
-- there and wire it through `setItemColumnValue` like the rest.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS next_ad_budget_invoice_date DATE;

CREATE INDEX IF NOT EXISTS clients_next_ad_budget_invoice_date_idx
  ON clients (next_ad_budget_invoice_date)
  WHERE next_ad_budget_invoice_date IS NOT NULL;
