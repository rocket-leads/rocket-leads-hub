-- Per-client wizard state for the Onboarding flow.
--
-- The Onboarding wizard at /onboarding/[id] walks the AM through a fixed
-- 7-step sequence (kick-off link → Drive setup → client brief → onboarding
-- email → wait on client → Hub wiring → handoff to CM). The registry of
-- steps lives in TypeScript (src/lib/clients/onboarding.ts) — enforcing the
-- key set in SQL would just create a migration every time we tweak the
-- flow. Stale rows (key removed from registry) are harmless; they just
-- stop being read.
--
-- One row per (client, step). The wizard derives "current step" as the
-- lowest-ordered step that isn't `done=true` AND whose prerequisites are
-- all satisfied. `content` holds step-specific output (the brief JSON,
-- the onboarding-email body, the competitor-analysis text) so the next
-- visit shows the AM's prior work pre-loaded.

create table if not exists client_onboarding_tasks (
  monday_item_id  text        not null,
  task_key        text        not null,
  done            boolean     not null default false,
  /** Rich per-step output. Brief = full GeneratedBrief JSON; onboarding
   *  email = { body, channel, sent_at }; competitor analysis = { text };
   *  others may be empty. Kept as jsonb so each step's shape can evolve
   *  without a schema change. */
  content         jsonb,
  notes           text,
  completed_at    timestamptz,
  completed_by    uuid        references public.users(id),
  updated_at      timestamptz not null default now(),
  primary key (monday_item_id, task_key)
);

create index if not exists idx_client_onboarding_tasks_done
  on client_onboarding_tasks(monday_item_id) where done = true;

alter table client_onboarding_tasks enable row level security;
