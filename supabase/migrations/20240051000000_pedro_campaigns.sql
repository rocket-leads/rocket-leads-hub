-- Pedro campaigns — named campaign containers per client.
--
-- Until now Pedro implicitly assumed one campaign per client. The
-- existing `pedro_stage_versions` table already carried a
-- `campaign_number` column (default 1) so the schema was ready, but
-- nothing in the UI ever used a value other than 1, and there was no
-- place to store campaign-level metadata (name, who created it, when
-- it was last touched).
--
-- Roy 2026-05-23: campaigns must be named, multiple can coexist per
-- client (different audiences / tone-of-voice strategies running in
-- parallel), the picker defaults to the most-recently-used one, and
-- previous campaigns stay selectable so the CM can branch off them.
--
-- Data model:
--   - One row per (client_id, campaign_number) — the name + audit fields
--     a campaign needs that don't belong on every stage-version row.
--   - `campaign_number` stays an integer keyed to `pedro_stage_versions`
--     (no FK rewrites) so the existing version pipeline is untouched.
--   - `last_used_at` updates whenever the CM opens, saves to, or
--     otherwise works on the campaign — drives default selection.
--   - Soft-delete via `archived_at`; hard delete cascades stage versions
--     via the existing FK on client_id, which is what we want only when
--     a client itself is removed.

create table if not exists pedro_campaigns (
  id              uuid primary key default gen_random_uuid(),
  client_id       text not null references clients(monday_item_id) on delete cascade,
  campaign_number integer not null,

  -- Human-readable name. Falls back in the UI to "Campagne {N}" when
  -- null (covers backfilled rows where the CM hasn't renamed yet).
  name            text,
  notes           text,

  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),

  -- Bumped by API every time a campaign is loaded, saved-to, or marked
  -- active in the picker. Sort key for "most recent" default selection.
  last_used_at    timestamptz not null default now(),

  -- Null = active. When set, the campaign is hidden from the default
  -- picker view but its saved versions stay readable via direct link.
  archived_at     timestamptz,

  unique (client_id, campaign_number)
);

create index if not exists pedro_campaigns_recent_idx
  on pedro_campaigns (client_id, last_used_at desc)
  where archived_at is null;

alter table pedro_campaigns enable row level security;

drop policy if exists "No anon access" on pedro_campaigns;
create policy "No anon access"
  on pedro_campaigns
  for all
  to anon
  using (false);

-- Backfill: every distinct (client_id, campaign_number) that already
-- has saved versions becomes a default-named pedro_campaigns row. The
-- CM can rename later; the point is that the picker has something to
-- show for clients with pre-existing work.
insert into pedro_campaigns (client_id, campaign_number, name, created_at, last_used_at)
select distinct
  v.client_id,
  v.campaign_number,
  'Campagne ' || v.campaign_number,
  min(v.saved_at) as created_at,
  max(v.saved_at) as last_used_at
from pedro_stage_versions v
group by v.client_id, v.campaign_number
on conflict (client_id, campaign_number) do nothing;
