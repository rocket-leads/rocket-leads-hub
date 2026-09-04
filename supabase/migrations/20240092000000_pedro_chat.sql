-- Pedro chat assistant - conversational AI over the Hub's data.
--
-- Sibling to the existing Pedro creative-generation system (pedro_refreshes,
-- pedro_variants, ...). This one is a stateful multi-turn chat: the team asks
-- Pedro questions ("what's the CPL of client X", "where's the bottleneck to hit
-- our deal target this month", "what can you pull from Anel's sales calls") and
-- Pedro answers by calling read-only data tools server-side.
--
-- Two tables, ChatGPT-style:
--   pedro_chat_conversations - one row per saved conversation, scoped to a user.
--   pedro_chat_messages      - the turns within a conversation.

CREATE TABLE IF NOT EXISTS pedro_chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Short human-readable title, derived from the first user message. Nullable
  -- so a freshly-created empty conversation can exist before the first turn.
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Soft-delete: archived conversations drop out of the sidebar list but stay
  -- for audit. Never hard-delete so token/cost history survives.
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pedro_chat_conversations_user
  ON pedro_chat_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS pedro_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL
    REFERENCES pedro_chat_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  -- Which data tools ran to produce an assistant turn, for transparency +
  -- re-rendering the "Pedro looked up X" chips when a conversation is reopened.
  -- Shape: [{ name, input, ok, summary }]. Null on user turns.
  tool_calls jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Cost tracking (assistant turns only).
  prompt_tokens integer,
  completion_tokens integer
);

CREATE INDEX IF NOT EXISTS idx_pedro_chat_messages_conversation
  ON pedro_chat_messages (conversation_id, created_at);

ALTER TABLE pedro_chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedro_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No anon access to pedro_chat_conversations"
  ON pedro_chat_conversations FOR ALL TO anon USING (false);
CREATE POLICY "No anon access to pedro_chat_messages"
  ON pedro_chat_messages FOR ALL TO anon USING (false);

COMMENT ON TABLE pedro_chat_conversations IS 'Pedro chat assistant conversations, one per user thread. Sibling to pedro_refreshes (creative gen).';
COMMENT ON TABLE pedro_chat_messages IS 'Turns within a Pedro chat conversation. tool_calls jsonb records which read-only data tools ran per assistant turn.';

NOTIFY pgrst, 'reload schema';
