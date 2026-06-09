-- Meta push support — schema changes for "Push to Meta" feature.
--
-- Twee onderdelen:
--   1. clients.facebook_page_id — Meta vereist een Page id voor elke
--      AdCreative. Voorheen niet opgeslagen; per-klant veld want
--      RL klanten gebruiken hun eigen Facebook page.
--   2. pedro_variant_images.meta_* — per-slot tracking welke variant-
--      slot al naar Meta is gepushed, met welke ad/ad_set id. Sync
--      cron leest hier later van om de learning loop te sluiten.
--
-- Roy 2026-06-09: "Push to Meta" workflow per proposal: variant × slot
-- multi-select, nieuwe ad set in zelfde campagne als winner, PAUSED
-- status.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS facebook_page_id text;

COMMENT ON COLUMN clients.facebook_page_id IS
  'Facebook Page id (numeric, ~16 digits) waaronder ads worden gepost. Vereist voor Push to Meta.';

-- Per-slot Meta launch tracking. Eén slot kan max één Meta ad
-- worden — die ad heeft een ad_id + ad_set_id na launch.
ALTER TABLE pedro_variant_images
  ADD COLUMN IF NOT EXISTS meta_ad_id text,
  ADD COLUMN IF NOT EXISTS meta_ad_set_id text,
  ADD COLUMN IF NOT EXISTS meta_ad_launched_at timestamptz,
  ADD COLUMN IF NOT EXISTS meta_launch_error text,
  -- Append-suffix bij multi-slot ship om name collisions te vermijden.
  -- Voorbeeld: bij ship van slot A + slot C krijgen ze fresh numbers
  -- (Photo 7 | X, Photo 8 | X) — sequence draait per launch op basis
  -- van max(existing) + 1. Dit veld bewaart de gegenereerde naam zodat
  -- de sync cron op exact-match kan joinen.
  ADD COLUMN IF NOT EXISTS meta_ad_name text;

CREATE INDEX IF NOT EXISTS idx_pedro_variant_images_meta_ad
  ON pedro_variant_images (meta_ad_id)
  WHERE meta_ad_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pedro_variant_images_meta_name
  ON pedro_variant_images (meta_ad_name)
  WHERE meta_ad_name IS NOT NULL;

NOTIFY pgrst, 'reload schema';
