/**
 * Per-client Pedro creative settings — the dials a CM tweaks per klant
 * on the Pedro Optimize wizard (aspect ratio, AI intensity, slot styles,
 * inspiration-subfolder scope, brand-color injection toggle, brand-book
 * Drive ref). Stored as `pedro_client_state.creative_settings jsonb`
 * (migration 20240070).
 *
 * Defaults vs overrides:
 *   - Every field is optional; null/undefined = inherit the hardcoded
 *     default below.
 *   - Settings UI shows the effective value (override OR default) but
 *     only persists what the user touched, so future default changes
 *     keep flowing through to clients that didn't override.
 *
 * Roy 2026-06-13.
 */

/** Aligned with Gemini's supported aspect ratios — 4:5 is the Meta Feed
 *  portrait (RL paid-social default), 1:1 the square, 9:16 the Reel/Story
 *  vertical, and 1.91:1 the Meta landscape format. Roy 2026-06-13. */
export type AspectRatio = "4:5" | "1:1" | "9:16" | "1.91:1"

export type SlotStyleKey =
  | "client_content"
  | "client_content_ai"
  | "ai_content"
  | "ai_animation"
  | "stock_content"

export type InspirationSubfolderFlags = {
  client_content: boolean
  client_content_ai: boolean
  ai_content: boolean
  ai_animation: boolean
  stock_content: boolean
}

export type BrandBookSource =
  | "drive_auto"      // auto-discovered in the client's Drive
  | "drive_picked"    // CM picked a specific Drive file
  | "upload"          // CM uploaded a PDF directly
  | "website_fallback" // Pedro generated a brand-style summary from the website

/** Visual style language — what the ad "radiates". Multi-select per Roy
 *  2026-06-13: een ad is zelden alleen "professioneel" of alleen "luxe",
 *  meestal een combinatie ("professioneel + modern & clean + luxe"). De
 *  CM kan er meerdere aanvinken; Pedro append elke clause aan de
 *  styleDirective in volgorde. "auto" is een sentinel — verschijnt niet
 *  in de array en betekent "geen overrides; laat Pedro het kiezen op
 *  basis van de brief.sector". */
export type VisualStyleKey =
  | "auto"
  | "professional"
  | "modern_clean"
  | "luxurious"
  | "tech_ai"
  | "feminine_soft"
  | "mysterious_dark"
  | "playful_energetic"
  | "robust_industrial"
  | "vintage_editorial"

/** Lighting + composition were removed from the per-klant panel and the
 *  global tab on 2026-06-13 (Roy: te abstract, CM weet niet wat te kiezen).
 *  Types blijven bestaan zodat oude saves niet breken; de UI rendert ze
 *  niet meer en generate-image leest ze niet meer. */
export type LightingStyleKey =
  | "auto"
  | "studio_clean"
  | "natural_daylight"
  | "golden_hour"
  | "moody_dark"
  | "high_key_bright"

export type CompositionDensityKey = "auto" | "minimal" | "balanced" | "rich"

export type PedroCreativeSettings = {
  aspectRatio?: AspectRatio
  /** 0 = keep the original photo as-is, 100 = fully AI-edited composite. */
  aiIntensity?: number
  /** Deprecated 2026-06-13: kept in jsonb for back-compat, no longer
   *  surfaced in the panel. creative-refresh still reads via override. */
  variantsPerRefresh?: number
  slotStyleDefaults?: Partial<Record<number, SlotStyleKey>>
  inspirationSubfolders?: Partial<InspirationSubfolderFlags>
  brandColorInjection?: boolean
  /** Deprecated 2026-06-13: color presence slider removed from the panel
   *  per Roy. Kept in jsonb so old saves don't blow up sanitising. */
  brandColorIntensity?: number
  brandBookDriveFileId?: string | null
  brandBookSource?: BrandBookSource

  // Look & feel (Roy 2026-06-13). Multi-select voor visuele stijl —
  // een ad combineert meestal meerdere attributen ("professioneel +
  // modern & clean + luxe"). Empty/missing array = auto = laat Pedro
  // het kiezen op basis van brief.sector.
  visualStyles?: VisualStyleKey[]

  /** @deprecated 2026-06-13: vervangen door visualStyles[]. Sanitiser
   *  coerceert een legacy string-waarde naar een 1-element array zodat
   *  oude saves blijven werken zonder migration. */
  visualStyle?: VisualStyleKey

  /** @deprecated 2026-06-13: lichtstijl uit panel verwijderd; type
   *  blijft voor back-compat met oude saves. */
  lightingStyle?: LightingStyleKey
  /** @deprecated 2026-06-13: compositiedichtheid uit panel verwijderd. */
  compositionDensity?: CompositionDensityKey

  /** Per-klant override of auto-detected brand colors. When set + non-
   *  empty, generate-image uses these in place of the website/PDF
   *  scraping. Each entry has its own `enabled` toggle so the CM can
   *  exclude a colour without deleting it (handy for "we don't want
   *  the off-white in ads but keep it on the website"). Roy 2026-06-13. */
  brandColors?: Array<{ hex: string; enabled?: boolean }>
}

