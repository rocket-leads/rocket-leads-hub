-- Phase C.5.a — Fathom meetings integration foundation.
--
-- Adds three pieces that together form the substrate for the matcher (C.5.b),
-- the Meetings tab (C.5.c) and the Unlinked-meetings inbox (C.5.d):
--
--   1. users.fathom_email      — manual Hub-user → Fathom-user mapping. Hub
--                                emails (@rocketleads.com) don't match Fathom
--                                login emails, so we map them by hand in
--                                Settings → Users.
--   2. client_known_identities — learned identity layer. Every time someone
--                                links a meeting to a client by hand, we
--                                extract the external attendees (email,
--                                domain, name, phone) and stash them here so
--                                the next webhook auto-matches at +60 score.
--   3. meetings                — Fathom recordings ingested via webhook,
--                                optionally linked to a client.

-- 1. Hub-user → Fathom-user identity mapping.
ALTER TABLE users ADD COLUMN IF NOT EXISTS fathom_email text;
CREATE INDEX IF NOT EXISTS idx_users_fathom_email
  ON users(fathom_email) WHERE fathom_email IS NOT NULL;

-- 2. Learned identities. Generic enough to also feed Trengo / Stripe matching
--    later, but driven by the meeting-link UX for now.
CREATE TABLE IF NOT EXISTS client_known_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL REFERENCES clients(monday_item_id) ON DELETE CASCADE,
  identity_type text NOT NULL
    CHECK (identity_type IN ('email', 'email_domain', 'name', 'phone')),
  identity_value text NOT NULL,
  source text NOT NULL
    CHECK (source IN ('manual_link', 'auto_match', 'stripe', 'trengo', 'monday', 'google_drive', 'seed')),
  learned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, identity_type, identity_value)
);

CREATE INDEX IF NOT EXISTS idx_client_known_identities_lookup
  ON client_known_identities(identity_type, identity_value);

ALTER TABLE client_known_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No anon access to client_known_identities"
  ON client_known_identities FOR ALL TO anon USING (false);

-- 3. Meetings.
--
-- link_status state machine:
--   unlinked   — no candidate above the suggestion threshold; needs manual triage
--   suggested  — one or more candidates above suggestion threshold but below
--                auto-link; UI shows top 3 with one-click confirm
--   linked     — single confident match (auto, manual, or backfill)
--   internal   — only RL-team attendees; not a client meeting
--   prospect   — external attendee but no client match (likely a sales call
--                with someone who isn't a client yet — keep so we can backfill
--                if they later sign on)
--
-- meeting_type derived from recorded_by_team + title patterns:
--   sales      — recorded_by_team = 'Sales Rocketleads'
--   kick_off   — Delivery team + title pattern (kick-off / kickoff / start)
--   evaluation — Delivery team + title pattern (evaluatie / evaluation / review)
--   internal   — only RL attendees
--   other      — Delivery team + no pattern match
CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fathom_recording_id text NOT NULL UNIQUE,
  client_id text REFERENCES clients(monday_item_id) ON DELETE SET NULL,
  meeting_type text
    CHECK (meeting_type IN ('sales', 'kick_off', 'evaluation', 'internal', 'other')),
  link_status text NOT NULL DEFAULT 'unlinked'
    CHECK (link_status IN ('linked', 'suggested', 'unlinked', 'internal', 'prospect')),
  link_method text
    CHECK (link_method IN ('auto', 'manual', 'backfill')),
  match_score real,
  match_candidates jsonb,                              -- [{ client_id, score, reasons[] }]

  title text,
  scheduled_at timestamptz,
  duration_sec integer,
  recording_url text,
  share_url text,

  recorded_by_email text,
  recorded_by_name text,
  recorded_by_team text,                               -- 'Sales Rocketleads' / 'Delivery Rocketleads' / etc.

  attendees jsonb,                                     -- [{ name, email, is_external }]

  summary text,
  action_items jsonb,                                  -- [{ description, completed, assignee_email, user_generated, task_id }]
  transcript text,

  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  linked_at timestamptz,
  linked_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_meetings_client
  ON meetings(client_id, scheduled_at DESC) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_link_status
  ON meetings(link_status, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_type
  ON meetings(meeting_type, scheduled_at DESC) WHERE meeting_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_recorded_by
  ON meetings(recorded_by_email) WHERE recorded_by_email IS NOT NULL;

CREATE TRIGGER meetings_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No anon access to meetings"
  ON meetings FOR ALL TO anon USING (false);
