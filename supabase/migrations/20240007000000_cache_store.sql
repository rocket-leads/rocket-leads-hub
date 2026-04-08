-- Cache store for pre-computed API data (KPI summaries, billing, etc.)
-- Refreshed every 30 minutes via Vercel Cron
create table if not exists cache_store (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Index on updated_at for quick staleness checks
create index if not exists idx_cache_store_updated_at on cache_store (updated_at);
