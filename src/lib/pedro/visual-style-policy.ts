import type { BrandStyle } from "@/lib/pedro/helpers"

/**
 * Visual-style policy resolver.
 *
 * Three inputs combine into one decision:
 *   1. The CM's choices in the brief (visualStyleMode, websiteToggles,
 *      customStylePrompt, fallbackFontHeading).
 *   2. The scraped brand fingerprint (BrandStyle) with its embedded
 *      Haiku quality verdict.
 *   3. The implicit quality gate - score <40 disables the fingerprint
 *      even when the CM has "Match website" selected; 40-69 only allows
 *      the objective data (colors + fonts).
 *
 * Output:
 *   - `brandBlockLines`: the lines to render inside the BRAND IDENTITY
 *     section of the creative-refresh prompt. Empty array means render
 *     no block at all. The CM's customStylePrompt also lands here when
 *     mode = "custom".
 *   - `referenceImagePolicy`: tells the image-gen route whether to
 *     include the winner-ad thumbnail and Drive photos.
 *   - `notice`: human-readable string for the brief modal banner -
 *     non-null when the policy diverged from "use everything by
 *     default" (quality below 40, mode override, etc).
 *
 * This is pure-functional + side-effect-free so it's trivially unit
 * testable from any caller. Roy 2026-06-10.
 */

export type VisualStyleMode = "website" | "drive_only" | "winning_ad_only" | "custom"
export type FallbackFontKey = "inter" | "manrope" | "plus_jakarta"

export type WebsiteToggles = {
  useColors: boolean
  useFonts: boolean
  useLookFeel: boolean
  useLogo: boolean
}

const DEFAULT_TOGGLES: WebsiteToggles = {
  useColors: true,
  useFonts: true,
  useLookFeel: true,
  useLogo: true,
}

/** Display label + short identifier passed into the prompt. SemiBold for
 *  headlines, Regular/Medium for body - picked for the "uitgesproken /
 *  duidelijk, iets bold maar niet té bold" brief Roy gave. */
const FALLBACK_FONT_LABEL: Record<FallbackFontKey, string> = {
  inter: "Inter SemiBold (headlines) / Regular-Medium (body)",
  manrope: "Manrope SemiBold (headlines) / Regular-Medium (body)",
  plus_jakarta: "Plus Jakarta Sans SemiBold (headlines) / Regular-Medium (body)",
}

export type VisualStyleConfig = {
  visualStyleMode?: VisualStyleMode
  customStylePrompt?: string
  websiteToggles?: WebsiteToggles
  fallbackFontHeading?: FallbackFontKey
}

export type ReferenceImagePolicy = {
  useWinnerThumbnail: boolean
  useDrivePhotos: boolean
}

export type ResolvedVisualStylePolicy = {
  brandBlockLines: string[]
  referenceImagePolicy: ReferenceImagePolicy
  notice: string | null
  /** Whether the website fingerprint was applied (any element on). For
   *  observability - surfaces in creative-refresh-context's sources
   *  flags so we can tell from logs that the policy kicked in. */
  fingerprintApplied: boolean
}

/** Normalize a partial config (e.g. a raw brief blob from the DB) into
 *  fully-defined values. Keeps the policy function simple by guaranteeing
 *  every field is present. */
function normalizeConfig(config: VisualStyleConfig | null | undefined): {
  mode: VisualStyleMode
  toggles: WebsiteToggles
  customPrompt: string
  fallbackFont: FallbackFontKey
} {
  const mode = config?.visualStyleMode ?? "website"
  const toggles: WebsiteToggles = {
    useColors: config?.websiteToggles?.useColors ?? DEFAULT_TOGGLES.useColors,
    useFonts: config?.websiteToggles?.useFonts ?? DEFAULT_TOGGLES.useFonts,
    useLookFeel: config?.websiteToggles?.useLookFeel ?? DEFAULT_TOGGLES.useLookFeel,
    useLogo: config?.websiteToggles?.useLogo ?? DEFAULT_TOGGLES.useLogo,
  }
  const customPrompt = (config?.customStylePrompt ?? "").trim()
  const fallbackFont = config?.fallbackFontHeading ?? "inter"
  return { mode, toggles, customPrompt, fallbackFont }
}

