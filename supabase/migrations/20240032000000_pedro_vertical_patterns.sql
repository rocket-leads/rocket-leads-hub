-- Pedro vertical winning-patterns library — agency-level moat.
--
-- For every "vertical" (clustered from clients.brief.sector free-text),
-- a nightly cron computes the top winning ads + common angles/hooks/
-- formats from winners across all RL clients in that vertical. Pedro
-- reads from this table during angles/script/ad-copy generation +
-- creative refresh — instant lookups instead of fan-out Meta API calls
-- per request.
--
-- Selection per knowledge/campaigns.md 2026-Q2 status note: CPL-driven.
-- Lead-quality-validated patterns are the strategic eindstaat (Phase 5+).

create table if not exists pedro_vertical_patterns (
  -- Normalised vertical key — first significant non-stopword token from
  -- brief.sector, lowercased. E.g. "Renovatie - badkamers" → "renovatie".
  -- Coarse on purpose: same vertical maps from multiple sector typings.
  vertical text primary key,

  -- Sample of original sector strings that mapped to this key. UI can
  -- show "covers: Renovatie / Badkamers / Verbouwing" so the AM knows
  -- what's in the bucket.
  sector_aliases jsonb default '[]'::jsonb,

  -- Top winners across the vertical, sorted by CPL ascending.
  -- Schema: [{ adName, sourceClientName, sourceSector, cpl, leads,
  --           spend, ctr, body, creativeType }]
  top_winners jsonb default '[]'::jsonb,

  -- Claude-synthesised angle patterns from the winners.
  -- Schema: [{ angle, frequency, examples: ["ad name 1", ...] }]
  common_angles jsonb default '[]'::jsonb,

  -- Claude-synthesised hook patterns.
  -- Schema: [{ hookType, exampleOpener, frequency }]
  common_hooks jsonb default '[]'::jsonb,

  -- Format distribution as proportions: { video: 0.62, image: 0.31, ... }.
  format_distribution jsonb default '{}'::jsonb,

  -- How many ads contributed to this row (across all candidate clients).
  sample_size integer not null default 0,

  -- Number of distinct clients that contributed winners.
  client_count integer not null default 0,

  -- Last successful refresh.
  refreshed_at timestamptz not null default now(),
  -- When Claude last synthesised the angles/hooks blocks (might trail
  -- top_winners refresh by one cycle if synthesis fails — we still
  -- update top_winners independently so the table is always queryable).
  synthesised_at timestamptz
);

-- Most-recent-fresh lookup — the cron uses this to find rows older
-- than 24h to refresh first.
create index if not exists pedro_vertical_patterns_refreshed_idx
  on pedro_vertical_patterns (refreshed_at desc);

-- Block all anon access; service role bypasses RLS (same pattern as
-- pedro_research and pedro_client_state).
alter table pedro_vertical_patterns enable row level security;

create policy "No anon access"
  on pedro_vertical_patterns
  for all
  to anon
  using (false);
