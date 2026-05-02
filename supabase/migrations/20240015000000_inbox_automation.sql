-- Extend inbox_items.source to include automation-driven items.
-- Automation rules (e.g. "payment overdue → task for AM") create inbox items
-- with source='automation' so the UI can label them differently and the
-- dedupe lookup by source_ref is unambiguous.

ALTER TABLE inbox_items DROP CONSTRAINT IF EXISTS inbox_items_source_check;

ALTER TABLE inbox_items ADD CONSTRAINT inbox_items_source_check
  CHECK (source IN ('manual', 'watchlist', 'meeting', 'monday', 'trengo', 'automation'));

-- Index on the source_ref->>'invoiceId' path so the cron can quickly check
-- "have we already created a task for this Stripe invoice?" without scanning.
CREATE INDEX IF NOT EXISTS inbox_items_source_ref_invoice_idx
  ON inbox_items ((source_ref->>'invoiceId'))
  WHERE source = 'automation';
