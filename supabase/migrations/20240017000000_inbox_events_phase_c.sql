-- Phase C.1: rename inbox_items → inbox_events + add chat-substrate columns
-- + create user_platform_tokens (for replies-as-self via per-user platform creds).
--
-- Why rename: the table now stores three things — discrete updates, discrete
-- tasks, AND chat messages from Trengo / Slack / Monday ingest. "Items" no
-- longer captures the chat-stream nature; "events" does.
--
-- New columns are all nullable so existing rows (manual + automation) keep
-- working unchanged. Webhook ingestion (C.2 onwards) populates the new fields.

-- 1. Rename core table.
ALTER TABLE inbox_items RENAME TO inbox_events;

-- 2. Rename indexes for consistency.
ALTER INDEX IF EXISTS idx_inbox_items_assignee RENAME TO idx_inbox_events_assignee;
ALTER INDEX IF EXISTS idx_inbox_items_author RENAME TO idx_inbox_events_author;
ALTER INDEX IF EXISTS idx_inbox_items_client RENAME TO idx_inbox_events_client;
ALTER INDEX IF EXISTS idx_inbox_items_kind_status RENAME TO idx_inbox_events_kind_status;

-- 3. Rename trigger to match the new table name.
DROP TRIGGER IF EXISTS inbox_items_updated_at ON inbox_events;
CREATE TRIGGER inbox_events_updated_at
  BEFORE UPDATE ON inbox_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 4. Refresh RLS policy name.
DROP POLICY IF EXISTS "No anon access to inbox_items" ON inbox_events;
CREATE POLICY "No anon access to inbox_events" ON inbox_events FOR ALL TO anon USING (false);

-- 5. Extend `kind` so chat messages from Trengo / Slack can land in this table
--    without inventing a parallel concept. Existing 'update' / 'task' keep
--    their meaning; 'chat' is a new ambient class for messages that aren't
--    explicit action items but live in a conversation thread.
ALTER TABLE inbox_events DROP CONSTRAINT IF EXISTS inbox_items_kind_check;
ALTER TABLE inbox_events ADD CONSTRAINT inbox_events_kind_check
  CHECK (kind IN ('update', 'task', 'chat'));

-- 6. New columns. All nullable — they're only populated for events ingested
--    from external platforms (Trengo / Slack / Monday). Hand-typed inbox items
--    stay shaped exactly like before.
ALTER TABLE inbox_events
  ADD COLUMN IF NOT EXISTS source_thread text,
  ADD COLUMN IF NOT EXISTS source_msg_id text,
  ADD COLUMN IF NOT EXISTS thread_key text,
  ADD COLUMN IF NOT EXISTS scope text,
  ADD COLUMN IF NOT EXISTS author_kind text,
  ADD COLUMN IF NOT EXISTS author_external text,
  ADD COLUMN IF NOT EXISTS author_name_cached text,
  ADD COLUMN IF NOT EXISTS attachments jsonb,
  ADD COLUMN IF NOT EXISTS classify_conf real,
  ADD COLUMN IF NOT EXISTS classify_method text,
  ADD COLUMN IF NOT EXISTS created_at_src timestamptz,
  ADD COLUMN IF NOT EXISTS raw jsonb;

ALTER TABLE inbox_events
  ADD CONSTRAINT inbox_events_scope_check
  CHECK (scope IS NULL OR scope IN ('external', 'internal'));

ALTER TABLE inbox_events
  ADD CONSTRAINT inbox_events_author_kind_check
  CHECK (author_kind IS NULL OR author_kind IN ('rl_team', 'client', 'external'));

ALTER TABLE inbox_events
  ADD CONSTRAINT inbox_events_classify_method_check
  CHECK (classify_method IS NULL OR classify_method IN ('ai', 'manual'));

-- 7. Index for chat-substrate grouping (Team Inbox / Client Inbox tabs read
--    events by thread_key + recency).
CREATE INDEX IF NOT EXISTS idx_inbox_events_thread
  ON inbox_events(thread_key, created_at DESC)
  WHERE thread_key IS NOT NULL;

-- 8. Index for webhook-ingest dedupe — incoming webhooks check
--    (source, source_msg_id) before inserting to avoid double-storing the
--    same Trengo message id / Slack ts.
CREATE INDEX IF NOT EXISTS idx_inbox_events_source_msg
  ON inbox_events(source, source_msg_id)
  WHERE source_msg_id IS NOT NULL;

-- 9. Per-user platform tokens. Powers reply-as-self: each Hub user connects
--    their personal Slack (OAuth) / Trengo (API key) / Monday (API key) so
--    replies sent through the Hub appear from them, not from the system bot.
--    Tokens are encrypted with the same AES-256-GCM scheme as the existing
--    api_tokens table.
CREATE TABLE IF NOT EXISTS user_platform_tokens (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('slack', 'trengo', 'monday')),
  token_enc text NOT NULL,
  meta jsonb,                          -- e.g. slack team id + scopes; trengo agent name
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, platform)
);

CREATE TRIGGER user_platform_tokens_updated_at
  BEFORE UPDATE ON user_platform_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE user_platform_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No anon access to user_platform_tokens"
  ON user_platform_tokens FOR ALL TO anon USING (false);
