-- Users & rollen
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT CHECK (role IN ('admin', 'member', 'guest')) DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed admin users
INSERT INTO users (email, name, role) VALUES
  ('rocketleadsnl@gmail.com', 'Roy', 'admin'),
  ('rocketleadshq@gmail.com', 'HQ', 'admin')
ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role;

-- Klant-koppelingen (cached + extra data)
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monday_item_id TEXT UNIQUE NOT NULL,
  monday_board_type TEXT CHECK (monday_board_type IN ('onboarding', 'current')) NOT NULL,
  monday_client_board_id TEXT,
  name TEXT NOT NULL,
  meta_ad_account_id TEXT,
  stripe_customer_id TEXT,
  trengo_contact_ids TEXT[],
  column_mapping_override JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campagne selectie per klant
CREATE TABLE IF NOT EXISTS client_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  meta_campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  is_selected BOOLEAN DEFAULT false,
  UNIQUE(client_id, meta_campaign_id)
);

-- Toegangscontrole per klant per user
CREATE TABLE IF NOT EXISTS client_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  can_view_campaigns BOOLEAN DEFAULT true,
  can_view_billing BOOLEAN DEFAULT true,
  can_view_communication BOOLEAN DEFAULT true,
  UNIQUE(user_id, client_id)
);

-- API tokens (encrypted opslaan)
CREATE TABLE IF NOT EXISTS api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT UNIQUE NOT NULL,
  token_encrypted TEXT NOT NULL,
  last_verified TIMESTAMPTZ,
  is_valid BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Updated_at trigger voor clients
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER api_tokens_updated_at
  BEFORE UPDATE ON api_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;

-- RLS policies: service role bypasses RLS (server-side admin client)
-- Voor de anon key (client-side) is alles geblokkeerd — we doen alle queries server-side
CREATE POLICY "No anon access to users" ON users FOR ALL TO anon USING (false);
CREATE POLICY "No anon access to clients" ON clients FOR ALL TO anon USING (false);
CREATE POLICY "No anon access to client_campaigns" ON client_campaigns FOR ALL TO anon USING (false);
CREATE POLICY "No anon access to client_access" ON client_access FOR ALL TO anon USING (false);
CREATE POLICY "No anon access to api_tokens" ON api_tokens FOR ALL TO anon USING (false);
