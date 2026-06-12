-- Pedro insights: single source of truth for all AI-generated client analyses.
--
-- Replaces the fragmented status quo where each AI surface had its own
-- cache key + prompt + Claude call:
--   - watchlist_summaries_v8 (1-line AI Notes per watchlist row)
--   - watchlist_narrative_*  (top-of-watchlist insights + proposals)
--   - overview_proposals     (per-client AI proposals on /clients overview)
--   - per-client optimisation/lead-quality cached in cache_store
--   - Pedro creative-refresh, knowledge-proposals, insights
-- Each had its own prompt, drifted in tone/rules, and only some had
-- guardrail enforcement. This table consolidates them.
--
-- One row per (monday_item_id, insight_type) pair. The cron upserts on that
-- composite key — re-running the cron just freshens the body, never adds
-- a duplicate.
--
-- The insight_type column is intentionally text (not enum) so adding a new
-- insight surface is a code-only change, no migration. Conventions:
--   watchlist_action_note   - 1-line note shown on watchlist row
--   watchlist_insights      - "Key Insights" cards at top of watchlist
--   watchlist_proposals     - "Optimisation Proposal" cards at top of watchlist
--   client_optimisation_7d  - Per-client optimisation proposal (7d window)
--   client_optimisation_14d - Per-client optimisation proposal (14d window)
--   client_optimisation_30d - Per-client optimisation proposal (30d window)
--   client_lead_quality     - UTM-grouped lead quality verdict
--   client_overview         - Short summary used on the client detail header
--
-- The cron writes ALL of these per Live client per tick. Consumers read
-- the row that matches their surface — no separate Claude calls needed.

create table if not exists pedro_insights (
  id uuid primary key default gen_random_uuid(),

  -- Hub-canonical client identifier (Monday item ID). Same key the rest
  -- of the Hub uses, so consumers join straight in.
  monday_item_id text not null,

  -- See header comment for the convention. Free-form text so adding a
  -- new surface is a code-only change.
  insight_type text not null,

  -- The AI output. Plain string; consumers parse if they need structure
  -- (some surfaces store JSON-shaped strings — fine, keep it simple).
  body text not null,

  -- Optional severity hint for sorting / colour-coding. Conventions:
  --   high  - urgent / problematic
  --   med   - watch / monitor
  --   low   - good / informational
  --   info  - neutral context
  severity text check (severity in ('high', 'med', 'low', 'info', null)),

  -- Audit trail: which data sources actually reached the prompt. Lets us
  -- diagnose "why did Pedro write X?" without re-running anything. Shape
  -- is per-insight but always JSON object with the source flags as keys.
  -- Example: {"kpi": true, "monday_updates": true, "trengo": false,
  -- "fathom": false, "tasks": true, "agreement": true}
  sources_used jsonb not null default '{}'::jsonb,

  -- Guardrail violations detected at validation time. Logged but the
  -- insight may still be persisted (production resilience over hard fail).
  -- Empty array when clean. Shape mirrors GuardrailViolation from
  -- src/lib/ai/guardrails.ts.
  guardrail_violations jsonb not null default '[]'::jsonb,

  -- Bumped whenever the prompt changes for this insight_type. Lets us
  -- expire stale-prompt insights without truncating the table — just
  -- bump prompt_version in code and the next cron tick rewrites.
  prompt_version integer not null default 1,

  -- Model used. Lets us A/B prompts across models per insight type
  -- (Haiku for short notes, Sonnet for full analyses).
  model text not null default 'claude-haiku-4-5-20251001',

  generated_at timestamptz not null default now(),

  -- Soft expiry for the "needs re-gen" check. Cron treats anything past
  -- expires_at as fair game even when the insight content hasn't changed.
  expires_at timestamptz,

  -- One row per (client, insight_type) — the cron upserts.
  unique (monday_item_id, insight_type)
);

-- Look-ups by client (for the per-client surfaces) and by type
-- (for the watchlist that wants every action_note in one go).
create index if not exists pedro_insights_client_idx
  on pedro_insights (monday_item_id);
create index if not exists pedro_insights_type_idx
  on pedro_insights (insight_type, generated_at desc);

alter table pedro_insights enable row level security;

drop policy if exists "No anon access" on pedro_insights;
create policy "No anon access"
  on pedro_insights
  for all
  to anon
  using (false);
