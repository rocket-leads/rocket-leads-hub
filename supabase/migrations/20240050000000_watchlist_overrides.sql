-- Watch List manual overrides.
--
-- Campaign managers can move a client between Action / Watch / Good buckets when
-- the rules-based categorizer is "right but wrong" (e.g. CPL spike is a known
-- one-off after a creative refresh — no action needed). The override is hard:
-- the client immediately renders in the chosen bucket. It expires after 7 days
-- OR earlier when CPL/spend moves >25% from the snapshot — whichever comes
-- first — so a forgotten override can never permanently mask a real signal.
--
-- Two surfaces:
--   1. `watchlist_client_state` extension — the ACTIVE override (one row per
--      client). Categorizer reads this and short-circuits the rules path.
--   2. `watchlist_overrides` — append-only audit log. Every override decision
--      lives here forever with the KPI snapshot at decision time. This is the
--      learning corpus the AI adjustment layer feeds on to recognise recurring
--      patterns ("CPL recovered + good lead quality → CM consistently moves to
--      Watch") and pre-emptively apply them to future similar cases.

alter table watchlist_client_state
  add column if not exists manual_category text
    check (manual_category in ('action', 'watch', 'good')),
  add column if not exists override_reason text,
  add column if not exists override_kpi_snapshot jsonb,
  add column if not exists overridden_by uuid references public.users(id),
  add column if not exists overridden_at timestamptz,
  add column if not exists override_expires_at timestamptz;

create index if not exists idx_watchlist_client_state_manual_category
  on watchlist_client_state(manual_category)
  where manual_category is not null;

-- Audit log — never overwritten, never deleted. The full history of who moved
-- what when, with the KPI snapshot at that exact moment so the AI layer can
-- reconstruct "what did the data look like when the team decided X".
create table if not exists watchlist_overrides (
  id              uuid primary key default gen_random_uuid(),
  monday_item_id  text not null,
  client_name     text,
  from_category   text check (from_category in ('action', 'watch', 'good', 'no-data')),
  to_category     text not null check (to_category in ('action', 'watch', 'good')),
  reason          text not null,
  kpi_snapshot    jsonb,                  -- adSpend / leads / cpl / prevCpl / cpa / appts at decision time
  insight_at_time text,                   -- the rules-based insight that the CM was looking at
  created_by      uuid references public.users(id),
  created_at      timestamptz not null default now(),
  -- Set when the override is no longer active. Null while the override is live.
  expired_at      timestamptz,
  -- Why it expired: 'manual' (cleared by user), 'time' (7d max),
  -- 'kpi_shift' (data moved >25% from snapshot), 'superseded' (new override on same client).
  expiry_cause    text check (expiry_cause in ('manual', 'time', 'kpi_shift', 'superseded'))
);

create index if not exists idx_watchlist_overrides_monday_item_id on watchlist_overrides(monday_item_id);
create index if not exists idx_watchlist_overrides_created_at     on watchlist_overrides(created_at desc);
create index if not exists idx_watchlist_overrides_active         on watchlist_overrides(monday_item_id) where expired_at is null;

alter table watchlist_overrides enable row level security;
