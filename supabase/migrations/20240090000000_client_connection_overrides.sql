-- Per-client, per-service connection overrides.
--
-- The 5 external IDs a client needs (Stripe customer, Meta ad account, Monday
-- lead board, Trengo contact, Google Drive folder) are canonical on Monday and
-- mirrored into `clients`. The connection-health audit reads them and flags any
-- that are empty or don't resolve.
--
-- The gap this closes: an EMPTY id was ambiguous. "This client genuinely has no
-- Google Drive folder" and "the AM forgot to paste the Drive folder ID" looked
-- identical (both rendered as a calm 'not_used' dot for optional services).
-- Account managers duplicate a Monday row (e.g. "DD webinar") and the copy
-- arrives with every ID blank, and nobody notices.
--
-- This table records an EXPLICIT human decision that a service does not apply to
-- a client. When `not_applicable = true` the audit renders a struck dash (–)
-- instead of a red "missing" dot, and the nudge cron skips it. Absence of a row
-- (the default) now means "unresolved — link it or mark it N/A", which is what
-- surfaces the forgotten case.
--
-- Hub-only concept, so it lives in Supabase (not a Monday column). Keyed by the
-- Monday item id (same key the rest of the client mirror uses).

create table if not exists client_connection_overrides (
  monday_item_id text not null,
  -- One of: stripe | meta | monday | trengo | drive. Matches the ClientHealth
  -- service keys in src/lib/integrations/health.ts.
  service text not null,
  -- true = explicitly marked "not applicable for this client".
  not_applicable boolean not null default false,
  -- Optional free-text reason ("client uses their own CRM", "no content folder").
  note text,
  -- Who set it + when, for the audit trail / tooltip.
  set_by uuid references users(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (monday_item_id, service)
);

-- Anon access blocked like every other table; server uses the service role.
alter table client_connection_overrides enable row level security;
