-- Cache van vision-analyses van Drive-foto's die Pedro als reference
-- gebruikt voor image generation.
--
-- Voor elke Drive-foto die als kandidaat uit `getFolderImages()` komt
-- doen we ÉÉN keer een Claude Haiku vision call: 1-2 zinnen die
-- beschrijven wat er in de foto staat (onderwerp, setting, evt. tekst).
-- Daarna gebruiken we die beschrijving om — per refresh, text-only —
-- te scoren hoe relevant de foto is voor de huidige variant's angle.
--
-- Roy 2026-06-10: zonder dit pakt Gemini willekeurig de 2 hoogst-
-- gescorede foto's uit de juiste folder, maar binnen die folder zit
-- vaak ook irrelevant materiaal (lege showroom, screenshots, oude
-- materialen). Vision-rerank laat Pedro "zelf nadenken" — kiest foto's
-- waarin het product/onderwerp van de variant herkenbaar is.
--
-- Cache TTL: feitelijk geen. Drive file id's zijn stabiel en de inhoud
-- van een foto verandert niet — re-analyseren we alleen als we de
-- model versie bumpen.

CREATE TABLE IF NOT EXISTS pedro_drive_photo_vision (
  -- Drive file id is uniek + stabiel — primary key.
  file_id text PRIMARY KEY,

  -- Welke client deze foto bij hoort. Niet kritiek maar handig voor
  -- bulk-delete bij offboard. Nullable: een service-account-gedeelde
  -- folder kan tot meerdere klanten behoren.
  client_id text,

  -- De filename op moment van analyse — voor debugging als Pedro een
  -- rare keuze maakt.
  file_name text NOT NULL,

  -- 1-2 zinnen Engels die beschrijven wat in de foto staat. Genoeg om
  -- text-only relevantie-scoring tegen variant context te draaien.
  visual_description text NOT NULL,

  analyzed_at timestamptz NOT NULL DEFAULT NOW(),
  model text NOT NULL,
  input_tokens integer,
  output_tokens integer
);

CREATE INDEX IF NOT EXISTS idx_pedro_drive_photo_vision_client
  ON pedro_drive_photo_vision (client_id);

CREATE INDEX IF NOT EXISTS idx_pedro_drive_photo_vision_age
  ON pedro_drive_photo_vision (analyzed_at);

COMMENT ON TABLE pedro_drive_photo_vision IS
  'Cache van per-Drive-foto vision-beschrijvingen (Claude Haiku). Eenmaal per file_id; geen TTL. Powers de relevance-rerank van Drive-foto kandidaten in pedro generate-image route.';

NOTIFY pgrst, 'reload schema';
