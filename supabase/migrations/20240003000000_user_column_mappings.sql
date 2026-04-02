-- Map Monday.com people column values to hub users
-- This enables per-user client filtering: users only see clients assigned to them
CREATE TABLE IF NOT EXISTS user_column_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  monday_column_role TEXT NOT NULL,       -- e.g. 'account_manager', 'campaign_manager'
  monday_person_name TEXT NOT NULL,       -- the display name from Monday people column
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, monday_column_role)
);

ALTER TABLE user_column_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No anon access to user_column_mappings" ON user_column_mappings FOR ALL TO anon USING (false);
