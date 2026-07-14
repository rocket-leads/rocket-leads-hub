-- Weekly Update pre-cache.
--
-- Composing a weekly Client Update is a 20-40s fan-out (Meta KPI + Stripe
-- overdue + Pedro insight + template resolution). When an AM opens the
-- "Update" button on Monday morning to do the bulk send, waiting for that
-- spinner on every client is a lot of dead time.
--
-- A Monday 06:00 UTC cron (`/api/cron/weekly-update-cache`) pre-builds the
-- editable parts for every Live client with a contact and stores them here,
-- keyed by (monday_item_id, week_of). The "Update" dialog then reads this
-- snapshot and opens instantly. On a miss (client flipped Live mid-week, or
-- an ad-hoc open before the cron runs) the route live-builds and lazily
-- writes the result here so the next open is fast too.
--
-- This is a pure cache: no send/dismiss state. Whether a client already had
-- this week's update is tracked separately by clients.last_client_update_at
-- (the "Client update" column). Rows are overwritten each week and never
-- read across weeks, so stale rows are harmless.

CREATE TABLE IF NOT EXISTS weekly_update_cache (
  -- Hub-canonical client (Monday item id) + the ISO Monday of the week the
  -- snapshot was built for. One row per client per week.
  monday_item_id text NOT NULL,
  week_of date NOT NULL,

  -- The composed EditableParts snapshot the dialog renders + sends from.
  parts jsonb NOT NULL,
  -- Resolved send channel ('whatsapp' | 'email' | 'unknown') and the
  -- WhatsApp HSM template slug, so the dialog can skip re-resolving them.
  channel text,
  template_name text,

  built_at timestamptz NOT NULL DEFAULT NOW(),

  PRIMARY KEY (monday_item_id, week_of)
);

-- Service-role-only, same as the rest of the Hub's tables: enabling RLS with
-- no policies blocks the anon key entirely while createAdminClient() (service
-- role) bypasses it.
ALTER TABLE weekly_update_cache ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE weekly_update_cache IS
  'Pre-computed weekly Client Update snapshots (one per client per ISO week). Filled by the Monday cron + lazily on dialog open. Pure cache; send-state lives in clients.last_client_update_at.';

NOTIFY pgrst, 'reload schema';
