-- Per-client feedback log voor Pedro's image-generation iteraties.
--
-- Roy 2026-06-10. Doel: elke CM-iteratie op een gegenereerde creative
-- (prompt edit, expliciete feedback, regen na ontevredenheid) opslaan
-- als ground-truth voor de volgende refresh. Pedro injecteert de
-- recente feedback in de creative-refresh prompt zodat hij voor DEZE
-- klant leert wat wel en niet werkt — minder credits per iteratie naar
-- de gewenste output, betere first-shot kwaliteit over tijd.
--
-- Voorbeeld feedback dat Pedro moet onthouden:
--   - "Logo's altijd klein"
--   - "Headlines moeten een pijnpunt-vraag uit doelgroep zijn"
--   - "Klant haat stock-foto's met te witte tanden"
--   - "Altijd minimaal één persoon in beeld"
--
-- Niet alle iteraties zijn even sterk signaal:
--   - explicit:   CM heeft expliciet feedback ingevuld (sterkste signaal)
--   - prompt_edit: CM heeft de image_prompt aangepast (impliciet signaal
--                  — diff laat zien wat ze wilden anders)
--   - regen:      CM heeft simpelweg op regen geklikt (zwakste signaal,
--                  meestal "probeer nog eens" zonder richting)
--
-- Recente feedback (laatste 90d) weegt het zwaarst. Older entries
-- blijven in de tabel voor analytics maar krijgen lagere weight in
-- prompt-injectie.

CREATE TABLE IF NOT EXISTS pedro_creative_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Per-klant scope. Pedro pulls feedback PER client_id; never cross-
  -- client (a Zumex preference is not a Blendtec preference).
  client_id text NOT NULL,

  -- Optional refs back to the specific variant/image that triggered
  -- this feedback. Nullable for global per-client preferences entered
  -- ad-hoc (e.g. via Settings).
  variant_id uuid,
  variant_image_position integer,
  refresh_id uuid,

  -- Type of feedback signal — drives prompt-injection weight.
  feedback_type text NOT NULL CHECK (feedback_type IN ('explicit', 'prompt_edit', 'regen', 'upload')),

  -- The actual feedback text. For 'explicit' this is CM's own words.
  -- For 'prompt_edit' this is the diff summary or just the new prompt
  -- snippet. For 'upload' it's "CM uploaded their own — AI miss".
  feedback_text text NOT NULL,

  -- Optional: which CM gave the feedback. Helps later for per-CM
  -- tone learning (some CMs like more flowery prompts than others).
  created_by_email text,

  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Primary access pattern: load N most recent for a client.
CREATE INDEX IF NOT EXISTS idx_pedro_creative_feedback_client_recent
  ON pedro_creative_feedback (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pedro_creative_feedback_variant
  ON pedro_creative_feedback (variant_id);

COMMENT ON TABLE pedro_creative_feedback IS
  'Per-client log van CM-iteraties op gegenereerde creatives. Pedro injecteert recente feedback in elke nieuwe creative-refresh prompt zodat hij leert wat deze klant wil. Roy 2026-06-10.';

NOTIFY pgrst, 'reload schema';
