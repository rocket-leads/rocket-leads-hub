-- Per-slot regenerate budget op pedro_variant_images.
--
-- Roy 2026-06-10: CM's blijven anders ongelimiteerd op "Regen" klikken
-- met "vind 'm niet mooi" feedback → veel Gemini credits, weinig
-- learning. Cap op 1× regen per slot dwingt CM om eerst gestructureerde
-- feedback te geven (image / text / design aspecten) vóór de regen-call.
--
-- Reset: regen_count blijft 0 op initial generate. Eerste regen → 1.
-- Daarna is de slot dichtgetimmerd; alleen Upload of nieuwe refresh
-- vervangen de afbeelding.

ALTER TABLE pedro_variant_images
  ADD COLUMN IF NOT EXISTS regen_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN pedro_variant_images.regen_count IS
  'Aantal keer dat de CM deze slot heeft geregenereerd na initial generate. Cap = 1; daarna blokt de generate-image route. Reset alleen bij een nieuwe refresh / Upload. Roy 2026-06-10.';

NOTIFY pgrst, 'reload schema';
