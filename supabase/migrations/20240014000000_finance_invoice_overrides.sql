-- Finance invoice overrides — manual reclassification of an invoice's sub-category
-- (MRR vs New Business). The auto-detection in `buildInvoiceBreakdown` decides per
-- customer whether an invoice is "new business" based on whether they had any earlier
-- invoice; overrides let a human correct edge cases (e.g. an Arcade Lab invoice that
-- triggers as new business because the customer was just re-invoiced after a gap, but
-- is really an MRR-style top-up).
--
-- One row per stripe_invoice_id. Absence of a row = use auto-detection.

create table if not exists finance_invoice_overrides (
  stripe_invoice_id text primary key,
  sub_category text not null check (sub_category in ('mrr', 'new_business')),
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists finance_invoice_overrides_updated_at_idx
  on finance_invoice_overrides (updated_at desc);

alter table finance_invoice_overrides enable row level security;
