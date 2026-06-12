-- Cron heartbeat / observability ring buffer.
--
-- Every Hub cron writes one row per run: when it started, when it finished,
-- success or fail, error message if any, and an optional metrics blob (rows
-- written, batches processed, etc). The /settings/health page reads this
-- table to surface "is X cron healthy" without anyone having to dig through
-- Vercel logs.
--
-- Ring-buffer-style: we keep the last ~500 runs per cron via a daily
-- truncation cron (separate concern, not done in SQL). For now we only
-- write — read patterns just take "latest N per cron".
--
-- One row = one invocation. `cron_name` is the route segment under
-- /api/cron/* (e.g. "refresh-kpi", "slack-team-watchlist"). Keep it stable
-- — the health page groups by it and renames mid-flight will look like a
-- new cron with no history.

create table if not exists cron_runs (
  id uuid primary key default gen_random_uuid(),

  -- Stable identifier. Match the URL segment under /api/cron/*. Anything
  -- else won't aggregate cleanly in the health view.
  cron_name text not null,

  -- ok / error / partial. Partial = batch loop finished but some clients
  -- failed; the cron-specific metrics blob carries the count.
  status text not null check (status in ('ok', 'error', 'partial')),

  started_at timestamptz not null,
  finished_at timestamptz not null,
  duration_ms integer not null,

  -- Trimmed error message when status != 'ok'. Full stack stays in Vercel
  -- logs — this column is just for the health-page summary.
  error_message text,

  -- Free-form metrics: clients processed, rows written, AI calls made, etc.
  -- Schema is per-cron; keep it small (<1KB ideally).
  metrics jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

-- Latest-N-per-cron is the dominant access pattern (health page).
create index if not exists cron_runs_cron_name_started_idx
  on cron_runs (cron_name, started_at desc);

-- Errored runs in the last 24h — fast scan for the "what's broken right
-- now" badge in the navbar.
create index if not exists cron_runs_errors_recent_idx
  on cron_runs (status, started_at desc)
  where status != 'ok';

alter table cron_runs enable row level security;

drop policy if exists "No anon access" on cron_runs;
create policy "No anon access"
  on cron_runs
  for all
  to anon
  using (false);
