-- Emoji reactions on inbox items (tasks + updates).
--
-- The internal inbox is becoming a Monday-style "update feed" where a teammate
-- can react to an update/task with an emoji (👍 ✅ ❤️ …) instead of writing a
-- whole reply. One row per (item, user, emoji): a user can add several distinct
-- emoji to the same item, but the same emoji only once (toggle off = delete).
--
-- Deliberately NOT on inbox_comments for now - Roy's spec reacts on the parent
-- update, matching Monday's per-update reaction bar. Reactions on individual
-- replies can be added later with a sibling table if the need shows up.

-- NB: the items table was renamed inbox_items -> inbox_events in an earlier
-- migration; the FK must point at inbox_events (the original `inbox_items`
-- reference failed the push and blocked every migration after it).
create table if not exists inbox_reactions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references inbox_events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  -- One (item, user, emoji) at most: toggling the same emoji removes the row.
  unique (item_id, user_id, emoji)
);

create index if not exists idx_inbox_reactions_item on inbox_reactions(item_id);

-- Same lockdown as the rest of the inbox: no anon access, service role only.
alter table inbox_reactions enable row level security;
create policy "No anon access to inbox_reactions" on inbox_reactions for all to anon using (false);
