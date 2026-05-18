-- Weekly client-update audit + freshness signal.
--
-- We want two things in the clients table:
--   1. "Last updated" timestamp so the All Clients page can sort by it AND
--      render a small "Laatste update: 15 mei" caption under the Update
--      column on each row.
--   2. "Updated today" guard so the button visibly flips to a green
--      confirmation state and prevents accidental double-sends within the
--      same day.
--
-- A dedicated `client_updates` log table (one row per send) keeps the door
-- open for future "first updated" sorts, per-AM audit, and a history view.
-- The latest send timestamp also gets mirrored onto `clients.last_client_update_at`
-- so the list queries don't need an aggregate every page load.

CREATE TABLE IF NOT EXISTS client_updates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- First N chars of the sent message — surfaced in audit / history without
  -- bloating the row with multi-page WhatsApp messages. Full message lives
  -- in `inbox_events` via the existing reply pipeline; this is just a hint.
  message_preview TEXT,
  -- Trengo template + outbound IDs for traceability when a client asks
  -- "did you send my update yesterday?".
  template_name TEXT,
  trengo_message_id TEXT
);

CREATE INDEX IF NOT EXISTS client_updates_client_sent_idx
  ON client_updates (client_id, sent_at DESC);

ALTER TABLE client_updates ENABLE ROW LEVEL SECURITY;

-- Service-role-only access (matches the rest of the schema — the Hub talks
-- to Supabase via the admin client, never via anon). No anon policy needed.

-- Cached "most recent send" on clients for cheap sort + render.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS last_client_update_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS clients_last_client_update_at_idx
  ON clients (last_client_update_at DESC NULLS LAST);
