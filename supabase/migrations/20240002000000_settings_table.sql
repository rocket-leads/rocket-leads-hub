CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No anon access to settings" ON settings FOR ALL TO anon USING (false);

CREATE TRIGGER settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed default board config
INSERT INTO settings (key, value) VALUES
('board_config', '{
  "onboarding_board_id": "1316567475",
  "current_board_id": "1626272350",
  "onboarding_columns": {
    "client_board_id": "text_mm1vbb2h",
    "kick_off_date": "datum",
    "meta_ad_account_id": "text_mm1vdkqg",
    "stripe_customer_id": "text_mm1vy1bh",
    "trengo_contact_id": "text_mm1vtaxg",
    "account_manager": "mensen8",
    "campaign_manager": "person",
    "first_name": "text7",
    "ad_budget": "numeric_mm1vfk40",
    "contact_direction": "text6",
    "contact_channel": "status_11",
    "campaign_status": "status"
  },
  "current_columns": {
    "client_board_id": "text_mm1vajgv",
    "country": "color3",
    "meta_ad_account_id": "text_mm1vqpb",
    "stripe_customer_id": "text_mm1v2pte",
    "trengo_contact_id": "text_mm1vgtdy",
    "account_manager": "dup__of_ad_manager",
    "campaign_manager": "person",
    "first_name": "tekst74",
    "ad_budget": "numeric_mm1vdpd1",
    "contact_direction": "tekst7",
    "contact_channel": "status_17",
    "campaign_status": "color5"
  },
  "client_board_columns": {
    "date_created": "date4",
    "date_appointment": "dup__of_date_created__1",
    "lead_status": "dup__of_status__1",
    "lead_status_2": "dup__of_status6__1",
    "deal_value": "omzet__1",
    "utm": "text9__1",
    "date_deal": "date_mm1vgcfx",
    "taken_call_status_value": "Afspraak"
  }
}')
ON CONFLICT (key) DO NOTHING;
