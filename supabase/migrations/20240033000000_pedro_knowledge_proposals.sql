-- Pedro knowledge-base proposals.
--
-- When 5+ same-vertical clients converge on a winning pattern (angle or
-- hook) that ISN'T already in knowledge/campaigns.md, a weekly cron
-- generates a proposed knowledge update. Roy reviews; if accepted the
-- knowledge file is manually edited (no auto-write — knowledge is too
-- load-bearing for unsupervised file edits).
--
-- One row per pending proposal. Once Roy accepts/rejects, status flips
-- and the row stays as audit trail.

create table if not exists pedro_knowledge_proposals (
  id uuid primary key default gen_random_uuid(),

  -- Vertical the convergence was detected in.
  vertical text not null,

  -- "angle" | "hook" | "format" | "other" — broad category for filtering.
  pattern_type text not null check (pattern_type in ('angle', 'hook', 'format', 'other')),

  -- 1-line summary the proposal title surfaces in the inbox task.
  title text not null,

  -- Markdown body Pedro composed, including:
  -- - the detected convergence (X clients, Y winners)
  -- - the pattern itself (angle/hook details)
  -- - proposed addition / update for knowledge/campaigns.md
  -- - which section of campaigns.md it would slot into
  proposal_body text not null,

  -- Provenance: how many clients + winners back this convergence + the
  -- aggregate CPL stats that justified flagging it.
  evidence jsonb not null default '{}'::jsonb,

  -- pending / accepted / rejected / superseded
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'superseded')),

  -- When/by-whom decided.
  decided_at timestamptz,
  decided_by uuid references users(id),
  decision_note text,

  -- Optional inbox_events.id of the review task created for Roy.
  inbox_task_id uuid,

  created_at timestamptz not null default now()
);

create index if not exists pedro_knowledge_proposals_status_idx
  on pedro_knowledge_proposals (status, created_at desc);

create index if not exists pedro_knowledge_proposals_vertical_idx
  on pedro_knowledge_proposals (vertical, pattern_type);

alter table pedro_knowledge_proposals enable row level security;

create policy "No anon access"
  on pedro_knowledge_proposals
  for all
  to anon
  using (false);
