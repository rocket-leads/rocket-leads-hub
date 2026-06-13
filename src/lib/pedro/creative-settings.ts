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

export type AspectRatio = "4:5" | "1:1" | "9:16" | "16:9"

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

export type PedroCreativeSettings = {
  aspectRatio?: AspectRatio
  /** 0 = keep the original photo as-is, 100 = fully AI-edited composite. */
  aiIntensity?: number
  variantsPerRefresh?: number
  slotStyleDefaults?: Partial<Record<number, SlotStyleKey>>
  inspirationSubfolders?: Partial<InspirationSubfolderFlags>
  brandColorInjection?: boolean
  /** 0 = subtle accent, 100 = panel-dominant brand-color treatment. */
  brandColorIntensity?: number
  brandBookDriveFileId?: string | null
  brandBookSource?: BrandBookSource
}

export const DEFAULT_CREATIVE_SETTINGS: Required<
  Omit<PedroCreativeSettings, "brandBookDriveFileId" | "brandBookSource">
> & Pick<PedroCreativeSettings, "brandBookDriveFileId" | "brandBookSource"> = {
  aspectRatio: "4:5",
  aiIntensity: 60,
  variantsPerRefresh: 3,
  slotStyleDefaults: { 0: "client_content_ai", 1: "ai_content", 2: "ai_animation" },
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
}

const VALID_ASPECTS = new Set<AspectRatio>(["4:5", "1:1", "9:16", "16:9"])
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

  return out
}

/** Effective settings = defaults overlaid with the saved overrides.
 *  Used by generate-image to read final values; used by the UI to
 *  display the current effective state. */
export function resolveEffectiveSettings(
  override: PedroCreativeSettings | null | undefined,
): typeof DEFAULT_CREATIVE_SETTINGS {
  if (!override) return DEFAULT_CREATIVE_SETTINGS
  return {
    aspectRatio: override.aspectRatio ?? DEFAULT_CREATIVE_SETTINGS.aspectRatio,
    aiIntensity: override.aiIntensity ?? DEFAULT_CREATIVE_SETTINGS.aiIntensity,
    variantsPerRefresh:
      override.variantsPerRefresh ?? DEFAULT_CREATIVE_SETTINGS.variantsPerRefresh,
    slotStyleDefaults: {
      ...DEFAULT_CREATIVE_SETTINGS.slotStyleDefaults,
      ...(override.slotStyleDefaults ?? {}),
    },
    inspirationSubfolders: {
      ...DEFAULT_CREATIVE_SETTINGS.inspirationSubfolders,
      ...(override.inspirationSubfolders ?? {}),
    },
    brandColorInjection:
      override.brandColorInjection ?? DEFAULT_CREATIVE_SETTINGS.brandColorInjection,
    brandColorIntensity:
      override.brandColorIntensity ?? DEFAULT_CREATIVE_SETTINGS.brandColorIntensity,
    brandBookDriveFileId:
      override.brandBookDriveFileId ?? DEFAULT_CREATIVE_SETTINGS.brandBookDriveFileId,
    brandBookSource: override.brandBookSource ?? DEFAULT_CREATIVE_SETTINGS.brandBookSource,
  }
}
