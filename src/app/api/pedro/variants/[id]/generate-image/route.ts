import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import {
  generateImageWithReference,
  fetchReferenceImage,
  DEFAULT_IMAGE_MODEL,
} from "@/lib/integrations/gemini"
import { uploadVariantImage, getVariantImageSignedUrl } from "@/lib/integrations/pedro-image-storage"
import { getFolderImages, type DriveImageRef } from "@/lib/integrations/google-drive"
import { rerankDrivePhotos } from "@/lib/pedro/drive-photo-vision"
import {
  findBrandAssetsInDrive,
  brandAssetsPromptBlock,
  type BrandAsset,
} from "@/lib/pedro/drive-brand-assets"
import { extractColorsFromBrandPdf } from "@/lib/pedro/brand-vision"
import { downloadDriveFileBytes } from "@/lib/integrations/google-drive"
import { searchPexelsPhotos, deriveStockQueries } from "@/lib/integrations/pexels"
import { resolveVisualStylePolicy } from "@/lib/pedro/visual-style-policy"
import { fetchInspirationRefForStyle } from "@/lib/pedro/visual-reference-library"
import {
  resolveEffectiveSettings,
  sanitiseCreativeSettings,
  type InspirationSubfolderFlags,
  type VisualStyleKey,
  type LightingStyleKey,
  type CompositionDensityKey,
} from "@/lib/pedro/creative-settings"
import type { BrandStyle } from "@/lib/pedro/helpers"

/**
 * POST /api/pedro/variants/[id]/generate-image
 *  body: { promptOverride?: string }
 *
 * Generates an image for one variant via Gemini Nano Banana Pro using
 * the winning ad's thumbnail as a reference + the variant's
 * `image_prompt`. Stores the result in Supabase Storage and stamps the
 * variant row.
 *
 * Idempotent in spirit: re-running replaces the previous image (the
 * Storage helper cleans up the old path before writing the new one).
 * That matches the "regenereer" UX - clicking the button again should
 * give a fresh take, not append.
 *
 * Roy 2026-06-09.
 */

export const maxDuration = 60 // Gemini image gen routinely takes 5-20s; cap at 60 for safety

/**
 * Per-slot style direction. Roy 2026-06-12 v2: 5 categorieën die 1:1
 * mappen naar de AD CREATIVES INSPIRATION subfolders. De prompt
 * directives zijn nu LAYOUT-FIRST (waar dingen staan op het canvas)
 * ipv mood-only - dat sluit de 'kind in Canva vs 20-jaar designer'
 * gap die we eerder zagen.
 */
type SlotStyleKey =
  | "client_content"      // → Client content/         (folder)
  | "client_content_ai"   // → Client content + AI/    (folder)
  | "ai_content"          // → AI Content/             (folder) - composite branded
  | "ai_animation"        // → AI Animation/           (folder) - kinetic still
  | "stock_content"       // → Stock content/          (folder)

/** Default mix wanneer de CM niets stuurt - 3 verschillende richtingen
 *  zodat hij in één blik kan vergelijken: enhanced klant-foto, fully
 *  composite branded, kinetic AI still. */
const DEFAULT_SLOT_STYLES: Record<number, SlotStyleKey> = {
  0: "client_content_ai",
  1: "ai_content",
  2: "ai_animation",
}

function styleDirective(style: SlotStyleKey, brandHex: string[] | null): string {
  const accent = brandHex && brandHex.length > 0 ? brandHex.slice(0, 3).join(", ") : "the brand's accent colors"
  const primary = brandHex && brandHex.length > 0 ? brandHex[0] : "deep navy or brand-primary"
  switch (style) {
    case "client_content":
      return `\n\nSLOT STYLE: CLIENT CONTENT (authentic photography, minimal AI).
- Use the client photo references AS-IS. Light color grade for cohesion only.
- Authentic, professional, unposed photography. Magazine documentary feel.
- NO composite overlays, NO graphic chrome, NO color panels.
- Headline floats cleanly in upper-left negative space, single weight, white or accent (${accent}). No decoration.
QUALITY BAR: Time magazine portrait. National Geographic editorial. Veteran photographer, not stock.`

    case "client_content_ai":
      return `\n\nSLOT STYLE: CLIENT CONTENT + AI (real subject, enhanced atmosphere).
LAYOUT:
- Subject from the client photo references occupies the right-center of the canvas.
- Headline lives in the upper-left negative space, in white or accent (${accent}), single sans-serif typeface.
- Optional thin accent-color line/curve behind the subject (single element, not a panel).
ATMOSPHERE:
- Atmospheric brand-color lighting (${accent}) - rim lighting on the subject, ambient color cast in the background.
- Shallow depth-of-field. Subtle environmental haze or soft motion blur in the accent color for depth.
- Subject identity is locked to the references; only the scene atmosphere changes.
QUALITY BAR: editorial brand photography with light retouching. Veteran retoucher, not stock-with-filter.`

    case "ai_content":
      return `\n\nSLOT STYLE: AI CONTENT (full composite ad, marketing-agency deliverable).

LAYOUT (60/40 split, mandatory):
- LEFT 60%: dark brand-primary panel using ${primary} as the base color.
  - The exact Dutch headline lives here, in mixed weight: most words white/light, the key 1-2 BRAND words in accent color (${accent}).
  - Strong typographic hierarchy: large headline (taking ~60% of panel vertical space), optional thin sub-headline below.
  - Padding ≥8% on every side of the headline.
  - If the variant headline contains a CTA word (Bekijk / Vraag aan / Plan / Ontdek / Start), render a pill-shaped CTA button bottom-left of the panel using the accent color (${accent}) with white text. Keep the button compact (~22% panel width).
- RIGHT 40%: photographic subject from the references. Composite with rim lighting in the accent color.

OVERLAY ON THE RIGHT 40%:
- Subtle thematic graphic overlay matching the brand vertical: circuit-board / geometric lines for tech-AI-SaaS, geometric data lines for finance, organic curves for wellness, architectural lines for B2B. Overlay at 10-15% opacity in the accent color.
- Atmospheric glow / motion light streaks in the accent color suggesting dynamism (3-5 streaks, not many).
- Subject sharp focus, environment soft.

PHOTOGRAPHY QUALITY:
- The subject must look like a magazine cover - photographic realism, sharp detail, professional lighting.
- Subject identity matches the references when provided. No stock-photo-with-text aesthetic.

QUALITY BAR: Nike / Apple / Shopify / Stripe brand campaign. Twenty-year veteran graphic designer. Layered composition with depth, atmosphere, deliberate spacing. Every element earns its place.`

    case "ai_animation":
      return `\n\nSLOT STYLE: AI ANIMATION (still that captures motion + dynamic energy).

COMPOSITION:
- Dark background to make accent-color motion pop.
- Subject (from references when available) with sharp focus in the right-center.
- Headline in the upper-left in still negative space, single weight white or accent (${accent}).

MOTION ELEMENTS:
- Light streaks / motion blur trails in accent color (${accent}) flowing across the canvas (4-6 streaks, layered for depth).
- Holographic / data-stream elements integrated into the scene (glowing lines, particle effects, geometric trails). For tech verticals: code-particles / circuit-lines. For others: geometric motion.
- Subject has subtle directional blur or rim-light bloom to suggest forward motion.

QUALITY BAR: tech-brand kinetic campaign (think Tesla / Nvidia ad), sports-brand action ad (Nike kinetic typography), or financial-tech brand stinger. Energy and clarity simultaneously.`

    case "stock_content":
      return `\n\nSLOT STYLE: STOCK CONTENT (high-quality stock + brand color treatment).
- Clean editorial-stock composition with one clear subject (use references when present).
- Light brand-color overlay / gradient (${accent}) for brand cohesion.
- Headline in clean negative space, single weight.
- Authentic, polished, magazine-quality - NEVER generic Shutterstock-with-text aesthetic.
QUALITY BAR: Unsplash editor's pick + brand color grade. Better than stock-photo template.`

    default:
      return ""
  }
}

