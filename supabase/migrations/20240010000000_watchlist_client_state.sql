-- Watch List bucket state per client.
--
-- Tracks the current Watch List bucket and when the client entered it. Powers:
--   1. The "Days in Action" / "Days in Watch" indicator on the Watch List rows
--      (today - since_date).
--   2. The NEW badge for clients whose since_date === today (i.e. they just
--      transitioned into the bucket).
--   3. The yesterday-vs-today health-score trend in the summary header. We keep
--      `prev_category` so we can reconstruct yesterday's bucket counts without
--      maintaining a daily snapshot table — for any client whose since_date is
--      today, prev_category was their bucket yesterday; otherwise category is.
--
-- One row per client, written by the refresh-cache cron whenever a client's
-- bucket transitions. If category hasn't changed, the cron leaves the row alone
-- so since_date stays anchored at the original transition date.
create table if not exists watchlist_client_state (
  monday_item_id text primary key,
  category       text not null check (category      in ('action', 'watch', 'good', 'no-data')),
  prev_category  text          check (prev_category in ('action', 'watch', 'good', 'no-data')),
  since_date     date not null,
  updated_at     timestamptz not null default now()
);

create index if not exists idx_watchlist_client_state_category on watchlist_client_state(category);
create index if not exists idx_watchlist_client_state_since_date on watchlist_client_state(since_date);

-- Service role writes from the cron and the watchlist API. RLS off — anon
-- clients should never touch this table directly.
alter table watchlist_client_state enable row level security;
