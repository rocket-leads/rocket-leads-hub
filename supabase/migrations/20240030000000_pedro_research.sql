-- Pedro research library: stores AI-generated campaign research per branche/client
-- Replaces the local filesystem approach (research-data/*.json) from the standalone Pedro app.
-- All rows are scoped to the authenticated service role; anon access blocked by RLS.

create table if not exists pedro_research (
  id text primary key, -- slugified identifier: branche__klantnaam__timestamp
  branche text not null,
  klantnaam text default '',
  label text default '',
  doelgroep text default '',
  propositie text default '',
  extra_context text default '',
  research jsonb not null,
  saved_at timestamptz not null default now()
);

-- Block all anon access; service role bypasses RLS.
alter table pedro_research enable row level security;

drop policy if exists "No anon access" on pedro_research;
create policy "No anon access"
  on pedro_research
  for all
  to anon
  using (false);
