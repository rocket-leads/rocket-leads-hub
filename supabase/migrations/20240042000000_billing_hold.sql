-- Billing hold: manual "park this client" toggle for finance.
--
-- Use case: finance occasionally needs to delay an invoice (waiting on a
-- decision from the client, pending refund, holiday freeze, etc.) without
-- changing the campaign status to On Hold (which would also pause Meta
-- delivery + flip a bunch of other UI). The Hub Billing overview shows
-- held clients in a dedicated "On Hold" bucket above the time-based ones,
-- and held clients DON'T appear in the date-driven buckets — even when
-- their next_invoice_date is in the past.
--
-- All three columns nullable / default-false so existing rows are unchanged.
alter table clients
  add column if not exists billing_hold boolean not null default false,
  add column if not exists billing_hold_reason text,
  add column if not exists billing_hold_updated_at timestamptz;

-- Partial index — only billing-held rows need fast lookup, and most rows
-- have billing_hold=false. Keeps the index small.
create index if not exists idx_clients_billing_hold
  on clients(billing_hold)
  where billing_hold = true;
