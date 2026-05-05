-- Split the single date Monday was holding ("invoice date" in spirit, in
-- column `date3`) into two distinct concepts:
--
--   * `cycle_start_date` — the manual source of truth: the date a client's
--     new billing period starts. Mirrors Monday's `date3` column.
--
--   * `next_invoice_date` — already present, but its semantics shift: it's
--     now the actual date finance sends the invoice (= cycle - 7 days).
--     Always derived from cycle, never edited directly. Mirrors Monday's
--     `date_mm3297df` column (the new "Invoice date" column on the boards).
--
-- The column was added in migration 20240021; this migration just adds the
-- companion `cycle_start_date` and an index for the same use cases (cron
-- lookup, fast filtering).

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS cycle_start_date DATE;

CREATE INDEX IF NOT EXISTS clients_cycle_start_date_idx
  ON clients (cycle_start_date)
  WHERE cycle_start_date IS NOT NULL;