/**
 * Look & feel clauses (Roy 2026-06-13). Each non-auto pick from the
 * per-klant settings panel appends one short directive sentence to the
 * styleDirective so Gemini biases the aesthetic in that direction.
 * Kept terse on purpose — long clauses overflow the prompt budget and
 * dilute the structural-template anchor. "auto" returns empty string so
 * Pedro keeps doing whatever the brief + style category dictates.
 */
const VISUAL_STYLE_CLAUSES: Record<VisualStyleKey, string> = {
  auto: "",
  professional:
    "Aesthetic: corporate authority. Restrained palette, sans-serif typography, geometric layouts. Trustworthy, composed, no flourish.",
  modern_clean:
    "Aesthetic: modern & minimalist. Generous negative space, restrained palette, single accent color, crisp geometric type. Apple/Notion editorial cleanliness.",
  luxurious:
    "Aesthetic: premium luxury. Refined materials (matte black, brushed metal, marble or paper-grain), restrained palette, generous negative space, gold-or-accent typography, deep blacks or pearl whites. Hermès / Aesop / luxury watchmaker editorial.",
  feminine_soft:
    "Aesthetic: soft & feminine. Pastel palette (blush, sage, cream), organic curved shapes, soft diffuse lighting, serif headline, generous breathing space. Glossier / Goop / luxury wellness editorial.",
  mysterious_dark:
    "Aesthetic: enigmatic & dark. Low-key lighting with heavy shadow, restricted palette of one accent color against deep black or near-black, atmospheric haze, suspenseful negative space. Cinematic noir.",
  playful_energetic:
    "Aesthetic: playful & energetic. Bold saturated palette, kinetic angles, oversized typography with mixed-weight contrast, hand-drawn or geometric decorations. Energetic, optimistic, bold.",
  robust_industrial:
    "Aesthetic: robust & industrial. Earthy palette (concrete grey, rust, deep navy), heavyweight sans typography, grid-anchored layout, raw materials in scene, utilitarian honesty. Patagonia / Carhartt editorial.",
  vintage_editorial:
    "Aesthetic: vintage editorial. Warm cream / mocha / faded teal palette, serif headline with subtle texture, film-grain or paper-grain overlay, balanced asymmetric layout. 70s magazine editorial feel.",
}

const LIGHTING_CLAUSES: Record<LightingStyleKey, string> = {
  auto: "",
  studio_clean:
    "Lighting: studio clean. Soft diffused key light, fill light to lift shadows, near-shadowless backdrop, even tonal range across the subject.",
  natural_daylight:
    "Lighting: natural daylight. Window-quality soft light from a single direction, gentle shadows, slight warm cast, documentary realism.",
  golden_hour:
    "Lighting: golden hour. Warm low-angle sun, long soft shadows, amber rim light on the subject's edges, atmospheric haze in the background.",
  moody_dark:
    "Lighting: moody / low-key. Strong directional key with deep shadows, restricted highlight range, atmospheric depth, single accent rim light on the subject.",
  high_key_bright:
    "Lighting: high-key bright. Wash of even bright light, near-shadowless, soft highlights, light tonal range across the frame. Optimistic, clean, airy.",
}

const COMPOSITION_CLAUSES: Record<CompositionDensityKey, string> = {
  auto: "",
  minimal:
    "Composition density: minimal. Generous negative space (≥40% of canvas), one focal subject, no secondary objects competing for attention.",
  balanced:
    "Composition density: balanced. Focal subject occupies ~50-60% of canvas; supporting context elements present but secondary; clear visual hierarchy.",
  rich:
    "Composition density: rich layered. Multiple visual elements at different depths, layered textures, atmospheric haze separating planes, full canvas use without clutter.",
}

function lookAndFeelAddendum(
  visualStyle: VisualStyleKey,
  lightingStyle: LightingStyleKey,
  compositionDensity: CompositionDensityKey,
): string {
  const lines: string[] = []
  if (VISUAL_STYLE_CLAUSES[visualStyle]) lines.push(`- ${VISUAL_STYLE_CLAUSES[visualStyle]}`)
  if (LIGHTING_CLAUSES[lightingStyle]) lines.push(`- ${LIGHTING_CLAUSES[lightingStyle]}`)
  if (COMPOSITION_CLAUSES[compositionDensity]) lines.push(`- ${COMPOSITION_CLAUSES[compositionDensity]}`)
  if (lines.length === 0) return ""
  return `\n\nLOOK & FEEL OVERRIDE (per-klant panel keuze — vóór alle andere style directives):\n${lines.join("\n")}`
}

/** Creative-chrome styles (composite + animation) krijgen versoepelde
 *  RL_QUALITY_RULES omdat graphic overlays + brand panels + motion lines
 *  daar EXPECTED zijn. Andere styles houden de strikte "geen chrome" rules
 *  omdat het daar amateuristisch is. */
