-- Inbox: shared table for internal updates and tasks.
--
-- Two kinds, one table — 90% of fields overlap and the list views mix them.
--   "update" = informational note (typically AM → CM). Lifecycle: unread → read.
--   "task"   = actionable work item with status flow + threaded comments.
--
-- client_id holds the Monday item ID (text) rather than a FK to clients(id),
-- because the clients cache is populated lazily by sync and we don't want
-- inbox writes to race with that. Visibility joins resolve through clients
-- when needed.
--
-- Items are mirrored to Monday as updates on the client item (current OR
-- onboarding board, picked at mirror-time from clients.monday_board_type)
-- so Monday stays a complete activity log even when the team works in the Hub.

create table if not exists inbox_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('update', 'task')),
  client_id text not null,
  author_id uuid not null references users(id) on delete restrict,
  assignee_id uuid not null references users(id) on delete restrict,
  title text not null,
  body text,
  -- Status semantics differ by kind:
  --   update: 'unread' | 'read'
  --   task:   'open'   | 'in_progress' | 'done' | 'cancelled'
  status text not null,
  priority text check (priority in ('low', 'normal', 'high')),
  due_date date,
  source text not null default 'manual'
    check (source in ('manual', 'watchlist', 'meeting', 'monday', 'trengo')),
  source_ref jsonb,
  monday_update_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_inbox_items_assignee on inbox_items(assignee_id, status);
create index if not exists idx_inbox_items_author on inbox_items(author_id);
create index if not exists idx_inbox_items_client on inbox_items(client_id);
create index if not exists idx_inbox_items_kind_status on inbox_items(kind, status);

drop trigger if exists inbox_items_updated_at on inbox_items;
create trigger inbox_items_updated_at
  before update on inbox_items
  for each row execute function update_updated_at();

alter table inbox_items enable row level security;
drop policy if exists "No anon access to inbox_items" on inbox_items;
create policy "No anon access to inbox_items" on inbox_items for all to anon using (false);

create table if not exists inbox_comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references inbox_items(id) on delete cascade,
  author_id uuid not null references users(id) on delete restrict,
  body text not null,
  monday_update_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_inbox_comments_item on inbox_comments(item_id, created_at);

alter table inbox_comments enable row level security;
drop policy if exists "No anon access to inbox_comments" on inbox_comments;
create policy "No anon access to inbox_comments" on inbox_comments for all to anon using (false);