export const DEFAULT_CREATIVE_SETTINGS: Required<
  Omit<PedroCreativeSettings, "brandBookDriveFileId" | "brandBookSource" | "brandColors">
> & Pick<PedroCreativeSettings, "brandBookDriveFileId" | "brandBookSource" | "brandColors"> = {
  aspectRatio: "4:5",
  // Roy 2026-06-13: was 60, lowered to 40 so default output stays closer
  // to the client's own photography. Composite/heavy-AI is opt-in via
  // the panel rather than the default.
  aiIntensity: 40,
  variantsPerRefresh: 3,
  // Roy 2026-06-13: was 0=client_content_ai / 1=ai_content / 2=ai_animation.
  // Default all three to client_content_ai so a fresh refresh is consistent
  // "real photo with light AI polish" across all slots. CM upgrades
  // specific slots to AI Content / AI Animation when they want variation.
  slotStyleDefaults: {
    0: "client_content_ai",
    1: "client_content_ai",
    2: "client_content_ai",
  },
  inspirationSubfolders: {
    client_content: true,
    client_content_ai: true,
    ai_content: true,
    ai_animation: true,
    stock_content: false,
  },
  brandColorInjection: true,
  brandColorIntensity: 60,
  brandBookDriveFileId: null,
  brandBookSource: undefined,
  brandColors: undefined,
  visualStyles: [],
  visualStyle: "auto",
  lightingStyle: "auto",
  compositionDensity: "auto",
}

const VALID_ASPECTS = new Set<AspectRatio>(["4:5", "1:1", "9:16", "1.91:1"])
const VALID_SLOT_STYLES = new Set<SlotStyleKey>([
  "client_content",
  "client_content_ai",
  "ai_content",
  "ai_animation",
  "stock_content",
])
const VALID_BRAND_BOOK_SOURCES = new Set<BrandBookSource>([
  "drive_auto",
  "drive_picked",
  "upload",
  "website_fallback",
])
const VALID_VISUAL_STYLES = new Set<VisualStyleKey>([
  "auto",
  "professional",
  "modern_clean",
  "luxurious",
  "tech_ai",
  "feminine_soft",
  "mysterious_dark",
  "playful_energetic",
  "robust_industrial",
  "vintage_editorial",
])
const VALID_LIGHTING_STYLES = new Set<LightingStyleKey>([
  "auto",
  "studio_clean",
  "natural_daylight",
  "golden_hour",
  "moody_dark",
  "high_key_bright",
])
const VALID_COMPOSITION_DENSITIES = new Set<CompositionDensityKey>([
  "auto",
  "minimal",
  "balanced",
  "rich",
])
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const SUBFOLDER_KEYS: Array<keyof InspirationSubfolderFlags> = [
  "client_content",
  "client_content_ai",
  "ai_content",
  "ai_animation",
  "stock_content",
]

function clampPct(n: unknown): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** Validate + normalise a raw jsonb blob from the database. Unknown keys
 *  are dropped, out-of-range values clamped. Returns a sparse object so
 *  the caller can distinguish "not set" from "set to default". */
