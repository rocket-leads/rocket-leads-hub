-- Watch List action loop.
--
-- A campaign manager marks "action performed" on a client in Action Needed,
-- logs what they did + a short update for the account manager, and picks a
-- review window (2-7 days). The client moves Action Needed → Watchlist
-- "in review" until review_due_at fires, at which point the cron re-runs
-- categorize() purely on KPIs. If still concerning, the client flips back
-- to Action Needed with an outcome insight referencing what was tried.
--
-- Two surfaces:
--   1. `watchlist_actions` - append-only audit log. Every action stays
--      forever with the KPI snapshot at decision time + the outcome the
--      cron recorded after the review window. This is what the AI Note
--      generator reads to learn "creative iterations recover 60% of
--      cases" / "pause-only didn't help on this client last 2 actions."
--   2. `watchlist_client_state` extension - denormalized pointer to the
--      currently-open action so the categorizer can apply the override
--      without a join on every render.
--
-- The action_text is also the canonical AM update: when the CM submits,
-- we write an inbox_events row of kind='update' to the AM, and store the
-- id back here so the AM update and the audit row stay linked.

create table if not exists watchlist_actions (
  id              uuid primary key default gen_random_uuid(),
  monday_item_id  text not null,
  client_name     text,
  -- Five categories matching the optimisation classes documented in
  -- knowledge/campaigns.md ("Optimisation Proposal: Concrete Actie
  -- Categorieën"). Keep these stable - the outcome aggregations on the
  -- AI side will reference them by literal value.
  action_category text not null check (
    action_category in ('creative', 'pause', 'angle', 'funnel', 'other')
  ),
  -- What the CM actually did. Free text, 1-2 sentences. Surfaces verbatim
  -- in the AM's Updates feed and feeds back into the next AI Note generation
  -- as "previous action" context.
  action_text     text not null,
  -- KPI snapshot at decision time (mirrors watchlist_overrides shape so
  -- the same aggregation queries work over both tables).
  kpi_snapshot    jsonb,
  -- Insight string the CM was looking at when they marked done. Useful
  -- learning signal ("CM consistently picks 'creative' when rules say
  -- 'CPL up X%' on a creative-driven client").
  insight_at_time text,
  -- Link back to the inbox_events row that delivered the AM notification.
  -- Null when AM-mapping was missing at action time (rare).
  inbox_event_id  uuid references inbox_events(id) on delete set null,
  created_by      uuid references public.users(id),
  created_at      timestamptz not null default now(),
  -- When the cron should re-check this client's KPIs against the snapshot.
  -- Default + 3 days; CM can pick 2/3/5/7 in the dialog.
  review_due_at   timestamptz not null,
  -- Stamped when the cron actually runs the re-check. Null while pending.
  reviewed_at     timestamptz,
  -- Cron-derived outcome. recovered = client moved to Healthy/Watchlist.
  -- improved/unchanged = still same bucket but trend better/flat.
  -- worse = severity increased vs snapshot.
  outcome         text check (outcome in ('recovered', 'improved', 'unchanged', 'worse')),
  outcome_note    text,
  outcome_kpi_snapshot jsonb,
  -- A new action on the same client supersedes the previous open one
  -- (only one active action per client at a time, the rest are history).
  superseded_at   timestamptz
);

create index if not exists idx_watchlist_actions_monday_item_id
  on watchlist_actions(monday_item_id);
create index if not exists idx_watchlist_actions_created_at
  on watchlist_actions(created_at desc);
-- Open actions = candidates for the cron review pass. The where clause
-- keeps this index tiny (one row per actively-monitored client) so the
-- daily cron lookup is O(few).
create index if not exists idx_watchlist_actions_open_review
  on watchlist_actions(review_due_at)
  where reviewed_at is null and superseded_at is null;
-- Latest action per client (for the action-history popover in the UI).
create index if not exists idx_watchlist_actions_client_recent
  on watchlist_actions(monday_item_id, created_at desc);

alter table watchlist_actions enable row level security;
drop policy if exists "No anon access to watchlist_actions" on watchlist_actions;
create policy "No anon access to watchlist_actions"
  on watchlist_actions for all to anon using (false);

-- Denormalized pointer to the currently-open action so the state-route
-- + UI can apply the override without a watchlist_actions join.
alter table watchlist_client_state
  add column if not exists active_action_id uuid references watchlist_actions(id) on delete set null,
  add column if not exists active_action_review_due_at timestamptz;

create index if not exists idx_watchlist_client_state_active_action
  on watchlist_client_state(active_action_review_due_at)
  where active_action_id is not null;
