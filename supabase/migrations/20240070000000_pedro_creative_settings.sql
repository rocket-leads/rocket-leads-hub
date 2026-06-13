-- Per-client Pedro creative settings — the dials a CM can tweak per
-- klant on the Pedro Optimize wizard (aspect ratio, AI intensity, slot
-- styles, inspiration-subfolder scope, brand-color injection toggle,
-- brand book Drive ref). Saved per Monday client id so Pedro reads
-- "what should I generate for THIS klant" instead of always falling
-- back to hardcoded defaults.
--
-- jsonb (not separate columns) so future dials land without migrations.
-- Shape (everything optional — null = inherit hardcoded default):
--   {
--     aspectRatio: "4:5"|"1:1"|"9:16"|"16:9",
--     aiIntensity: 0-100,             // 0 = original photo, 100 = fully AI-edited
--     variantsPerRefresh: 1-10,
--     slotStyleDefaults: { "0": SlotStyle, "1": SlotStyle, "2": SlotStyle },
--     inspirationSubfolders: {
--       client_content: bool, client_content_ai: bool,
--       ai_content: bool, ai_animation: bool, stock_content: bool,
--     },
--     brandColorInjection: bool,
--     brandColorIntensity: 0-100,
--     brandBookDriveFileId: string|null,    // Drive file id of brand book PDF
--     brandBookSource: "drive_auto"|"drive_picked"|"upload"|"website_fallback",
--   }
--
-- Roy 2026-06-13. Companion to pedro_drive_folder_prefs (folder-level
-- whitelist) and brand_style (auto-extracted colors/fonts).

ALTER TABLE pedro_client_state
  ADD COLUMN IF NOT EXISTS creative_settings jsonb;

COMMENT ON COLUMN pedro_client_state.creative_settings IS
  'Per-klant Pedro creative dials. Null = inherit defaults. See migration 20240070 header for shape. Roy 2026-06-13.';

NOTIFY pgrst, 'reload schema';
