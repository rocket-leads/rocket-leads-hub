-- Billing audit trail — one row per finance action taken from the Hub.
--
-- Finance needs a durable "who did what, when, for how much" record: which
-- invoice was sent / voided / credited / marked paid, who fixed a customer's
-- VAT number, etc. Stripe has its own event log but it's per-object and hard
-- to scan per client; this is the Hub-side, per-client trail surfaced on the
-- Billing tab so any correction is traceable and disputes can be resolved.
--
-- Append-only by convention (no updates/deletes from app code). Not pruned:
-- an audit trail that forgets isn't an audit trail. Volume is tiny (a handful
-- of finance actions per client per month).

CREATE TABLE IF NOT EXISTS billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT NOW(),

  -- Hub-canonical client (Monday item id). Nullable because some actions are
  -- resolved by Stripe customer only (e.g. a customer-data edit before the
  -- client row exists), but populated whenever we know it.
  monday_item_id text,
  stripe_customer_id text,
  -- Invoice acted on, when the action targets one. Null for customer edits.
  stripe_invoice_id text,
  invoice_number text,

  -- What happened. Kept as a free text enum (CHECK) so a new action type is a
  -- one-line migration, not a Postgres enum alter.
  action text NOT NULL CHECK (action IN (
    'invoice_sent',
    'invoice_voided',
    'invoice_uncollectible',
    'invoice_resent',
    'invoice_paid_offline',
    'credit_note',
    'customer_updated',
    'vat_updated'
  )),

  -- Amount involved in EUR, when relevant (invoice total, credit amount, …).
  amount_eur numeric,

  -- Freeform context: line items, credit reason, which customer fields changed,
  -- old→new values, post-send warnings, etc. Shape depends on `action`.
  detail jsonb,

  -- Who did it. Nullable for system/cron-originated actions (none today).
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Denormalised so the history list renders without a users join even if the
  -- account is later removed.
  actor_email text
);

CREATE INDEX IF NOT EXISTS idx_billing_events_client_recent
  ON billing_events (monday_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_events_invoice
  ON billing_events (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_events_customer_recent
  ON billing_events (stripe_customer_id, created_at DESC)
  WHERE stripe_customer_id IS NOT NULL;

COMMENT ON TABLE billing_events IS
  'Hub-side billing audit trail. Append-only, not pruned. One row per finance action (send/void/credit/paid-offline/customer edit).';

NOTIFY pgrst, 'reload schema';
