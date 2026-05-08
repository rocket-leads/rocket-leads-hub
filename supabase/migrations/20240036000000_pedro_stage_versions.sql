-- Pedro stage versions — explicit save snapshots per stage.
--
-- Roy's UX (2026-05-08): two-layer storage so the CM can experiment
-- without polluting client data.
--
--   Layer 1 — DRAFT  : pedro_client_state (existing). Auto-saved every
--                      800ms. Survives reloads. Private to working state.
--   Layer 2 — SAVED  : pedro_stage_versions (this table). Explicit
--                      "Save final version" per stage. Each save is a
--                      new immutable row with version_number bumped.
--                      What the rest of the hub reads (client detail
--                      Pedro tab, cross-client examples).
--
-- The drafts stay where they are; this table is purely additive. When
-- code reads "the latest brief for client X", it now prefers the
-- highest-version saved row, falling back to the draft when none exist.

create table if not exists pedro_stage_versions (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(monday_item_id) on delete cascade,
  campaign_number integer not null default 1,

  -- Which Pedro stage this version belongs to. Adding "research" here
  -- too even though Research already saves to pedro_research — having
  -- both is fine; the version table treats research the same as the
  -- other stages so the UI is uniform.
  stage text not null check (stage in (
    'brief', 'angles', 'script', 'creatives', 'lp', 'ad-copy', 'research'
  )),

  -- 1-based, monotonically increasing per (client_id, campaign_number, stage).
  -- App-side increment (find max + 1) since postgres serial wouldn't be
  -- per-stage scoped.
  version_number integer not null,

  -- The full payload of the saved deliverable. Schema mirrors what the
  -- corresponding draft slot in pedro_client_state holds.
  data jsonb not null,

  -- Optional human label ("v3 — added subsidie-angle"). Defaults to
  -- a timestamp-y title in the UI when unset.
  label text,

  -- Audit trail
  saved_by uuid references users(id),
  saved_at timestamptz not null default now(),

  unique (client_id, campaign_number, stage, version_number)
);

-- History lookup: latest versions per stage for a client.
create index if not exists pedro_stage_versions_lookup_idx
  on pedro_stage_versions (client_id, campaign_number, stage, version_number desc);

-- Reverse-chronological list across all stages (client detail Pedro tab).
create index if not exists pedro_stage_versions_recent_idx
  on pedro_stage_versions (client_id, saved_at desc);

alter table pedro_stage_versions enable row level security;

create policy "No anon access"
  on pedro_stage_versions
  for all
  to anon
  using (false);
