-- Per-client Pedro state — every deliverable Pedro generates (brief, angles,
-- scripts, creatives, LP prompts, ad copy, brand style) lives here, scoped to
-- a hub client (Monday item id). One row per (client_id, campaign_number) so
-- a client can have multiple campaign cycles tracked independently.
--
-- This replaces Mike's standalone "download .md per klant" workflow with
-- proper Hub-native storage so the team builds up a per-client database of
-- briefs/strategy/content over time, queryable from anywhere in the Hub.

create table if not exists pedro_client_state (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(monday_item_id) on delete cascade,
  campaign_number integer not null default 1,
  -- Pedro's stage outputs — each is a jsonb blob the Campaign component
  -- writes incrementally as the user progresses through the 6 steps.
  brief jsonb,                  -- BriefData: bedrijf/sector/doel/pijn/aanbod/usps/hooksAM/hooksExtra
  selected_angles jsonb,        -- Array<{ nummer, titel, beschrijving }>
  script_text text,
  script_videos jsonb,          -- Array<ScriptVideo> from generateScriptDocx parser
  creatives jsonb,              -- { qty, formats[], driveLink, brandbookName, huisstijl, manusPrompt }
  lp jsonb,                     -- { stijl, lengte, pixelId, webhookUrl, utmStr, lpPrompt }
  ad_copy jsonb,                -- { variantA, variantB, headlines, beschrijving }
  brand_style jsonb,            -- { primaryColor, secondaryColor, accentColor, tone, ... } from website analysis
  -- Auto-brief provenance — what context Pedro used to fill the brief
  -- (kick-off update, eval transcript, Trengo, etc.). Surfaced in the UI
  -- so the AM knows why a field is filled the way it is.
  auto_brief_meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, campaign_number)
);

-- Quick lookup of a client's most recent campaign — Pedro auto-loads this
-- when an AM picks a client from the picker.
create index if not exists pedro_client_state_client_recent_idx
  on pedro_client_state (client_id, campaign_number desc);

-- Block all anon access; service role bypasses RLS (same pattern as
-- pedro_research and the rest of the Hub).
alter table pedro_client_state enable row level security;

create policy "No anon access"
  on pedro_client_state
  for all
  to anon
  using (false);

-- Auto-update updated_at on every change so the AM can see when Pedro last
-- touched a campaign without us reaching for triggers in app code.
create or replace function pedro_client_state_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger pedro_client_state_updated_at
  before update on pedro_client_state
  for each row execute function pedro_client_state_set_updated_at();
