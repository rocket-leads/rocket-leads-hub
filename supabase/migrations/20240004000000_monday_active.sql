-- Add monday_active toggle per client (default false)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS monday_active BOOLEAN DEFAULT false;
NOTIFY pgrst, 'reload schema';