export function sanitiseCreativeSettings(raw: unknown): PedroCreativeSettings {
  if (!raw || typeof raw !== "object") return {}
  const r = raw as Record<string, unknown>
  const out: PedroCreativeSettings = {}

  if (typeof r.aspectRatio === "string" && VALID_ASPECTS.has(r.aspectRatio as AspectRatio)) {
    out.aspectRatio = r.aspectRatio as AspectRatio
  }
  const ai = clampPct(r.aiIntensity)
  if (ai !== undefined) out.aiIntensity = ai

  if (typeof r.variantsPerRefresh === "number" && Number.isFinite(r.variantsPerRefresh)) {
    out.variantsPerRefresh = Math.max(1, Math.min(10, Math.round(r.variantsPerRefresh)))
  }

  if (r.slotStyleDefaults && typeof r.slotStyleDefaults === "object") {
    const dict = r.slotStyleDefaults as Record<string, unknown>
    const cleaned: Partial<Record<number, SlotStyleKey>> = {}
    for (const k of Object.keys(dict)) {
      const idx = Number(k)
      const v = dict[k]
      if (
        Number.isInteger(idx) &&
        idx >= 0 &&
        idx < 10 &&
        typeof v === "string" &&
        VALID_SLOT_STYLES.has(v as SlotStyleKey)
      ) {
        cleaned[idx] = v as SlotStyleKey
      }
    }
    if (Object.keys(cleaned).length > 0) out.slotStyleDefaults = cleaned
  }

  if (r.inspirationSubfolders && typeof r.inspirationSubfolders === "object") {
    const dict = r.inspirationSubfolders as Record<string, unknown>
    const cleaned: Partial<InspirationSubfolderFlags> = {}
    for (const k of SUBFOLDER_KEYS) {
      if (typeof dict[k] === "boolean") cleaned[k] = dict[k] as boolean
    }
    if (Object.keys(cleaned).length > 0) out.inspirationSubfolders = cleaned
  }

  if (typeof r.brandColorInjection === "boolean") out.brandColorInjection = r.brandColorInjection
  const bci = clampPct(r.brandColorIntensity)
  if (bci !== undefined) out.brandColorIntensity = bci

  if (typeof r.brandBookDriveFileId === "string" && r.brandBookDriveFileId.trim().length > 0) {
    out.brandBookDriveFileId = r.brandBookDriveFileId.trim()
  } else if (r.brandBookDriveFileId === null) {
    out.brandBookDriveFileId = null
  }
  if (typeof r.brandBookSource === "string" && VALID_BRAND_BOOK_SOURCES.has(r.brandBookSource as BrandBookSource)) {
    out.brandBookSource = r.brandBookSource as BrandBookSource
  }

  // Look & feel (Roy 2026-06-13). Multi-select voor visualStyles; legacy
  // singular `visualStyle` wordt gecoerced naar een 1-element array zodat
  // oude saves blijven werken. "auto" entries worden weggefilterd
  // (empty array == auto). Lichtstijl + compositie blijven sanitiseren
  // voor back-compat maar verschijnen niet meer in de UI.
  if (Array.isArray(r.visualStyles)) {
    const cleaned: VisualStyleKey[] = []
    const seen = new Set<VisualStyleKey>()
    for (const v of r.visualStyles) {
      if (
        typeof v === "string" &&
        VALID_VISUAL_STYLES.has(v as VisualStyleKey) &&
        v !== "auto" &&
        !seen.has(v as VisualStyleKey)
      ) {
        cleaned.push(v as VisualStyleKey)
        seen.add(v as VisualStyleKey)
      }
    }
    out.visualStyles = cleaned
  } else if (typeof r.visualStyle === "string" && VALID_VISUAL_STYLES.has(r.visualStyle as VisualStyleKey)) {
    // Legacy singular coercion: wrap in array; "auto" → empty array.
    if (r.visualStyle === "auto") {
      out.visualStyles = []
    } else {
      out.visualStyles = [r.visualStyle as VisualStyleKey]
    }
  }
  if (typeof r.lightingStyle === "string" && VALID_LIGHTING_STYLES.has(r.lightingStyle as LightingStyleKey)) {
    out.lightingStyle = r.lightingStyle as LightingStyleKey
  }
  if (
    typeof r.compositionDensity === "string" &&
    VALID_COMPOSITION_DENSITIES.has(r.compositionDensity as CompositionDensityKey)
  ) {
    out.compositionDensity = r.compositionDensity as CompositionDensityKey
  }

  // Per-klant brand colour override (Roy 2026-06-13).
  if (Array.isArray(r.brandColors)) {
    const cleaned: Array<{ hex: string; enabled?: boolean }> = []
    for (const entry of r.brandColors) {
      if (!entry || typeof entry !== "object") continue
      const e = entry as Record<string, unknown>
      const hex = typeof e.hex === "string" ? e.hex.trim() : ""
      if (!HEX_RE.test(hex)) continue
      const item: { hex: string; enabled?: boolean } = { hex: hex.toLowerCase() }
      if (typeof e.enabled === "boolean") item.enabled = e.enabled
      cleaned.push(item)
    }
    // Empty array is meaningful — "explicitly no colours". Preserve it.
    out.brandColors = cleaned
  }

  return out
}

