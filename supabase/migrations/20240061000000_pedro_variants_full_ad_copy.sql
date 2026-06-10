-- Pedro variant full ad-copy fields.
--
-- Roy 2026-06-10. Voor de Push-to-Meta flow heeft elke variant nu
-- méér nodig dan alleen hook + primary text + image. Meta verwacht:
--   - 3 headlines (kort, max ~27 char, pijnpunt-vragen) → dynamic creative
--   - 3 primary texts (60-80 woorden) → dynamic creative
--   - optionele link description (mag leeg blijven)
--
-- Pedro genereert nu meteen alles ineen, zodat de CM met één klik
-- een complete Meta ad set + ads kan launchen zonder nog handmatig in
-- Ads Manager te tunen.

ALTER TABLE pedro_variants
  ADD COLUMN IF NOT EXISTS headline text,
  ADD COLUMN IF NOT EXISTS alt_headlines jsonb,
  ADD COLUMN IF NOT EXISTS alt_primary_texts jsonb,
  ADD COLUMN IF NOT EXISTS link_description text;

COMMENT ON COLUMN pedro_variants.headline IS
  'Primaire Meta headline (≤27 char zichtbaar, ≤40 max). Pijnpunt-vraag uit doelgroep-perspectief. Roy 2026-06-10.';

COMMENT ON COLUMN pedro_variants.alt_headlines IS
  'Array van 2 extra headlines voor Meta asset_feed_spec dynamic creative. Format: ["…","…"].';

COMMENT ON COLUMN pedro_variants.alt_primary_texts IS
  'Array van 2 extra primary text varianten voor Meta dynamic creative. Format: ["…","…"].';

COMMENT ON COLUMN pedro_variants.link_description IS
  'Optionele Meta link description (~30 char). Mag leeg blijven — Roy 2026-06-10.';

NOTIFY pgrst, 'reload schema';
