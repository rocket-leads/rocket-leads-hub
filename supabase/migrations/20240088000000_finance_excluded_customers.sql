-- Customer-level revenue exclusion. Some Stripe customers are not Rocket Leads
-- revenue at all — an invoice sent to a friend, a pass-through, a non-RL entity
-- (e.g. POLITICO). Rather than reclassifying every invoice one by one, a row
-- here removes the customer's invoices AND credit notes from every revenue
-- surface: Finance totals, Delivery attribution, churn base, per-AM rollups.
--
-- Presence of a row = excluded. DELETE the row to restore the customer.
-- `customer_name` is snapshotted at exclusion time so the "Excluded" list in
-- the Delivery tab can render + offer a restore action without re-deriving the
-- name from Stripe (the customer's invoices are skipped, so we never fetch it).

create table if not exists finance_excluded_customers (
  stripe_customer_id text primary key,
  customer_name text,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists finance_excluded_customers_updated_at_idx
  on finance_excluded_customers (updated_at desc);

alter table finance_excluded_customers enable row level security;