/** Three-layer resolution chain (most specific wins):
 *    1. per-klant override (`override` arg)
 *    2. global admin defaults (`global` arg) — Pedro tab in /settings
 *    3. hardcoded DEFAULT_CREATIVE_SETTINGS
 *
 *  Used by generate-image to read final values, and by both the per-klant
 *  panel and the global-defaults form to display the current effective
 *  state. Sub-objects (slotStyleDefaults / inspirationSubfolders) are
 *  merged at each layer so an empty override doesn't wipe partial globals.
 *  Roy 2026-06-13. */
export function resolveEffectiveSettings(
  override: PedroCreativeSettings | null | undefined,
  global?: PedroCreativeSettings | null,
): typeof DEFAULT_CREATIVE_SETTINGS {
  const ov = override ?? {}
  const gl = global ?? {}
  const pick = <K extends keyof typeof DEFAULT_CREATIVE_SETTINGS>(
    key: K,
  ): (typeof DEFAULT_CREATIVE_SETTINGS)[K] => {
    const fromOv = (ov as PedroCreativeSettings)[key as keyof PedroCreativeSettings]
    if (fromOv !== undefined) return fromOv as (typeof DEFAULT_CREATIVE_SETTINGS)[K]
    const fromGl = (gl as PedroCreativeSettings)[key as keyof PedroCreativeSettings]
    if (fromGl !== undefined) return fromGl as (typeof DEFAULT_CREATIVE_SETTINGS)[K]
    return DEFAULT_CREATIVE_SETTINGS[key]
  }
  return {
    aspectRatio: pick("aspectRatio"),
    aiIntensity: pick("aiIntensity"),
    variantsPerRefresh: pick("variantsPerRefresh"),
    slotStyleDefaults: {
      ...DEFAULT_CREATIVE_SETTINGS.slotStyleDefaults,
      ...(gl.slotStyleDefaults ?? {}),
      ...(ov.slotStyleDefaults ?? {}),
    },
    inspirationSubfolders: {
      ...DEFAULT_CREATIVE_SETTINGS.inspirationSubfolders,
      ...(gl.inspirationSubfolders ?? {}),
      ...(ov.inspirationSubfolders ?? {}),
    },
    brandColorInjection: pick("brandColorInjection"),
    brandColorIntensity: pick("brandColorIntensity"),
    brandBookDriveFileId: pick("brandBookDriveFileId"),
    brandBookSource: pick("brandBookSource"),
    brandColors: pick("brandColors"),
    visualStyles: ov.visualStyles ?? gl.visualStyles ?? DEFAULT_CREATIVE_SETTINGS.visualStyles,
    visualStyle: pick("visualStyle"),
    lightingStyle: pick("lightingStyle"),
    compositionDensity: pick("compositionDensity"),
  }
}
