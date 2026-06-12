-- AI Co-pilot drafts — async queue for ⌘J commands.
--
-- Roy's ask (2026-05-22): typing a command shouldn't block on 5-10s of
-- Haiku + Hub-context work. The dialog closes immediately and the user
-- gets a notification 🔔 when the draft is ready to approve.
--
-- Lifecycle:
--   pending   → just queued, server is parsing + enriching
--   ready     → draft_action populated, waiting for user approval
--   approved  → user clicked Approve, executor ran (terminal state)
--   dismissed → user clicked Dismiss (terminal state)
--   failed    → enrichment errored OR TTL exceeded (terminal state)
--
-- Surfaces in the notification bell as long as status='ready' or 'failed'.
-- Approved/dismissed drafts stay in the table for audit but are filtered
-- out of the bell list.

create table if not exists copilot_drafts (
  id uuid primary key default gen_random_uuid(),

  -- Owner — drafts are strictly per-user; nobody else sees your queue.
  user_id uuid not null references users(id) on delete cascade,

  -- The literal command the user typed / dictated. Kept for audit and
  -- so the bell row can show "you said: ..." when expanded.
  input text not null,

  -- pending → ready → (approved | dismissed | failed)
  status text not null
    check (status in ('pending', 'ready', 'approved', 'dismissed', 'failed')),

  -- Discriminated-union JSON shape; see CopilotAction in
  -- src/lib/copilot/tools.ts. Null while status='pending'.
  draft_action jsonb,

  -- One-line human-readable preview the bell renders.
  -- e.g. "Create task: Nieuwe creatives → Mike · Dr. Ludidi · due 2026-05-22"
  summary text,

  -- Source labels actually used in the enriched body, e.g.
  --   ['KPI (7d)', 'Pedro AI Note', 'Monday updates (14d)']
  -- Surfaces in the bell row as "Context: …" so the user can see what
  -- the AI consulted without opening the editor.
  sources_used text[] default '{}'::text[],

  -- Populated when status='failed'. Surfaces in the bell as a red marker.
  error text,

  created_at timestamptz not null default now(),
  -- Set when status flips to 'ready'. Drives the bell badge ordering
  -- (newest-ready-first).
  ready_at timestamptz,
  -- Set when status flips to terminal (approved/dismissed/failed).
  completed_at timestamptz
);

create index if not exists copilot_drafts_user_status_idx
  on copilot_drafts (user_id, status, ready_at desc);

create index if not exists copilot_drafts_pending_created_idx
  on copilot_drafts (status, created_at)
  where status = 'pending';

alter table copilot_drafts enable row level security;

drop policy if exists "No anon access" on copilot_drafts;
create policy "No anon access"
  on copilot_drafts
  for all
  to anon
  using (false);

-- Realtime invalidation pattern: the queue endpoint calls
-- broadcastInvalidate(['copilot-drafts']) when a draft flips to 'ready',
-- so open Hub tabs refetch via React Query. We don't use row-level
-- Realtime — the codebase auth is NextAuth, not Supabase Auth, which
-- makes per-row subscriptions fiddly. See src/lib/realtime/broadcast.ts.