export function resolveVisualStylePolicy(
  config: VisualStyleConfig | null | undefined,
  brand: BrandStyle | null | undefined,
): ResolvedVisualStylePolicy {
  const { mode, toggles, customPrompt, fallbackFont } = normalizeConfig(config)
  const fallbackFontLabel = FALLBACK_FONT_LABEL[fallbackFont]

  // ── Mode-level branches that don't consult the fingerprint ─────────
  if (mode === "custom") {
    const lines: string[] = []
    if (customPrompt.length > 0) {
      lines.push(`VISUAL STYLE (custom - CM-authored, treat as authoritative): ${customPrompt}`)
    }
    lines.push(`Typography fallback: ${fallbackFontLabel}.`)
    return {
      brandBlockLines: lines,
      referenceImagePolicy: { useWinnerThumbnail: false, useDrivePhotos: false },
      notice: "Custom visual prompt - Pedro ignores website + winner ad + Drive photos.",
      fingerprintApplied: false,
    }
  }

  if (mode === "drive_only") {
    return {
      brandBlockLines: [
        "VISUAL STYLE: Use ONLY the Drive folder photos as visual reference. Do not invent a brand identity from the winner ad or the website.",
        `Typography: ${fallbackFontLabel}.`,
      ],
      referenceImagePolicy: { useWinnerThumbnail: false, useDrivePhotos: true },
      notice: "Pedro only uses Drive folder photos - website fingerprint + winner ad style ignored.",
      fingerprintApplied: false,
    }
  }

  if (mode === "winning_ad_only") {
    return {
      brandBlockLines: [
        "VISUAL STYLE: Mirror the winning ad's DNA tightly. Do not pull in website-fingerprint elements or Drive photos.",
        `Typography: ${fallbackFontLabel}.`,
      ],
      referenceImagePolicy: { useWinnerThumbnail: true, useDrivePhotos: false },
      notice: "Pedro mirrors the winner ad only - website fingerprint + Drive photos ignored.",
      fingerprintApplied: false,
    }
  }

  // ── mode === "website" - apply quality gate + per-element toggles ─
  const verdict = brand?.qualityVerdict ?? null
  const score = verdict?.score ?? null

  // Quality gate. Roy 2026-06-10: <40 disables the fingerprint entirely
  // (Pedro falls back to winner-ad + Drive + standard fonts). 40-69
  // only allows objective data (colors + fonts), no layout/style. >=70
  // applies the toggles verbatim.
  const fullFingerprintAllowed = score === null || score >= 70
  const onlyObjectiveAllowed = score !== null && score >= 40 && score < 70
  const fingerprintBlocked = score !== null && score < 40

  if (fingerprintBlocked) {
    return {
      brandBlockLines: [
        `BRAND IDENTITY: website fingerprint suppressed (Pedro quality score ${score}/100). ${verdict?.summary ?? ""}`.trim(),
        `Lean on winner-ad DNA + Drive folder photos for visual style. Typography fallback: ${fallbackFontLabel}.`,
      ],
      referenceImagePolicy: { useWinnerThumbnail: true, useDrivePhotos: true },
      notice: `Quality score ${score}/100 - website fingerprint suppressed. ${verdict?.summary ?? ""}`.trim(),
      fingerprintApplied: false,
    }
  }

  // From here on: we DO apply some fingerprint. Build the block per
  // toggle, respecting onlyObjectiveAllowed (skip look & feel + logo
  // when 40-69 even if those toggles are on).
  const lines: string[] = []
  const applied: string[] = []

  if (toggles.useColors && brand) {
    if (brand.primaryColor) {
      lines.push(`- Primary color: ${brand.primaryColor}`)
      applied.push("colors")
    }
    if (brand.secondaryColor && brand.secondaryColor !== "#ffffff") {
      lines.push(`- Secondary color: ${brand.secondaryColor}`)
    }
    if (brand.accentColor) {
      lines.push(`- Accent color (CTA / overlays): ${brand.accentColor}`)
    }
  }

  if (toggles.useFonts && brand && (brand.headingFont || brand.bodyFont)) {
    if (brand.headingFont) lines.push(`- Heading font: ${brand.headingFont}`)
    if (brand.bodyFont) lines.push(`- Body font: ${brand.bodyFont}`)
    applied.push("fonts")
  } else {
    // Fonts toggle is off OR site had no usable fonts → fall back so
    // Pedro always has a concrete typography spec to render.
    lines.push(`- Typography fallback: ${fallbackFontLabel}`)
  }

  if (
    fullFingerprintAllowed &&
    toggles.useLookFeel &&
    brand
  ) {
    if (brand.tone) lines.push(`- Tone: ${brand.tone}`)
    if (brand.visualStyle) lines.push(`- Visual style: ${brand.visualStyle}`)
    if (brand.heroImageUrl)
      lines.push(`- Hero image reference (composition/mood cue): ${brand.heroImageUrl}`)
    if (brand.taglineHeadline)
      lines.push(`- Site headline (tone reference): "${brand.taglineHeadline}"`)
    if (brand.taglineSubline)
      lines.push(`- Site subline (tone reference): "${brand.taglineSubline}"`)
    if (brand.tone || brand.visualStyle || brand.heroImageUrl) {
      applied.push("look_feel")
    }
  }

  if (fullFingerprintAllowed && toggles.useLogo && brand?.logoUrl) {
    lines.push(
      `- Brand logo (reference only - keep small on the ad, never dominant): ${brand.logoUrl}`,
    )
    applied.push("logo")
  }

  const headerLine =
    lines.length > 0
      ? onlyObjectiveAllowed
        ? `BRAND IDENTITY (objective data only - quality score ${score}/100 too low for layout/logo cues):`
        : `BRAND IDENTITY (use hex codes + font names verbatim in every imagePrompt for consistent headline overlays and CTAs):`
      : null

  const brandBlockLines = headerLine ? [headerLine, ...lines] : []

  let notice: string | null = null
  if (onlyObjectiveAllowed) {
    notice = `Quality score ${score}/100 - only brand colors + fonts applied. Layout/logo cues suppressed.`
  } else if (applied.length === 0 && score === null) {
    notice = "No usable brand fingerprint scraped - Pedro relies on winner ad + Drive folder."
  }

  return {
    brandBlockLines,
    referenceImagePolicy: { useWinnerThumbnail: true, useDrivePhotos: true },
    notice,
    fingerprintApplied: applied.length > 0,
  }
}

export const VISUAL_STYLE_FALLBACK_FONT_LABEL = FALLBACK_FONT_LABEL
