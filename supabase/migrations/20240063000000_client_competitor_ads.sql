-- Competitor ads scraped from Meta Ad Library during onboarding.
--
-- The onboarding wizard's Client Brief step (step 3) does competitor
-- research as a sub-action: AI suggests competitors based on the
-- client's brief (sector + country + ICP), Apify scrapes their currently-
-- active Meta ads, AI ranks the winners (days-running, creative variety),
-- AM ticks off which ones are real winners. The AM-confirmed winners get
-- uploaded to {client}/Winning Ads/{competitor}/ in Drive and one row
-- per ad lands here for Pedro to query later.
--
-- Pedro's creative-refresh pipeline can join `selected_by_am = true` ads
-- as reference-style inputs when drafting new variants — leverages the
-- AM's curation rather than re-deciding what's winning.
--
-- One row per scraped ad. Multiple rows per (monday_item_id, competitor_*)
-- since each competitor has many ads. `ad_archive_id` is unique within
-- Meta but we scope to (monday_item_id, ad_archive_id) so the same ad
-- can legitimately be scraped for two different RL clients (e.g. two
-- renovation clients with overlapping competitors).

create table if not exists client_competitor_ads (
  id                  uuid primary key default gen_random_uuid(),
  monday_item_id      text not null,

  -- ── Competitor identity ──
  competitor_name     text not null,
  competitor_page_id  text,
  competitor_page_url text,

  -- ── Ad identity (Meta Ad Library) ──
  ad_archive_id       text not null,
  /** Whether the ad was still actively running at scrape time. We only
   *  scrape active=true by default, but the row stays here even after
   *  the ad ends so Pedro can reference historical winners. */
  was_active_at_scrape boolean not null default true,

  -- ── Ad content ──
  headline            text,
  body                text,
  cta_text            text,
  cta_type            text,
  /** image / video / carousel — drives how Pedro consumes the asset and
   *  also picks the right Drive file extension on download. */
  creative_type       text,
  /** Where Apify saw the asset live. For carousel formats this is the
   *  primary card; other cards land in `extra_creatives` jsonb below. */
  creative_url        text,
  creative_preview_url text,
  /** Extra creatives for multi-card formats — array of { url, type,
   *  headline, body }. Empty/null for single-card ads. */
  extra_creatives     jsonb,

  /** facebook / instagram / messenger / audience_network. */
  platforms           jsonb,

  -- ── Activity dates (Apify reports Unix epoch seconds; we cast to ts) ──
  ad_started_at       timestamptz,
  ad_ended_at         timestamptz,
  /** Materialised at scrape time so ranking queries don't need to recompute.
   *  Refreshed on re-scrape — for "winning" classification this is the key
   *  signal: ads running 30+ days have proven they're working. */
  days_running        integer,

  -- ── AM curation ──
  /** AM picks which scraped ads are genuinely winning vs which are spam /
   *  low-quality / off-brand. Only `selected_by_am=true` rows get
   *  uploaded to Drive AND become reference inputs for Pedro. */
  selected_by_am      boolean not null default false,
  selected_at         timestamptz,
  selected_by         uuid references public.users(id),

  -- ── Drive storage (set after the AM confirms selection) ──
  /** Drive file ID of the uploaded creative. Null until AM saves the
   *  selection to Drive — at that point a per-ad file lands in
   *  {client}/Winning Ads/{competitor_name}/ via google_drive uploadFromUrl. */
  drive_file_id       text,
  drive_folder_id     text,

  -- ── Raw scraper output for forensics + future field extraction ──
  /** Verbatim Apify item — keeps us out of the "we shipped an extractor
   *  that ignored field X" trap. Cheap to store at this volume (≤500
   *  rows per client). */
  raw_payload         jsonb,

  scraped_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (monday_item_id, ad_archive_id)
);

create index if not exists idx_client_competitor_ads_client
  on client_competitor_ads(monday_item_id);

create index if not exists idx_client_competitor_ads_selected
  on client_competitor_ads(monday_item_id, selected_by_am) where selected_by_am = true;

create index if not exists idx_client_competitor_ads_days_running
  on client_competitor_ads(monday_item_id, days_running desc) where was_active_at_scrape = true;

alter table client_competitor_ads enable row level security;
