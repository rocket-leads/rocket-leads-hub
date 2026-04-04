-- Per-client KPI target overrides (partial — merged with global defaults at runtime)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_overrides JSONB;
