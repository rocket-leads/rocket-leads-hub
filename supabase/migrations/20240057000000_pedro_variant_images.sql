-- Pedro variant image slots — 3 per variant ipv 1.
--
-- Reden (Roy 2026-06-09): bij elke generate-knop wil de CM meteen 3
-- ad creatives zien naast elkaar zodat hij kan kiezen welke het meest
-- passend is. Per-slot regen/upload/replace zodat hij twee goeie en
-- één slechte kan refreshen zonder de andere weg te gooien.
--
-- Design beslissingen:
--   - Nieuwe tabel ipv `pedro_variants.image_storage_paths jsonb`
--     omdat per-slot CASCADE-delete, per-slot WHERE-queries, en
--     per-slot UNIQUE-constraint allemaal pijnlijk in jsonb zijn.
--   - Position 0-9 toegestaan (default UI laat 3 zien, future-proof
--     voor "wil 5 of 10 varianten" zonder schema change).
--   - Backfill existing pedro_variants.image_* → position 0 zodat
--     niemand z'n bestaande images kwijt is.
--   - Oude image_* kolommen op pedro_variants blijven staan (read-only
--     legacy) voor backwards compat met code die er nog aan refereert.
--     Nieuwe writes gaan via deze tabel.

CREATE TABLE IF NOT EXISTS pedro_variant_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES pedro_variants(id) ON DELETE CASCADE,
  -- Slot positie. 0-9 zodat we ruimte hebben om later 5/10 slots aan
  -- te bieden zonder een nieuwe migration. UI rendert er nu 3.
  position integer NOT NULL CHECK (position >= 0 AND position <= 9),

  storage_path text,
  provider text CHECK (provider IN ('gemini', 'manual_upload')),
  model text,
  generated_at timestamptz,
  width integer,
  height integer,

  -- Eén row per (variant, slot). Re-generate doet UPSERT op deze key.
  UNIQUE (variant_id, position)
);

CREATE INDEX IF NOT EXISTS idx_pedro_variant_images_variant
  ON pedro_variant_images (variant_id, position);

-- Backfill: bestaande pedro_variants.image_storage_path wordt position 0
-- zodat geen enkele AM/CM z'n bestaande Pedro-werk kwijtraakt.
INSERT INTO pedro_variant_images (
  variant_id, position, storage_path, provider, model, generated_at, width, height
)
SELECT
  id, 0, image_storage_path, image_provider, image_model,
  image_generated_at, image_width, image_height
FROM pedro_variants
WHERE image_storage_path IS NOT NULL
ON CONFLICT (variant_id, position) DO NOTHING;

COMMENT ON TABLE pedro_variant_images IS
  'Per-slot images per Pedro variant. 3 slots standaard, max 10. Roy 2026-06-09.';

NOTIFY pgrst, 'reload schema';
