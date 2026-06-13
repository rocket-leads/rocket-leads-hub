-- Dual feedback loop for Pedro creative iteration learning.
--
-- Roy 2026-06-13. Tot nu toe was alle CM-feedback strikt per-klant
-- gescoped: één row → één client. Dat dekt brand-specifieke voorkeuren
-- ("logo's altijd klein voor Zumex") maar mist generieke craft-lessen
-- die voor ALLE klanten gelden ("geen doorstreping op tekst",
-- "subjects groter in beeld", "geen glow op letters").
--
-- Twee feedback loops nu:
--   - scope='client' → STRICT per-klant. Pedro mag deze NOOIT meer
--     missen op deze specifieke klant. Brand/taste/audience preferences.
--   - scope='global' → ADVISORY voor alle klanten. Generieke craft tips
--     waar Pedro per-generatie zelf beslist of het past in de context.
--   - scope='both'   → Per-klant strict EN tegelijk in de global pool —
--     begon als klant-specifieke klacht maar het onderliggende principe
--     geldt breder.
--
-- Classifier draait bij INSERT (Haiku 4.5) zodat de scope direct op de
-- row staat. Bij generatie pullen we twee aparte blokken (per-klant
-- strict + global advisory) met verschillende prompt-framing.

ALTER TABLE pedro_creative_feedback
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'client'
    CHECK (scope IN ('client', 'global', 'both'));

ALTER TABLE pedro_creative_feedback
  ADD COLUMN IF NOT EXISTS scope_rationale text;

-- Het classifier-veld (waarom de classifier deze scope koos) helpt de
-- CM later te begrijpen waarom een rule globaal is geworden, en geeft
-- ons audit-trail om classifications te reviewen / overrulen.

-- Global pool access pattern: pull recent N globally-applicable rules,
-- dedupe op text-similarity downstream. Index alleen waar 'global'/'both'
-- staan; client-scoped rows hebben de bestaande
-- idx_pedro_creative_feedback_client_recent.
CREATE INDEX IF NOT EXISTS idx_pedro_creative_feedback_global_recent
  ON pedro_creative_feedback (created_at DESC)
  WHERE scope IN ('global', 'both');

COMMENT ON COLUMN pedro_creative_feedback.scope IS
  'Dual feedback loop scope. client = strict per-klant; global = advisory voor alle klanten; both = per-klant strict EN in global pool. Roy 2026-06-13.';

COMMENT ON COLUMN pedro_creative_feedback.scope_rationale IS
  'Classifier rationale (1 zin) waarom deze scope is gekozen. Audit-trail + UI hint voor de CM.';

NOTIFY pgrst, 'reload schema';
