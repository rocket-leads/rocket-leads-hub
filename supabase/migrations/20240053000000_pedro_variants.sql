-- Pedro generated-variant outcomes — closes the learning loop.
--
-- For every variant Pedro proposes (creative refresh today, more stages
-- later), we flatten one row here with the canonical ad name as the
-- match key. A daily cron then takes the LIVE Meta ad performance and
-- joins on `ad_name` to enrich each variant with its real-world
-- outcome (spend, leads, CPL, winner/loser verdict). The next refresh
-- prompt then surfaces these outcomes so Pedro can repeat what worked
-- and stop proposing variants in directions that didn't.
--
-- Why a flat table (not enrichment inside pedro_refreshes.envelope):
--   (1) Exact-match lookup by ad_name needs a btree index — JSONB
--       expression indexes for paths inside an array are awkward and
--       slow.
--   (2) The learning prompt needs to query across many refreshes:
--       "what are this client's past Pedro variants and how did they
--       do?". One SELECT vs N envelope-extractions.
--   (3) Future cross-client learning ("same-vertical winners from
--       other RL clients") joins this table to itself by sector —
--       again, needs flat columns.
--
-- Roy 2026-06-09: "Pedro moet weer kunnen leren — UTM koppelt ad-naam
-- aan een proposal, en daar moet hij van leren."

CREATE TABLE IF NOT EXISTS pedro_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Provenance: which refresh produced this variant.
  refresh_id uuid NOT NULL REFERENCES pedro_refreshes(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('creatives', 'angles', 'script', 'ad_copy')),
  generated_at timestamptz NOT NULL DEFAULT NOW(),

  -- Variant identity. ad_name is the exact string the CM was expected
  -- to paste into Meta — uniqueness is enforced per client so the
  -- sync cron can deterministically resolve matches.
  ad_name text NOT NULL,
  format_hint text NOT NULL CHECK (format_hint IN ('Photo', 'Video')),
  topic_label text NOT NULL,
  proposal_index integer NOT NULL,
  variant_index integer NOT NULL,

  -- The text Pedro generated. Stored here (not just in the JSONB
  -- envelope) so the prompt block can show "this was the hook" for
  -- past winners — driving the next iteration in the same DNA.
  hook text,
  script_outline text,
  primary_copy_snippet text,

  -- Outcome (populated by sync-pedro-variants cron).
  last_synced_at timestamptz,
  -- Meta `ad_id` we matched on. Null until first match (or never if
  -- the CM didn't ship this variant with the canonical name).
  meta_ad_id text,
  spend numeric(12,2),
  leads integer,
  cpl numeric(10,2),
  ctr numeric(6,3),
  -- Verdict — same enum as the watchlist/categorize convention:
  --   winner       — cpl ≤ 0.7 × account_avg_cpl AND leads ≥ 3
  --   loser        — cpl ≥ 1.4 × account_avg_cpl OR (spend > 50 AND leads = 0)
  --   neutral      — has activity but not a clear verdict
  --   not_shipped  — 14+ days since generated, never matched in Meta
  --   pending      — initial state (just generated, awaiting first sync)
  outcome text NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending', 'winner', 'loser', 'neutral', 'not_shipped')),
  account_avg_cpl_at_sync numeric(10,2)
);

-- Exact-match lookup by ad_name within a client — the cron's hot path.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedro_variants_client_adname
  ON pedro_variants (client_id, ad_name);

-- Per-client query: "what are this client's past variants and outcomes?".
CREATE INDEX IF NOT EXISTS idx_pedro_variants_client_recent
  ON pedro_variants (client_id, generated_at DESC);

-- For the sync cron: find variants that need (re)syncing.
CREATE INDEX IF NOT EXISTS idx_pedro_variants_needs_sync
  ON pedro_variants (last_synced_at NULLS FIRST, generated_at);

COMMENT ON TABLE pedro_variants IS
  'Flat per-variant outcome table. Fed by creative-refresh writes; enriched daily by sync-pedro-variants cron via Meta ad_name match. Surfaced back into the next refresh prompt as the LEARNING block.';

NOTIFY pgrst, 'reload schema';
