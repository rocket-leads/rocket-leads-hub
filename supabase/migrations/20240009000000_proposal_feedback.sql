-- Proposal feedback: tracks which AI optimization proposals were marked
-- done / later / skip by managers. Used both to keep the UI clean and to
-- feed back into the AI prompt as a learning signal per client.
CREATE TABLE IF NOT EXISTS proposal_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  monday_item_id TEXT NOT NULL,

  -- Stable fingerprint for deduping the "same" insight across regenerations.
  -- Computed client-side as md5(lower(type + '|' + title)).
  insight_fingerprint TEXT NOT NULL,

  -- Snapshot of the insight at the moment of feedback.
  insight_type TEXT NOT NULL CHECK (insight_type IN ('positive', 'warning', 'critical', 'action')),
  insight_title TEXT NOT NULL,
  insight_action TEXT,
  insight_detail TEXT,

  -- Manager's verdict.
  status TEXT NOT NULL CHECK (status IN ('done', 'later', 'skip')),
  feedback_note TEXT,

  -- For 'later' status: when the insight should resurface (default +7 days).
  snoozed_until TIMESTAMPTZ,

  -- Context snapshot for the learning loop — KPI's en lead feedback at the
  -- moment the proposal was generated. Helps the AI reason about why advice
  -- was accepted or rejected later on.
  kpi_snapshot JSONB,
  context_snapshot JSONB,

  resolved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One feedback row per client × insight fingerprint. Re-clicking a button
-- updates the existing row instead of creating a new one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_feedback_unique
  ON proposal_feedback (client_id, insight_fingerprint);

CREATE INDEX IF NOT EXISTS idx_proposal_feedback_monday_item
  ON proposal_feedback (monday_item_id);

CREATE INDEX IF NOT EXISTS idx_proposal_feedback_snoozed
  ON proposal_feedback (snoozed_until)
  WHERE status = 'later';

ALTER TABLE proposal_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No anon access to proposal_feedback" ON proposal_feedback FOR ALL TO anon USING (false);
