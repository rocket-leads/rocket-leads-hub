-- Pedro client deliverables — assembled per-client artifact ("Deliverable #1").
--
-- Roy's ask (2026-05-22): every Pedro campaign should produce a single
-- canonical markdown document containing all 7 facets (brief, research,
-- angles, script, creatives/Manus, LP/Lovable, ad copy) bundled into
-- one readable doc that gets attached to the client and acts as the
-- formal "deliverable #1" we hand over.
--
-- Storage model:
--   - One row per (client_id, campaign_number). Regenerating upserts.
--   - content_md is the full assembled markdown — sized for ~30-100KB
--     per row, well within Postgres text limits.
--   - metadata captures which stage version_numbers were assembled so
--     the CM can tell "this deliverable was built from brief v3, lp v2..."
--     in the UI without re-querying every stage.
--
-- The underlying stage versions live in pedro_stage_versions and are
-- the source of truth — this table is just a baked, easy-to-render
-- assembly. Regenerate when stages change; nothing breaks if rows are
-- stale because the regen button always re-reads the latest versions.

create table if not exists pedro_deliverables (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(monday_item_id) on delete cascade,
  campaign_number integer not null default 1,

  -- The full assembled markdown — sections per stage with provenance
  -- ("Brief v3 — saved 2026-05-20") in headings so it reads cleanly
  -- when handed to a client or pasted into Drive/Notion.
  content_md text not null,

  -- { brief_version: 3, research_version: 2, angles_version: 4, ... }
  -- Lets the UI show "built from brief v3, lp v2" without separate
  -- queries against pedro_stage_versions.
  metadata jsonb,

  generated_at timestamptz not null default now(),
  generated_by uuid references users(id),

  unique (client_id, campaign_number)
);

-- Lookup index for "latest deliverable for client X" — campaign_number
-- desc so the most recent campaign wins when a CM has cycled through
-- multiple campaigns for the same client.
create index if not exists pedro_deliverables_client_idx
  on pedro_deliverables (client_id, campaign_number desc);

alter table pedro_deliverables enable row level security;

drop policy if exists "No anon access" on pedro_deliverables;
create policy "No anon access"
  on pedro_deliverables
  for all
  to anon
  using (false);
