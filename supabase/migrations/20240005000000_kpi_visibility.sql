-- Per-client KPI section visibility (replaces monday_active boolean)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS kpi_visibility JSONB;
NOTIFY pgrst, 'reload schema';