function allowsCreativeChrome(style: SlotStyleKey): boolean {
  return style === "ai_content" || style === "ai_animation"
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: variantId } = await params

  let body: {
    promptOverride?: string
    /** When set: generate just this slot. Default = all 3 slots. */
    position?: number
    /** Override how many slots to fill when position omitted.
     *  Default 3, max 10 (matches the CHECK on pedro_variant_images). */
    slots?: number
    /** Structured CM feedback voor een regen - gevuld vanuit de
     *  RegenFeedbackModal. Wordt achter de prompt geplakt en gelogd in
     *  pedro_creative_feedback. Roy 2026-06-10. */
    regenFeedback?: {
      imageFeedback?: string
      textFeedback?: string
      designFeedback?: string
      otherFeedback?: string
    }
    /** Roy 2026-06-12: per-slot style direction. CM kiest in de UI welke
     *  van de 4 categorieën elke slot moet zijn zodat we variatie krijgen
     *  ipv 3x dezelfde clean photo. Slot index → style key.
     *  Mappings:
     *   - real_photo        → klant-foto's as-is, minimal post-processing
     *   - real_ai_polish    → klant-foto's + atmospheric AI enhancement
     *   - branded_composite → fully composite ad met brand chrome
     *                         (graphic overlays, color panels, accent kleuren)
     *   - lifestyle         → subject in candid environment, cinematic
     */
    slotStyles?: Record<number, SlotStyleKey>
  } = {}
  try {
    body = await req.json()
  } catch {
    /* empty body is fine */
  }

  try {
    const supabase = await createAdminClient()

    const { data: variantRow, error: readErr } = await supabase
      .from("pedro_variants")
      .select(
        "id, client_id, refresh_id, image_prompt, ad_name, format_hint, topic_label, headline",
      )
      .eq("id", variantId)
      .maybeSingle()
    if (readErr) throw readErr
    if (!variantRow) {
      return NextResponse.json({ error: "Variant not found" }, { status: 404 })
    }

    const prompt = (body.promptOverride?.trim() || variantRow.image_prompt?.trim() || "").trim()
    if (!prompt) {
      return NextResponse.json(
        { error: "Geen imagePrompt op deze variant. Genereer eerst de refresh opnieuw of geef een prompt override." },
        { status: 400 },
      )
    }

    // Resolve reference images. Two sources, both best-effort:
    //   1. Winner ad thumbnail from Meta - DNA the CM already validated
    //   2. Client photos from Google Drive - real product/brand
    //      visuals so Gemini doesn't hallucinate the look-and-feel
    //
    // Gemini Nano Banana Pro accepts up to 3 reference images; we cap
    // at: 1 winner thumbnail + 2 client photos = 3 total. When Drive
    // is empty we fall back to just the winner thumbnail; when even
    // that fails we go prompt-only (Gemini handles that mode too).
    //
    // Both lookups run in parallel - Drive's recurse-one-level can
    // take 2-5s on big folders and there's no reason to serialize.

    type Ref = { bytes: Buffer; mimeType: "image/jpeg" | "image/png" }

    // Capture into a non-null const so the closures below don't need
    // type narrowing across the async boundary (TS doesn't carry the
    // earlier null-guard into nested function scope).
    const variant = variantRow

    // ── Resolve winner Meta ad details ─────────────────────────────
    // We need this BEFORE the Drive call so we can pass the winner's
    // campaign name as `campaignHint` - that's what makes Pedro pick
    // the right sub-folder under a multi-campaign umbrella (e.g.,
    // "Zumex" under "Juice Concepts Benelux" instead of Blendtec).
    async function resolveWinnerDetail(): Promise<{
      thumbnailUrl: string | null
      campaignName: string | null
      sourceScreenshotPath: string | null
    } | null> {
      try {
        const { data: refresh } = await supabase
          .from("pedro_refreshes")
          .select("envelope")
          .eq("id", variant.refresh_id)
          .maybeSingle()
        type RefreshEnv = {
          envelope?: {
            proposals?: Array<{
              basedOnAd?: {
                adId?: string
                adName?: string
                snapshot?: {
                  campaignName?: string
                  sourceScreenshotPath?: string
                }
              }
              variants?: Array<{ adName?: string }>
            }>
          }
        }
        const envelope = (refresh as RefreshEnv | null)?.envelope
        const proposal = envelope?.proposals?.find((p) =>
          p.variants?.some((v) => v.adName === variant.ad_name),
        )
        const winnerAdId = proposal?.basedOnAd?.adId
        if (!winnerAdId) return null
        // Roy 2026-06-10: gesnapshote screenshot path is altijd
        // beschikbaar uit envelope - geen Meta-call nodig om 'm te
        // resolven.
        const sourceScreenshotPath =
          proposal?.basedOnAd?.snapshot?.sourceScreenshotPath ?? null
        const snapshotCampaignName =
          proposal?.basedOnAd?.snapshot?.campaignName ?? null

        const { fetchMetaAdDetails } = await import("@/lib/integrations/meta")
        const { data: clientRow } = await supabase
          .from("clients")
          .select("meta_ad_account_id")
          .eq("monday_item_id", variant.client_id)
          .maybeSingle()
        if (!clientRow?.meta_ad_account_id) {
          return {
            thumbnailUrl: null,
            campaignName: snapshotCampaignName,
            sourceScreenshotPath,
          }
        }

        const end = new Date().toISOString().slice(0, 10)
        const startD = new Date()
        startD.setDate(startD.getDate() - 90)
        const start = startD.toISOString().slice(0, 10)
        const ads = await fetchMetaAdDetails(
          clientRow.meta_ad_account_id,
          start,
          end,
        ).catch(() => [])
        const match = ads.find((a) => a.adId === winnerAdId)

        return {
          thumbnailUrl: match?.thumbnailUrl ?? null,
          campaignName: match?.campaignName ?? snapshotCampaignName,
          sourceScreenshotPath,
        }
      } catch (e) {
        console.error(
          "[pedro/generate-image] winner detail resolve failed (continuing):",
          e instanceof Error ? e.message : e,
        )
        return null
      }
    }

    const winnerDetail = await resolveWinnerDetail()
    const winnerCampaignName = winnerDetail?.campaignName ?? null

    type WinnerRef = (Ref & { isUploadedScreenshot: boolean }) | null
    async function fetchWinnerThumbRef(): Promise<WinnerRef> {
      // Roy 2026-06-10: prio op handmatig-geüploade screenshot. Wanneer
      // de CM eentje heeft toegevoegd via de AdPicker (voor ads zonder
      // Meta thumbnail), gebruiken we DIE als reference. Anders val we
      // terug op de Meta thumbnail URL.
      // Roy 2026-06-11 v2: track of het de uploaded screenshot is zodat
      // we de visual-lock prompt erop kunnen aanzetten - dat is een
      // hoge-resolutie screenshot van de WINNING ad, geen Meta-thumbnail
      // van lage resolutie. CM verwacht dat varianten erop lijken.
      const screenshotPath = winnerDetail?.sourceScreenshotPath
      if (screenshotPath) {
        try {
          const { getVariantImageBytes } = await import(
            "@/lib/integrations/pedro-image-storage"
          )
          const bytes = await getVariantImageBytes(screenshotPath)
          if (bytes) {
            const mimeType: "image/jpeg" | "image/png" = screenshotPath
              .toLowerCase()
              .endsWith(".png")
              ? "image/png"
              : "image/jpeg"
            return { bytes, mimeType, isUploadedScreenshot: true }
          }
        } catch (e) {
          console.error(
            "[pedro/generate-image] uploaded screenshot fetch failed (falling back to Meta thumb):",
            e instanceof Error ? e.message : e,
          )
        }
      }
      const url = winnerDetail?.thumbnailUrl
      if (!url) return null
      try {
        const ref = await fetchReferenceImage(url)
        return ref
          ? { bytes: ref.bytes, mimeType: ref.mimeType, isUploadedScreenshot: false }
          : null
      } catch (e) {
        console.error(
          "[pedro/generate-image] winner-thumb fetch failed (continuing):",
          e instanceof Error ? e.message : e,
        )
        return null
      }
    }

    // Load the CM-managed image-source prefs for THIS client. Two
    // sources of truth:
    //   - pedro_drive_folder_prefs (rows with enabled=false → hard skip
    //     subtree in BFS, no vision/Gemini cost on those folders)
    //   - pedro_client_state.image_source_prefs.useStock (whether to
    //     pull Pexels stock as an extra source)
    // Roy 2026-06-10: keuzeproces gebeurt VOOR de Genereer-klik, dus
    // deze prefs zijn de single source of truth voor wat Pedro mag.
    async function loadImageSourcePrefs(): Promise<{
      deniedFolderIds: Set<string>
      useStock: boolean
    }> {
      const out = { deniedFolderIds: new Set<string>(), useStock: false }
      try {
        const { data: folderRows } = await supabase
          .from("pedro_drive_folder_prefs")
          .select("folder_id, enabled")
          .eq("client_id", variant.client_id)
          .eq("enabled", false)
        for (const r of (folderRows ?? []) as Array<{ folder_id: string; enabled: boolean }>) {
          if (r.folder_id) out.deniedFolderIds.add(r.folder_id)
        }
      } catch {
        /* best-effort; fall through to empty denylist */
      }
      try {
        const { data: stateRow } = await supabase
          .from("pedro_client_state")
          .select("image_source_prefs")
          .eq("client_id", variant.client_id)
          .order("campaign_number", { ascending: false })
          .limit(1)
          .maybeSingle<{ image_source_prefs: { useStock?: boolean } | null }>()
        out.useStock = stateRow?.image_source_prefs?.useStock === true
      } catch {
        /* keep default */
      }
      return out
    }

    async function fetchDrivePhotoRefs(deniedFolderIds: Set<string>): Promise<DriveImageRef[]> {
      try {
        const { fetchClientById } = await import("@/lib/integrations/monday")
        const mondayClient = await fetchClientById(variant.client_id).catch(() => null)
        const driveId = mondayClient?.googleDriveId?.trim()
        if (!driveId) return []
        // Topic hints from the variant: ad-name + topic_label drive the
        // filename-keyword scoring so we pick photos relevant to THIS
        // variant's angle, not just the most recent file in the folder.
        const topicHints = [variant.topic_label, variant.ad_name].filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        )
        return await getFolderImages(driveId, 2, {
          campaignHint: winnerCampaignName ?? undefined,
          topicHints,
          deniedFolderIds,
          // Vision rerank: Haiku describes each candidate photo (cached
          // by file_id), then ranks them against the campaign + variant
          // angle. Lets Pedro "zelf nadenken" over fotokeuze instead of
          // blindly trusting folder-score order.
          rerank: async (candidates) =>
            rerankDrivePhotos(
              supabase,
              candidates,
              {
                campaignName: winnerCampaignName,
                topicLabel: variant.topic_label,
                adName: variant.ad_name,
              },
              variant.client_id,
            ),
        })
      } catch (e) {
        console.error(
          "[pedro/generate-image] drive-photos fetch failed (continuing):",
          e instanceof Error ? e.message : e,
        )
        return []
      }
    }

    // Pexels stock fallback: actief wanneer CM `useStock=true` heeft
    // staan voor deze klant. Levert max 2 candidates die vervolgens
    // door dezelfde Haiku rerank lopen. Pedro's Drive-resultaten
    // hebben prio bij gelijke vision-score (zie referenceImages
    // assembly hieronder).
    async function fetchStockRefs(briefSector: string | null): Promise<DriveImageRef[]> {
      try {
        const queries = deriveStockQueries({
          campaignName: winnerCampaignName,
          topicLabel: variant.topic_label,
          sector: briefSector,
        })
        if (queries.length === 0) return []
        // Run search queries sequentially - Pexels rate limit is fine
        // but we want to STOP early as soon as we have enough.
        const collected = new Map<string, DriveImageRef>()
        for (const q of queries) {
          if (collected.size >= 4) break
          const photos = await searchPexelsPhotos(q, 3).catch(() => [])
          for (const p of photos) {
            if (collected.has(p.id)) continue
            collected.set(p.id, {
              id: p.id,
              name: p.name,
              mimeType: p.mimeType,
              // No real modifiedTime - use epoch so it doesn't get
              // an artificial recency bonus in any downstream scorer.
              modifiedTime: new Date(0).toISOString(),
              bytes: p.bytes,
            })
            if (collected.size >= 4) break
          }
        }
        if (collected.size === 0) return []
        // Rerank stock candidates the same way as Drive - vision-relevance
        // scoring against the campaign context. Reuses the same Haiku
        // cache by file_id ("pexels:<id>" keys).
        const candidates = Array.from(collected.values())
        return await rerankDrivePhotos(
          supabase,
          candidates,
          {
            campaignName: winnerCampaignName,
            topicLabel: variant.topic_label,
            adName: variant.ad_name,
          },
          variant.client_id,
        )
      } catch (e) {
        console.error(
          "[pedro/generate-image] stock fetch failed (continuing):",
          e instanceof Error ? e.message : e,
        )
        return []
      }
    }

    // Resolve the visual-style policy from the CM's brief + the scraped
    // fingerprint quality. Roy 2026-06-10: this is what makes the
    // "Match Drive folder only" / "Match winning ad only" / "Custom
    // prompt" modes in the brief actually do something at image-gen
    // time. Without it, Pedro always used every reference it could
    // find regardless of the CM's intent.
    const { data: stateRow } = await supabase
      .from("pedro_client_state")
      .select("brief, brand_style, creative_settings")
      .eq("client_id", variant.client_id)
      .order("campaign_number", { ascending: false })
      .limit(1)
      .maybeSingle<{
        brief: Record<string, unknown> | null
        brand_style: Record<string, unknown> | null
        creative_settings: Record<string, unknown> | null
      }>()
    const briefForPolicy = (stateRow?.brief ?? null) as Record<string, unknown> | null
    const brandStyleForPolicy = (stateRow?.brand_style ?? null) as Partial<BrandStyle> | null

    // Roy 2026-06-13: pull the per-client creative_settings override and
    // overlay it on the hardcoded defaults. Drives aspect ratio, slot
    // style defaults, inspiration-subfolder scoping, and the brand-color
    // injection toggle. Body args still win over settings (the wizard's
    // inline picker overrides the saved default for a single run).
    const creativeOverride = sanitiseCreativeSettings(stateRow?.creative_settings)
    const effectiveSettings = resolveEffectiveSettings(creativeOverride)
    const policy = resolveVisualStylePolicy(
      briefForPolicy
        ? {
            visualStyleMode:
              briefForPolicy.visualStyleMode === "drive_only" ||
              briefForPolicy.visualStyleMode === "winning_ad_only" ||
              briefForPolicy.visualStyleMode === "custom"
                ? briefForPolicy.visualStyleMode
                : "website",
            customStylePrompt:
              typeof briefForPolicy.customStylePrompt === "string"
                ? briefForPolicy.customStylePrompt
                : "",
            websiteToggles: briefForPolicy.websiteToggles as
              | { useColors: boolean; useFonts: boolean; useLookFeel: boolean; useLogo: boolean }
              | undefined,
            fallbackFontHeading:
              briefForPolicy.fallbackFontHeading === "manrope" ||
              briefForPolicy.fallbackFontHeading === "plus_jakarta"
                ? briefForPolicy.fallbackFontHeading
                : "inter",
          }
        : null,
      brandStyleForPolicy as BrandStyle | null,
    )

    // Resolve sector from the brief - used both for stock query
    // derivation and downstream prompt grounding.
    const briefSectorRaw = briefForPolicy?.sector
    const briefSector =
      typeof briefSectorRaw === "string" ? briefSectorRaw.trim() || null : null

    // Load CM-managed source prefs first (cheap query). Then the heavy
    // Drive/winner/stock fetches run in parallel, each respecting the
    // prefs + the visual-style policy.
    const sourcePrefs = await loadImageSourcePrefs()

    // Roy 2026-06-11: download non-logo website images uit
    // brand_style.websiteImages zodat ze in dezelfde reference pool als
    // Drive photos terechtkomen. Was eerst genegeerd - Pedro had de
    // beste klantfoto's onder zijn neus liggen en gebruikte ze niet.
    async function fetchWebsiteImageRefs(): Promise<DriveImageRef[]> {
      // Gating: website photos zijn een "real photo reference" net als
      // Drive, dus we volgen useDrivePhotos. In "drive_only" mode wil
      // de CM expliciet alleen Drive - dan overslaan. In
      // "winning_ad_only" mode is useDrivePhotos al false dus die filter
      // pakt 'm. In "website" + "custom" wordt 'ie gebruikt.
      if (!policy.referenceImagePolicy.useDrivePhotos) return []
      const briefMode = briefForPolicy?.visualStyleMode
      if (briefMode === "drive_only") return []
      const rawList = Array.isArray(brandStyleForPolicy?.websiteImages)
        ? (brandStyleForPolicy?.websiteImages as Array<{ url: string; context?: string }>)
        : []
      if (rawList.length === 0) return []
      const refs: DriveImageRef[] = []
      for (const item of rawList.slice(0, 4)) {
        if (!item?.url) continue
        try {
          const r = await fetch(item.url, {
            signal: AbortSignal.timeout(7000),
            headers: { "User-Agent": "PedroBot/1.0 website-images" },
          })
          if (!r.ok) continue
          const buf = Buffer.from(await r.arrayBuffer())
          if (buf.byteLength === 0 || buf.byteLength > 6 * 1024 * 1024) continue
          const contentType = r.headers.get("content-type") ?? ""
          // Gemini Nano Banana Pro accepteert JPEG en PNG. Webp/avif/etc
          // forceren we naar jpeg label - de bytes blijven hetzelfde,
          // de SDK gokt op extension. Roy 2026-06-11.
          const mimeType: "image/jpeg" | "image/png" = contentType.includes("png")
            ? "image/png"
            : "image/jpeg"
          refs.push({
            id: `website:${item.url.split("/").pop()?.slice(0, 60) ?? Date.now()}`,
            name: `website-${item.context ?? "section"}-${refs.length}`,
            mimeType,
            modifiedTime: new Date(0).toISOString(),
            bytes: buf,
          })
        } catch {
          /* skip failed download */
        }
      }
      return refs
    }

    // Drive brand-asset detection (Roy 2026-06-11). Scant root + 1
    // niveau diep voor brand book / style guide / kleuren / logo /
    // fonts naar file-namen, en injecteert die als reference-list in
    // de Gemini prompt. Geen vision-call - puur naming-based - dus
    // goedkoop. Wanneer er geen Drive gekoppeld is of de policy zegt
    // "geen Drive", overslaan.
    async function fetchBrandAssets(): Promise<BrandAsset[]> {
      if (!policy.referenceImagePolicy.useDrivePhotos) return []
      try {
        const { fetchClientById } = await import("@/lib/integrations/monday")
        const mondayClient = await fetchClientById(variant.client_id).catch(() => null)
        const driveId = mondayClient?.googleDriveId?.trim()
        if (!driveId) return []
        return await findBrandAssetsInDrive(driveId, { maxFiles: 25 })
      } catch (e) {
        console.error(
          "[pedro/generate-image] brand-assets fetch failed (continuing):",
          e instanceof Error ? e.message : e,
        )
        return []
      }
    }

    // Fetch refs in parallel - but skip the call entirely when the
    // policy says we won't use that source. Cuts the Meta + Drive
    // round-trips when they're going to be thrown away anyway.
    const [
      winnerThumbRef,
      drivePhotoRefs,
      stockRefs,
      websiteImageRefs,
      brandAssets,
    ] = await Promise.all([
      policy.referenceImagePolicy.useWinnerThumbnail ? fetchWinnerThumbRef() : Promise.resolve(null),
      policy.referenceImagePolicy.useDrivePhotos
        ? fetchDrivePhotoRefs(sourcePrefs.deniedFolderIds)
        : Promise.resolve([] as DriveImageRef[]),
      // Stock photos only when the CM toggled them on AND the visual
      // policy allows Drive photos in the first place - same gating
      // (both are "real photo references").
      sourcePrefs.useStock && policy.referenceImagePolicy.useDrivePhotos
        ? fetchStockRefs(briefSector)
        : Promise.resolve([] as DriveImageRef[]),
      fetchWebsiteImageRefs(),
      fetchBrandAssets(),
    ])
    const brandAssetsBlock = brandAssetsPromptBlock(brandAssets)

    // PDF brand-color extraction (Roy 2026-06-11). Wanneer Drive een
    // kleuren.pdf / style-guide.pdf bevat, halen we daar de canonical
    // hex codes uit en cachen het resultaat op brand_style. Volgende
    // generaties lezen de cache. Faal-soft - PDF vision is een bonus
    // signaal, geen blocker.
    type PdfCache = NonNullable<typeof brandStyleForPolicy>["pdfDerivedPalette"]
    let pdfPaletteForPrompt: PdfCache | null =
      (brandStyleForPolicy?.pdfDerivedPalette as PdfCache) ?? null
    const pdfCandidate = brandAssets.find(
      (a) =>
        a.mimeType === "application/pdf" &&
        (a.category === "colors" || a.category === "brandbook" || a.category === "style_guide"),
    )
    if (pdfCandidate) {
      const cached = pdfPaletteForPrompt
      const cacheHit =
        cached &&
        cached.sourceFileId === pdfCandidate.fileId &&
        Array.isArray(cached.hexCodes) &&
        cached.hexCodes.length > 0
      if (!cacheHit) {
        try {
          const bytes = await downloadDriveFileBytes(pdfCandidate.fileId)
          if (bytes) {
            const extracted = await extractColorsFromBrandPdf({
              pdfBytes: bytes,
              fileName: pdfCandidate.fileName,
            })
            if (extracted) {
              pdfPaletteForPrompt = {
                hexCodes: extracted.hexCodes,
                sourceFileName: pdfCandidate.fileName,
                sourceFileId: pdfCandidate.fileId,
                reason: extracted.reason,
                computedAt: extracted.computedAt,
                model: extracted.model,
              }
              // Persist to pedro_client_state.brand_style so future calls
              // for any variant on this client short-circuit. Best-effort.
              const mergedBrandStyle = {
                ...(brandStyleForPolicy ?? {}),
                pdfDerivedPalette: pdfPaletteForPrompt,
              }
              await supabase
                .from("pedro_client_state")
                .update({ brand_style: mergedBrandStyle })
                .eq("client_id", variant.client_id)
              console.log(
                `[pedro/generate-image] PDF palette cached for ${variant.client_id}: ${extracted.hexCodes.join(",")} from ${pdfCandidate.fileName}`,
              )
            }
          }
        } catch (e) {
          console.error(
            "[pedro/generate-image] PDF palette extraction failed (continuing):",
            e instanceof Error ? e.message : e,
          )
        }
      }
    }

    // Build the reference pool. Order: winner thumbnail first (DNA),
    // then Drive (real client product), then Website (klant's eigen
    // hero / team / product shots van hun site), then Stock (generic).
    // Gemini Nano Banana Pro accepts up to 3 references - we cap at that.
    // Roy 2026-06-11: website images zitten BOVEN stock omdat ze real
    // klantmateriaal zijn en vrijwel altijd beter dan Pexels generieks.
    const referenceImages: Ref[] = []
    const referenceNames: Array<{
      source: "winner" | "drive" | "website" | "stock"
      name: string
    }> = []
    const REF_CAP = 3
    if (winnerThumbRef) {
      // Strip the flag-only field - Gemini accepts just bytes + mimeType.
      referenceImages.push({ bytes: winnerThumbRef.bytes, mimeType: winnerThumbRef.mimeType })
      referenceNames.push({
        source: "winner",
        name: winnerThumbRef.isUploadedScreenshot
          ? "uploaded source screenshot"
          : "winner thumbnail",
      })
    }
    for (const p of drivePhotoRefs) {
      if (referenceImages.length >= REF_CAP) break
      referenceImages.push({ bytes: p.bytes, mimeType: p.mimeType })
      referenceNames.push({ source: "drive", name: p.name })
    }
    for (const p of websiteImageRefs) {
      if (referenceImages.length >= REF_CAP) break
      referenceImages.push({ bytes: p.bytes, mimeType: p.mimeType })
      referenceNames.push({ source: "website", name: p.name })
    }
    for (const p of stockRefs) {
      if (referenceImages.length >= REF_CAP) break
      referenceImages.push({ bytes: p.bytes, mimeType: p.mimeType })
      referenceNames.push({ source: "stock", name: p.name })
    }

    console.log(
      `[pedro/generate-image] refs for ${variant.id}: campaign="${winnerCampaignName ?? "(unknown)"}", winner=${winnerThumbRef ? "yes" : "no"}, drive=${drivePhotoRefs.length}, website=${websiteImageRefs.length}, stock=${stockRefs.length}, brandAssets=${brandAssets.length}, used=${referenceImages.length}/${REF_CAP}, prefs={denied:${sourcePrefs.deniedFolderIds.size},stock:${sourcePrefs.useStock}}, policy={winner:${policy.referenceImagePolicy.useWinnerThumbnail},drive:${policy.referenceImagePolicy.useDrivePhotos},notice:${policy.notice ? "yes" : "no"}}`,
    )

    // Resolve target slots. Default: generate ALL 3 slots in parallel
    // so the CM gets a 3-up to pick from. When `position` is set: only
    // that slot (used by "Regenereer slot N" in the UI). Each Gemini
    // call gets its own randomization via a slot-index hint in the
    // prompt so we don't get 3 identical outputs.
    let targetSlots: number[] = []
    if (typeof body.position === "number") {
      const p = Math.max(0, Math.min(9, Math.floor(body.position)))
      targetSlots = [p]
    } else {
      const n = Math.max(1, Math.min(10, Math.floor(body.slots ?? 3)))
      targetSlots = Array.from({ length: n }, (_, i) => i)
    }

    // Per-slot regen cap (Roy 2026-06-10): single-slot regens are
    // limited to 1 per slot to keep credit usage bounded. The
    // RegenFeedbackModal already gates the click, but the CM could
    // bypass via direct API call - defense in depth.
    //
    // Only enforced on single-slot regen (the "Regen" button path).
    // Bulk generation of 3-up first-shot has no cap; that's the entry
    // point. Manual upload also resets the slot (handled in
    // upload-image route by not touching regen_count).
    const isSingleSlotRegen = targetSlots.length === 1
    if (isSingleSlotRegen) {
      const onlySlot = targetSlots[0]
      const { data: existing } = await supabase
        .from("pedro_variant_images")
        .select("regen_count, storage_path")
        .eq("variant_id", variant.id)
        .eq("position", onlySlot)
        .maybeSingle<{ regen_count: number | null; storage_path: string | null }>()
      // Only enforce when there's already an image (= this is a re-gen,
      // not the first-ever gen for this slot). When storage_path is
      // null, the slot has never had an image, so we let it through
      // even if regen_count was somehow > 0.
      if (existing?.storage_path && (existing.regen_count ?? 0) >= 1) {
        return NextResponse.json(
          {
            error:
              "Regen limiet bereikt voor deze slot (max 1× per slot). Upload je eigen afbeelding of regenereer de hele refresh om opnieuw te beginnen.",
            regenBlocked: true,
            position: onlySlot,
          },
          { status: 429 },
        )
      }
    }

    // Structured CM feedback uit de RegenFeedbackModal - wordt
    // achter de prompt geplakt zodat Gemini ZIET wat fout was en
    // specifiek dat moet fixen. Lege feedback = single-line addendum
    // weggelaten.
    const fb = body.regenFeedback ?? {}
    const fbParts: string[] = []
    if (fb.imageFeedback?.trim()) {
      fbParts.push(`IMAGE CONTENT: ${fb.imageFeedback.trim()}`)
    }
    if (fb.textFeedback?.trim()) {
      fbParts.push(`ON-IMAGE TEXT: ${fb.textFeedback.trim()}`)
    }
    if (fb.designFeedback?.trim()) {
      fbParts.push(`DESIGN / STYLE: ${fb.designFeedback.trim()}`)
    }
    if (fb.otherFeedback?.trim()) {
      fbParts.push(`ADDITIONAL CONTEXT: ${fb.otherFeedback.trim()}`)
    }
    const feedbackAddendum =
      fbParts.length > 0
        ? `\n\n---\nCM REGEN FEEDBACK (CRITICAL - fix these specifically):\n${fbParts.join("\n")}\n---`
        : ""

    // RL_QUALITY_RULES - hardcoded suffix appended to EVERY Gemini call,
    // regardless of what Pedro generated in the variant.image_prompt.
    // Defense-in-depth: even when Pedro's prompt is verbose or sloppy,
    // these typography rules ride along so Gemini can't hide behind
    // ambiguity. Roy 2026-06-10: marketing-agency-leverbaar quality is
    // the bar. Het screenshot van 3 concurrerende badges + dubbele
    // "3x MARGE" + mismatched fonts is precies wat dit voorkomt.
    // Roy 2026-06-11: exact on-image text lockdown. Voorheen wisselde
    // Gemini per slot een andere tekst ("Elk glas vers." vs "Werken aan
    // een verse toekomst") terwijl de CM een specifieke headline ("Vragen
    // je gasten ook naar verse sappen?") had ingesteld. Nu forceren we
    // de exacte Dutch headline verbatim - per slot zelfde tekst, alleen
    // de visuele uitvoering varieert.
    const exactHeadline = (variant.headline ?? "").trim()
    const HEADLINE_LOCKDOWN = exactHeadline
      ? `

---
EXACT ON-IMAGE TEXT - MANDATORY VERBATIM:

The on-image text MUST be EXACTLY this Dutch sentence, character for character:
"${exactHeadline}"

- Do NOT translate to English or any other language.
- Do NOT paraphrase, shorten, or rephrase.
- Do NOT add quotation marks around it.
- Do NOT add a period if the original has a question mark.
- Do NOT change punctuation, capitalization, or word order.
- This is the ONLY text element allowed on the image.
- Every output slot must render the IDENTICAL text - only the visual scene varies.`
      : ""

    const RL_QUALITY_RULES = `

---
NON-NEGOTIABLE RL QUALITY RULES (marketing-agency deliverable quality):

ON-IMAGE TEXT - render EXACTLY the Dutch headline ONCE.
- No badges. No stickers. No price tags (€..). No "3x"/"2x"/"+15%" multiplier callouts.
- No comparison labels (LAGE/HOGE, before/after, vs).
- No secondary captions, no sub-headlines, no photo captions, no watermarks.
- Do NOT duplicate any text element. Render the headline ONCE in ONE position.
- If the headline doesn't fit cleanly, simplify the scene - do not break it across boxes.

TYPOGRAPHY - must read as a professionally designed ad.
- ONE sans-serif typeface across the whole headline (no mixed fonts within a line).
- Even letter-spacing. Consistent weight. Sharp anti-aliased edges.
- Minimum 8% canvas padding on all sides around the headline.
- Headline sits in clean negative space - never on top of visually busy detail.
- Color: use a single brand-consistent accent OR pure black/white. No mixed fills + outlines.

COMPOSITION.
- ONE clear photographic subject in focus.
- Clean background. No collage. No split-screen unless explicitly requested.
- No competing brand names, logos, or product names from sibling brands.
- Brand presence only if it naturally occurs on the product (small, in-context).

NEGATIVE: badges, sticker overlays, price tags, comparison labels, duplicated text elements, competing brand watermarks, "€X" price callouts, "Nx" multiplier stickers, before/after split overlays, mixed fonts, mixed text weights, low-resolution rendering, collage-style layouts.`

    // Brand asset block sits BEFORE the RL quality rules so Gemini
    // reads "respect these brand references" as part of the user-level
    // prompt, with the hardcoded quality rules as the final authoritative
    // suffix. Empty string when no brand assets were detected.
    const pdfPaletteLine =
      pdfPaletteForPrompt && pdfPaletteForPrompt.hexCodes.length > 0
        ? `\n\nCANONICAL BRAND COLORS (from ${pdfPaletteForPrompt.sourceFileName}, authoritative): ${pdfPaletteForPrompt.hexCodes.join(", ")}\nThese OVERRIDE any other color cue. Primary = first hex, secondary = second, accents follow.`
        : ""
    const brandAssetsAddendum =
      brandAssetsBlock || pdfPaletteLine
        ? `\n\n---\n${brandAssetsBlock}${pdfPaletteLine}\n---`
        : ""

    // Roy 2026-06-11 v2: SOURCE VISUAL LOCK. Wanneer de CM een
    // screenshot van de winning ad heeft geupload, is dat de eerste
    // reference image (zie referenceImages assembly hierboven). We
    // injecteren dan een harde instructie zodat Gemini begrijpt dat
    // die screenshot de te-volgen visuele DNA is, niet zomaar een
    // willekeurige reference. Voorkomt dat Pedro's variant in 3
    // totaal verschillende visuele richtingen vertrekt.
    const SOURCE_VISUAL_LOCK = winnerThumbRef?.isUploadedScreenshot
      ? `

---
SOURCE AD VISUAL LOCK (CRITICAL):

The FIRST reference image attached is the EXACT winning ad uploaded by the campaign manager. Your output must be a visual SIBLING of it - immediately recognisable as an iteration of the same ad.

MATCH from the source:
- Color palette (background tones, text color, accent / badge colors)
- Composition + framing (subject placement, headline placement, badge placement)
- Photographic style (lighting, mood, depth of field, art direction)
- On-image text treatment (font weight, size relationship, alignment)
- Badge / sticker style if present (shape, fill, treatment)
- Subject category (robot / product / person / scene - keep same category)

ONLY CHANGE:
- The exact Dutch headline text (use the headline supplied in this prompt verbatim)
- The specific subject details enough to make it a fresh execution, not a copy

DO NOT:
- Pick a completely different scene type (source = robot in dark teal? do not generate a smiling human in white office).
- Switch color palettes.
- Move text from top to bottom or vice versa (keep the source's headline placement).
- Add new badges that aren't in the source.

A buitenstaander must recognise your output and the source screenshot as 'iteraties van dezelfde ad', not 'twee verschillende campagnes'.`
      : ""

    // Roy 2026-06-12: pull canonical brand colors uit pdfPaletteForPrompt
    // OF uit brand_style.colors zodat de styleDirective hex codes kan
    // injecteren ipv het generieke "brand accent colors".
    const brandHexFromPdf = pdfPaletteForPrompt?.hexCodes ?? null
    const brandHexFromStyle =
      brandStyleForPolicy &&
      typeof brandStyleForPolicy === "object" &&
      Array.isArray((brandStyleForPolicy as { colors?: unknown }).colors)
        ? ((brandStyleForPolicy as { colors: Array<{ hex?: string }> }).colors
            .map((c) => c?.hex)
            .filter((h): h is string => typeof h === "string" && /^#[0-9a-f]{6}$/i.test(h)))
        : null
    // Roy 2026-06-13: per-klant override van de brand-colour set in
    // creative_settings.brandColors wins over auto-detected. Only enabled
    // entries (default true when unset) are forwarded to Gemini.
    const brandHexFromOverride =
      Array.isArray(effectiveSettings.brandColors) && effectiveSettings.brandColors.length > 0
        ? effectiveSettings.brandColors
            .filter((c) => c.enabled !== false)
            .map((c) => c.hex)
            .filter((h) => /^#[0-9a-f]{3,6}$/i.test(h))
        : null
    const brandHexForPrompt =
      brandHexFromOverride && brandHexFromOverride.length > 0
        ? brandHexFromOverride
        : brandHexFromPdf ?? brandHexFromStyle ?? null

    // Composite slots krijgen versoepelde RL_QUALITY_RULES (allowed:
    // graphic overlays, brand-color panels). Andere styles houden de
    // originele "geen overlays" rules omdat composite chrome daar
    // amateuristisch oogt.
    const RL_QUALITY_RULES_COMPOSITE = `

---
RL QUALITY RULES (composite-allowed):
- ONE on-image headline text element rendered ONCE. Mixed weight is OK (key brand words in accent color), but only one block, never duplicated.
- Brand-color background panel + subtle graphic overlay (circuit/lines/geometry) ARE expected for composite ads.
- Subject (when present from reference): identity preserved, integrated with composite via lighting, not cut-and-paste.
- Headline placement: clean negative space, ≥8% padding. Mixed-weight typography only when intentional (key brand word in accent color), never random.
- NO badges, NO price tags, NO comparison stickers (LAGE/3x), NO duplicated text, NO competing brand logos.
- Looks like a paid agency deliverable. Marketing-agency quality bar.`

    // Roy 2026-06-13: aspect ratio is now per-klant configureerbaar in
    // creative_settings (default still 4:5 for Meta Feed portrait, RL
    // paid-social standaard). 9:16 sloop de headline layout — alleen
    // gebruiken wanneer een klant het bewust kiest in de panel.
    const aspectRatio = effectiveSettings.aspectRatio

    // Generate all targets in parallel. Each slot has its own STYLE
    // direction so de CM 3 verschillende looks ziet ipv 3x dezelfde scene.
    //
    // Roy 2026-06-12: per slot pulls 1 inspiration ref uit de matching
    // AD CREATIVES INSPIRATION/<style>/ subfolder. Wanneer beschikbaar
    // wordt die als EERSTE reference image meegestuurd met "structural
    // template" framing - Gemini matcht layout + compositie + typography
    // ervan, substitutes alleen de tekst + subject + kleuren. Was eerder
    // "do not copy" framing die Gemini de ref liet negeren - nieuwe
    // framing forceert 'm de structuur over te nemen.
    // Slot-style resolution order (most specific wins):
    //   1. body.slotStyles[slot]                 — wizard's inline picker for THIS run
    //   2. effectiveSettings.slotStyleDefaults   — per-klant saved default
    //   3. DEFAULT_SLOT_STYLES                   — hardcoded Hub default
    //   4. "client_content_ai"                   — last-resort fallback
    const settingsSlotDefaults = effectiveSettings.slotStyleDefaults as Record<number, SlotStyleKey>
    const resolvedSlotStyles = body.slotStyles ?? {}

    // Per-klant subfolder scoping: if the CM disabled e.g. AI Animation
    // for this klant in the panel, skip the library fetch for any slot
    // whose style maps to that subfolder. Generation still proceeds, just
    // without an inspiration anchor for that slot.
    const subfolderEnabled = effectiveSettings.inspirationSubfolders as InspirationSubfolderFlags

    const inspirationRefs = await Promise.all(
      targetSlots.map((slot) => {
        const style: SlotStyleKey =
          resolvedSlotStyles[slot] ??
          settingsSlotDefaults[slot] ??
          DEFAULT_SLOT_STYLES[slot] ??
          "client_content_ai"
        if (!subfolderEnabled[style]) return null
        return fetchInspirationRefForStyle(style).catch(() => null)
      }),
    )

    // When brand-color injection is toggled off in the panel, pass null
    // to styleDirective so it falls back to the generic "brand's accent
    // colors" phrasing instead of explicit hex codes. Toggle is per-klant.
    const brandHexForDirective = effectiveSettings.brandColorInjection
      ? brandHexForPrompt
      : null

    // Roy 2026-06-13: Look & feel addendum (single string for all slots
    // since these are per-klant panel choices, not per-slot). Empty when
    // all three dropdowns are on "auto".
    const lookAndFeelText = lookAndFeelAddendum(
      effectiveSettings.visualStyle,
      effectiveSettings.lightingStyle,
      effectiveSettings.compositionDensity,
    )

    const slotResults = await Promise.allSettled(
      targetSlots.map((slot, idx) => {
        const style: SlotStyleKey =
          resolvedSlotStyles[slot] ??
          settingsSlotDefaults[slot] ??
          DEFAULT_SLOT_STYLES[slot] ??
          "client_content_ai"
        const directive = styleDirective(style, brandHexForDirective) + lookAndFeelText
        const inspiration = inspirationRefs[idx]
        // Creative-chrome styles (composite + animation) krijgen
        // versoepelde rules zodat overlays + panels niet geblocked
        // worden. Andere styles houden de strikte "geen chrome" rules.
        const qualityRules = allowsCreativeChrome(style)
          ? RL_QUALITY_RULES_COMPOSITE
          : RL_QUALITY_RULES

        // Inspiration-library framing: de eerste reference is een
        // STRUCTURAL TEMPLATE - layout / compositie / typography /
        // lighting overnemen. Tekst + subject + brand colors zijn van
        // ons. Eerdere "do not copy" framing maakte Gemini de ref
        // negeren, nieuwe framing forceert structurele overname.
        const slotRefImages: Ref[] = [...referenceImages]
        let inspirationFraming = ""
        if (inspiration) {
          slotRefImages.unshift({
            bytes: inspiration.bytes,
            mimeType: inspiration.mimeType,
          })
          inspirationFraming = `\n\nSTRUCTURAL TEMPLATE (FIRST attached image):\nThe first reference image is a winning ad from the "${inspiration.subfolderName}" inspiration library and serves as the STRUCTURAL TEMPLATE for this output. MATCH closely:\n  - Overall LAYOUT (panel positions, headline placement, subject placement, CTA position).\n  - COMPOSITION proportions (split ratios, focal hierarchy).\n  - LIGHTING direction + atmospheric treatment.\n  - TYPOGRAPHY hierarchy (relative size, weight contrast).\n  - CHROME treatment (overlay style + intensity).\nSUBSTITUTE:\n  - The exact Dutch headline supplied in this prompt.\n  - The subject from the OTHER attached reference photos when present.\n  - The brand color palette from this prompt.\nIn other words: take the reference's "how", inject our "what". A new viewer should recognise the result as built from the same playbook as the reference.`
        }

        const styledPrompt =
          prompt +
          feedbackAddendum +
          brandAssetsAddendum +
          SOURCE_VISUAL_LOCK +
          directive +
          inspirationFraming +
          qualityRules +
          HEADLINE_LOCKDOWN

        // Gemini sweet spot is 3 refs total: inspiration template first,
        // then winner thumbnail, then up to 1 client photo. Past 3 the
        // model dilutes the structural template guidance.
        const refsForGemini = slotRefImages.slice(0, 3)

        return generateImageWithReference({
          prompt: styledPrompt,
          referenceImages: refsForGemini.length > 0 ? refsForGemini : undefined,
          aspectRatio,
        })
      }),
    )

    // Upload + persist per successful generation; collect errors for
    // partial-failure reporting (UI shows "2/3 succeeded").
    type SlotState = {
      position: number
      ok: boolean
      signedUrl?: string
      storagePath?: string
      provider?: "gemini"
      model?: string
      error?: string
    }
    const slotStates: SlotState[] = []
    for (let i = 0; i < targetSlots.length; i++) {
      const slot = targetSlots[i]
      const r = slotResults[i]
      if (r.status === "rejected") {
        slotStates.push({
          position: slot,
          ok: false,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        })
        continue
      }
      try {
        const uploaded = await uploadVariantImage({
          clientId: variant.client_id,
          variantId: variant.id,
          position: slot,
          bytes: r.value.bytes,
          contentType: r.value.mimeType,
          width: r.value.width,
          height: r.value.height,
        })

        // Roy 2026-06-10: bump regen_count when this was a single-slot
        // regen (= the CM clicked the "Regen" button after the slot
        // already had an image). First-shot multi-slot generation
        // leaves regen_count untouched. We can't atomic-increment via
        // upsert, so first check the existing row.
        let nextRegenCount = 0
        if (isSingleSlotRegen) {
          const { data: existingSlot } = await supabase
            .from("pedro_variant_images")
            .select("storage_path, regen_count")
            .eq("variant_id", variant.id)
            .eq("position", slot)
            .maybeSingle<{ storage_path: string | null; regen_count: number | null }>()
          // Only count this as a "regen" when there was actually an
          // image to replace. Otherwise it's effectively a first gen.
          if (existingSlot?.storage_path) {
            nextRegenCount = (existingSlot.regen_count ?? 0) + 1
          }
        }
        await supabase
          .from("pedro_variant_images")
          .upsert(
            {
              variant_id: variant.id,
              position: slot,
              storage_path: uploaded.storagePath,
              provider: "gemini",
              model: r.value.model,
              generated_at: new Date().toISOString(),
              width: uploaded.width,
              height: uploaded.height,
              regen_count: nextRegenCount,
            },
            { onConflict: "variant_id,position" },
          )

        const signedUrl = await getVariantImageSignedUrl(uploaded.storagePath)
        slotStates.push({
          position: slot,
          ok: true,
          signedUrl: signedUrl ?? undefined,
          storagePath: uploaded.storagePath,
          provider: "gemini",
          model: r.value.model,
        })
      } catch (e) {
        slotStates.push({
          position: slot,
          ok: false,
          error: e instanceof Error ? e.message : "Upload/persist failed",
        })
      }
    }

    // Roy 2026-06-10: gestructureerde regen-feedback wordt ook gelogd
    // in pedro_creative_feedback zodat de VOLGENDE refresh leert
    // (zelfde mechanisme als prompt-edits). Type=explicit, sterker
    // signaal dan prompt_edit omdat de CM hier letterlijk in 4 velden
    // heeft uitgelegd wat fout was.
    if (fbParts.length > 0) {
      try {
        await supabase.from("pedro_creative_feedback").insert({
          client_id: variant.client_id,
          variant_id: variant.id,
          refresh_id: variant.refresh_id,
          feedback_type: "explicit",
          feedback_text: `[Regen feedback op variant "${variant.ad_name ?? ""}" slot ${typeof body.position === "number" ? String.fromCharCode(65 + body.position) : "?"}]\n${fbParts.join("\n")}`,
          created_by_email: session.user.email ?? null,
        })
      } catch (e) {
        console.error(
          "[pedro/generate-image] regen feedback log failed (continuing):",
          e instanceof Error ? e.message : e,
        )
      }
    }

    // Persist the prompt override on the variant row so subsequent
    // regens (any slot) reuse the edited prompt by default. Also log
    // it as a feedback signal so the next creative-refresh prompt sees
    // what this CM wanted changed - the feedback loop that closes the
    // iterative knowledge-gap per knowledge/campaigns.md §Image Creative
    // Principles #5.
    if (body.promptOverride?.trim()) {
      const newPrompt = body.promptOverride.trim()
      const previous = variant.image_prompt ?? ""
      await supabase
        .from("pedro_variants")
        .update({ image_prompt: newPrompt })
        .eq("id", variant.id)
      // Only log the edit when it's a real change, not a re-submit of
      // the same text. Cap the stored text - for prompt edits we keep
      // the new version (it's the signal of where the CM steered).
      if (newPrompt !== previous.trim()) {
        try {
          await supabase.from("pedro_creative_feedback").insert({
            client_id: variant.client_id,
            variant_id: variant.id,
            refresh_id: variant.refresh_id,
            feedback_type: "prompt_edit",
            feedback_text: `[Prompt edit op variant "${variant.ad_name ?? ""}"]\n${newPrompt.slice(0, 1500)}`,
            created_by_email: session.user.email ?? null,
          })
        } catch (e) {
          console.error(
            "[pedro/generate-image] feedback log failed (continuing):",
            e instanceof Error ? e.message : e,
          )
        }
      }
    }

    // If literally every slot failed, surface the first error as 502
    // so the UI shows the actionable message (quota, billing, etc.).
    const anyOk = slotStates.some((s) => s.ok)
    if (!anyOk) {
      const first = slotStates.find((s) => !s.ok)
      return NextResponse.json(
        { error: first?.error ?? "Image generation failed for all slots", slots: slotStates },
        { status: 502 },
      )
    }

    return NextResponse.json({
      variantId: variant.id,
      slots: slotStates,
      provider: "gemini",
      model: DEFAULT_IMAGE_MODEL,
      // Per-source flags so the UI can show "Generated with: winner
      // thumbnail + 2 client photos + 1 Pexels stock" and the CM trusts
      // the output. Roy 2026-06-10: split client photos vs stock so the
      // CM kan zien dat een variant op stock is geleund.
      references: {
        winnerThumbnail: winnerThumbRef !== null,
        clientPhotos: referenceNames.filter((r) => r.source === "drive").length,
        stockPhotos: referenceNames.filter((r) => r.source === "stock").length,
        clientPhotoNames: referenceNames
          .filter((r) => r.source === "drive")
          .map((r) => r.name),
        stockPhotoNames: referenceNames
          .filter((r) => r.source === "stock")
          .map((r) => r.name),
        // Roy 2026-06-12: surface which slots got an inspiration-library
        // ref + from which subfolder. Helps the CM see in the UI that
        // slot B was anchored on an "AI Content" winner from the library.
        inspirationBySlot: targetSlots.reduce<Record<number, { subfolder: string; fileName: string } | null>>(
          (acc, slot, idx) => {
            const insp = inspirationRefs[idx]
            acc[slot] = insp
              ? { subfolder: insp.subfolderName, fileName: insp.fileName }
              : null
            return acc
          },
          {},
        ),
      },
      hadReference: referenceImages.length > 0,
    })
  } catch (e) {
    console.error(
      "[pedro/generate-image] failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Image generation failed" },
      { status: 500 },
    )
  }
}
