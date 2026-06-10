-- Per-client image source preferences voor Pedro's image generation.
--
-- Twee dingen:
--   1. `pedro_drive_folder_prefs` — per (client_id, folder_id) een
--      enabled flag. Bestaat een rij met enabled=false → BFS skipt
--      die hele subtree, óók de Haiku vision rerank. Geen API kosten
--      meer aan irrelevante folders zoals 'QualityFree' onder de
--      "Juice Concepts Benelux" umbrella van Zumex.
--   2. `pedro_client_state.image_source_prefs jsonb` — high-level
--      toggles per klant. v1: `{ useStock: boolean }`. Later: stock
--      keyword override, watermerk-vereisten, etc.
--
-- Roy 2026-06-10. Voorwaarde: keuzeproces gebeurt VOOR de Genereer-
-- klik zodat we geen Gemini/Haiku kosten maken aan verkeerde bronnen.

CREATE TABLE IF NOT EXISTS pedro_drive_folder_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Hub client (Monday item id).
  client_id text NOT NULL,

  -- Drive folder id — stable across renames.
  folder_id text NOT NULL,

  -- Cached folder name at moment van laatste update. UI gebruikt dit
  -- als display label; de echte source-of-truth is Drive zelf.
  folder_name text NOT NULL,

  -- Volledig pad ("Zumex / Photos / Showroom") voor disambiguatie in
  -- de picker UI wanneer twee folders dezelfde naam hebben. Best
  -- effort — nullable als enumeration faalt.
  folder_path text,

  -- false = hard skip subtree. true = include in BFS auto-scoring.
  -- Default true; we slaan alleen rijen op wanneer CM expliciet
  -- iets aan/uit zet, om de tabel klein te houden.
  enabled boolean NOT NULL DEFAULT true,

  updated_at timestamptz NOT NULL DEFAULT NOW(),
  updated_by_email text,

  UNIQUE (client_id, folder_id)
);

CREATE INDEX IF NOT EXISTS idx_pedro_drive_folder_prefs_client
  ON pedro_drive_folder_prefs (client_id);

COMMENT ON TABLE pedro_drive_folder_prefs IS
  'Per-klant Drive folder whitelist. enabled=false → hele subtree wordt door BFS overgeslagen, geen vision-calls op die foto''s. Roy 2026-06-10.';

-- High-level image source toggles per klant. v1: alleen useStock.
-- Bewust een jsonb kolom ipv aparte kolommen zodat we toekomstige
-- toggles (watermark, alleen brand-pure, etc.) zonder migration kunnen
-- toevoegen.
ALTER TABLE pedro_client_state
  ADD COLUMN IF NOT EXISTS image_source_prefs jsonb;

COMMENT ON COLUMN pedro_client_state.image_source_prefs IS
  'High-level toggles voor Pedro image sources. Shape: { useStock: boolean, ... }. Roy 2026-06-10.';

NOTIFY pgrst, 'reload schema';
