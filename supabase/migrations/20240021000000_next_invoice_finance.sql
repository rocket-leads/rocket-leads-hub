-- Next invoice date tracker — phase 1.
--
-- The Hub becomes the canonical place to see and set when a client's next
-- invoice should go out. We mirror this to Monday's `date3` column on the
-- onboarding + current client boards (bidi sync via the existing PATCH path).
-- A daily cron then turns "next_invoice_date == today" into an inbox task
-- assigned to whoever has `is_finance = true` — finance does the actual send,
-- the Hub just makes sure they never miss a date.
--
-- Idempotency for the auto-task happens via inbox_events.source_ref containing
-- the client_id + the date — no extra table needed for that bookkeeping.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS next_invoice_date DATE;

-- `is_finance` is intentionally a separate flag rather than a `role` value:
-- finance is functional, role is access. Arno is finance AND admin; in the
-- future a non-admin member could also be finance.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_finance BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS clients_next_invoice_date_idx
  ON clients (next_invoice_date)
  WHERE next_invoice_date IS NOT NULL;
