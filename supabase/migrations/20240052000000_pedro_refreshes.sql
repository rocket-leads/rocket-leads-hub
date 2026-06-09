-- Pedro stage-refresh history — table per refresh run, replaces the
-- pedro_client_state.<stage>.refreshes[] JSONB blob pattern.
--
-- Why a dedicated table:
--   (1) The blob pattern was capped at 20 entries; a real CM accumulates
--       40-100 refreshes per client over a quarter. Table-level cap is
--       30 days, which is unbounded for normal use.
--   (2) Only `creatives` persisted; angles/script/ad-copy were ephemeral
--       and the €0.50-€2 Anthropic spend per run was being wasted.
--   (3) Joining a single refresh to a Hub inbox event (when the CM
--       clicked "save to inbox") or a Google Drive file (when they
--       clicked "save to Drive") is trivial against a flat table; on
--       a JSONB array it requires expression indexes that don't exist.
--
-- We do NOT migrate existing refreshes out of pedro_client_state.creatives
-- — the array is still read by the prompt-context builder and a few
-- legacy surfaces (see crossClientExamplesBlock). Both surfaces coexist
-- until those callers are migrated; new writes target this table only.
-- Roy 2026-06-09.

CREATE TABLE IF NOT EXISTS pedro_refreshes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Hub-canonical client id (Monday item id, same shape as pedro_client_state).
  client_id text NOT NULL,
  -- Stage discriminator — same enum as pedro_stage_versions for consistency.
  stage text NOT NULL CHECK (stage IN ('creatives', 'angles', 'script', 'ad_copy')),

  -- Who ran it. Nullable for cron-triggered runs (none today, but future-proofs).
  generated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  generated_at timestamptz NOT NULL DEFAULT NOW(),

  -- Performance window the refresh analysed. Stored as plain columns for
  -- easy filtering ("show me last week's creative refreshes") rather than
  -- nested in JSONB.
  window_start date NOT NULL,
  window_end date NOT NULL,
  window_days integer NOT NULL,

  -- Pedro's full envelope. Stage-specific shape lives inside; the
  -- read-back endpoint trusts the discriminator + content.
  --   creatives: { stats, trend, summary, proposals: [{basedOnAd, preserve, variants:[{label, adName, formatHint, newHook, scriptOutline, primaryCopySnippet, why}]}], warnings }
  --   angles:    { proposals: [...], summary, warnings }
  --   script:    { proposals: [...], summary, warnings }
  --   ad_copy:   { proposals: [...], summary, warnings }
  envelope jsonb NOT NULL,

  -- Tags for searchability. We surface "saved" badges in the history
  -- panel + the Pedro learning loop later filters by these.
  saved_to_inbox_event_id uuid REFERENCES inbox_events(id) ON DELETE SET NULL,
  saved_to_drive_file_id text,
  saved_to_drive_url text,

  -- Cost accounting — populated when we know it from the Anthropic
  -- response. Nullable for backfills / older rows.
  prompt_tokens integer,
  completion_tokens integer
);

CREATE INDEX IF NOT EXISTS idx_pedro_refreshes_client_stage
  ON pedro_refreshes (client_id, stage, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pedro_refreshes_user_recent
  ON pedro_refreshes (generated_by, generated_at DESC)
  WHERE generated_by IS NOT NULL;

-- Pruning policy: 30-day rolling window. A normal CM accumulates ~5-10
-- refreshes per client per week; 30 days = ~50/client max. Heavy enough
-- to learn from, light enough that the JSONB doesn't bloat the table.
-- Run from a daily cron job.
COMMENT ON TABLE pedro_refreshes IS
  'Pedro stage-refresh history. Pruned to 30 days. New writes from 2026-06-09 land here instead of pedro_client_state.<stage>.refreshes[].';

NOTIFY pgrst, 'reload schema';
