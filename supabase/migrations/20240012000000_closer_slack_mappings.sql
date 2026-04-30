-- Closer / setter → Slack user mapping. Doesn't require a Hub user account —
-- closers may live only in Monday (the `wie_` column on the targets board) and
-- still need to receive their personal sales DM. Keyed by the Monday person
-- name as it appears in that column.

create table if not exists closer_slack_mappings (
  monday_person_name text primary key,
  slack_user_id      text not null,
  updated_at         timestamptz not null default now()
);

comment on table closer_slack_mappings is
  'Maps a Monday person name (from targets board wie_ column) to their Slack user ID. Used by the daily sales DM cron.';

alter table closer_slack_mappings enable row level security;
