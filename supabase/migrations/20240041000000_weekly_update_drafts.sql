-- Weekly Update drafts queue.
--
-- Every Monday 07:00 NL-time a cron walks all Live clients with a Trengo
-- contact and pre-composes a V2 weekly-update draft (same `composeInitialParts`
-- logic that powers the manual Client Update dialog). Drafts land in this
-- table with status='pending'. AMs see a banner on /clients counting their
-- pending drafts; opening one routes into the existing Client Update dialog
-- pre-filled with `parts`, so the review-and-send UX is identical to the
-- manual flow — just without the 30s of typing per client.
--
-- Idempotency: the cron is keyed on (client_id, week_of). Re-running the
-- same Monday is a no-op (the unique index swallows the second insert).
-- This matters because Vercel may retry on transient failures.

CREATE TABLE IF NOT EXISTS weekly_update_drafts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  monday_item_id  TEXT NOT NULL,
  -- The Monday (ISO week start) this draft is FOR. Stored as DATE so
  -- the unique constraint is timezone-stable. The cron writes the Monday
  -- of its run-week regardless of when it actually fires (07:00 NL ≈
  -- 06:00 UTC on the same calendar day).
  week_of         DATE NOT NULL,
  -- Snapshot of EditableParts (opener, intro, kpiBlock, trendSentence,
  -- note, conclusion, actionsHeader, actions, subject, signOff). Loaded
  -- as initial state when the AM opens the dialog from a draft.
  parts           JSONB NOT NULL,
  -- 1 = V1 universal single-var. 2 = V2 multi-var weekly. Mirrors the
  -- value returned by /client-update so the dialog knows which layout
  -- to render without re-resolving.
  template_version SMALLINT NOT NULL,
  template_name   TEXT,
  channel         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'dismissed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  sent_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Trengo outbound message id once the AM hits Send (mirrors
  -- client_updates.trengo_message_id so we can trace draft → audit row).
  sent_message_id TEXT,
  dismissed_at    TIMESTAMPTZ,
  dismissed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

-- One draft per client per week. Cron uses ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS weekly_update_drafts_client_week_uniq
  ON weekly_update_drafts (client_id, week_of);

-- Banner query: "count pending drafts visible to the current user". The
-- per-user filter happens via client_access at query-time, not in the
-- index, so we keep the index broad on status + created_at.
CREATE INDEX IF NOT EXISTS weekly_update_drafts_status_created_idx
  ON weekly_update_drafts (status, created_at DESC);

ALTER TABLE weekly_update_drafts ENABLE ROW LEVEL SECURITY;
-- Service-role-only access (consistent with the rest of the schema —
-- the Hub talks to Supabase via the admin client, never anon).
