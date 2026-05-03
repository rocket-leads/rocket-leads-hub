-- Hub-canonical agreement per client. Replaces the Monday sub-item concept for
-- multi-campaign clients: one row per client (PK = clients.id), with the full
-- list of campaigns stored as JSONB. We keep it un-normalized on purpose —
-- agreements are read/written as a whole, never queried per campaign across
-- clients, and the JSON shape is expected to evolve as we learn what AMs need.
--
-- Campaign JSON shape (see src/lib/clients/agreement.ts for the source of
-- truth):
--   {
--     id: string                         -- nanoid for stable React keys
--     name: string                       -- e.g. "Hoofdcampagne", "Subsidies"
--     ad_budget: number                  -- € per month, manual split (NOT auto-divided)
--     platforms: ("meta"|"google"|"tiktok")[]
--     platform_fees: { meta?, google?, tiktok? }  -- € per platform, only counted when selected
--     follow_up: boolean                 -- is RL doing the lead follow-up
--     follow_up_fee: number              -- € per month, only counted when follow_up = true
--     notes: string
--   }

CREATE TABLE IF NOT EXISTS client_agreements (
  client_id UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  campaigns JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

CREATE TRIGGER client_agreements_updated_at
  BEFORE UPDATE ON client_agreements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE client_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No anon access to client_agreements"
  ON client_agreements FOR ALL TO anon USING (false);
