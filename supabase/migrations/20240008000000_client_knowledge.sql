-- Add Google Drive folder ID to clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS google_drive_folder_id TEXT;

-- Client knowledge base: cached content from Google Drive + Monday updates
CREATE TABLE IF NOT EXISTS client_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('google_drive', 'monday_updates')),
  source_id TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  mime_type TEXT,
  content_hash TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_knowledge_client_id ON client_knowledge (client_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_knowledge_source_unique
  ON client_knowledge (client_id, source, source_id);

ALTER TABLE client_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No anon access to client_knowledge" ON client_knowledge FOR ALL TO anon USING (false);
