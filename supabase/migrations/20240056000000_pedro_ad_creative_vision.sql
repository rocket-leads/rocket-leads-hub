-- Cache van vision-analyses van Meta ad creatives.
--
-- Voor elke ad die Pedro tegenkomt in een creative-refresh (winners +
-- top losers) doen we ÉÉN keer een Claude Haiku vision call op de ad's
-- thumbnail. Resultaat: een 100-200 woord descriptie van wat er
-- visueel gebeurt — products, people, setting, on-image tekst, mood,
-- color palette, brand cues. Wordt geïnjecteerd in de creative-refresh
-- prompt zodat Pedro weet WAAROM een ad won (visueel + copy) en kan
-- iteraten in echte DNA.
--
-- Roy 2026-06-09: zonder dit ziet Pedro alleen de ad-naam ("Tosti's")
-- + getallen en verzint hij de context. Met deze cache leest hij de
-- werkelijke visual identity van de winners.
--
-- Cache TTL: feitelijk geen — een ad-creative verandert niet. We
-- regenereren alleen als de cron `analyzed_at` is van vóór de
-- huidige model versie (kolom `model` houdt bij welke Haiku-versie
-- het analyseerde). Dat laat ons later in één keer de hele cache
-- invalidaten door de model-versie te bumpen.

CREATE TABLE IF NOT EXISTS pedro_ad_creative_vision (
  -- Meta ad id is uniek + stabiel — primary key. Geen surrogate UUID
  -- nodig, dit is een caching tabel.
  ad_id text PRIMARY KEY,

  -- Welke client de ad bij hoort. Niet kritiek (ad_id is wereldwijd
  -- uniek) maar handig voor "wis alle vision-cache van klant X bij
  -- offboard".
  client_id text,

  -- De thumbnail-URL die we hebben geanalyseerd. Wijzigt Meta de
  -- thumbnail (bv. ad-creative redirect), dan kunnen we per cache-row
  -- detecteren of we opnieuw moeten draaien.
  thumbnail_url text,

  -- De vision output zelf. 100-300 woorden, Engels, beschrijft visueel
  -- + on-image tekst + sfeer.
  visual_description text NOT NULL,

  -- Audit
  analyzed_at timestamptz NOT NULL DEFAULT NOW(),
  model text NOT NULL,
  -- Token usage voor cost-tracking (nullable voor backfills).
  input_tokens integer,
  output_tokens integer
);

-- Per-client lookup en bulk-delete bij offboard.
CREATE INDEX IF NOT EXISTS idx_pedro_ad_creative_vision_client
  ON pedro_ad_creative_vision (client_id);

-- Stale-detection: vind rows die ouder zijn dan een drempel (bv. ouder
-- dan 90d) zodat we ze in een cron kunnen verversen als we vermoeden
-- dat de visual is veranderd.
CREATE INDEX IF NOT EXISTS idx_pedro_ad_creative_vision_age
  ON pedro_ad_creative_vision (analyzed_at);

COMMENT ON TABLE pedro_ad_creative_vision IS
  'Cache van per-ad vision analyses (Claude Haiku). Eenmaal per ad_id; geen TTL want creatives veranderen vrijwel nooit. Powers de "ground-truth" sectie van de creative-refresh prompt.';

NOTIFY pgrst, 'reload schema';
