// Shared types + constants for Pedro - campaign generation AI tools.
// The Claude call helpers themselves live in pedro-campaign.tsx because
// they need to drive component-local state via onDelta callbacks during
// streaming. Keep this file types-and-constants only.

export const GENERATION_RULES = `\n\nALGEMENE REGELS (altijd opvolgen):
- Gebruik NOOIT datums, deadlines, vervaldata, actiedata of tijdelijke aanbiedingen (bv. "nog maar tot vrijdag", "actie geldig t/m", "alleen deze week") TENZIJ de klant expliciet een specifieke datum heeft opgegeven in de briefing.
- Genereer alle output in DEZELFDE TAAL als de input van de klant. Als de briefing in het Nederlands is, schrijf dan in het Nederlands. Als de briefing in het Engels is, schrijf dan in het Engels.`

export interface BriefData {
  bedrijf: string
  sector: string
  doel: string
  pijn: string
  aanbod: string
  usps: string
  hooksAM: string
  hooksExtra: string
}

export interface Angle {
  nummer: number
  titel: string
  beschrijving: string
}

export interface AdCopy {
  variantA: string
  variantB: string
  headlines: string
  beschrijving: string
}

export interface BrandStyle {
  primaryColor: string
  secondaryColor: string
  /** Accent color for headlines/CTA - usually the brightest brand color
   *  with luminance > 0.15, returned by analyze-website. Optional for
   *  back-compat with state rows saved before 2026-06-10. */
  accentColor?: string
  tone: string
  industry: string
  brandKeywords: string
  visualStyle: string
  /** Font families extracted from the client website CSS. Heading +
   *  body when both can be distinguished; otherwise both fall back to
   *  the same family. Pedro references these by name in image prompts
   *  so Gemini renders headlines in a brand-consistent typeface.
   *  Roy 2026-06-10. */
  headingFont?: string
  bodyFont?: string
  /** Brand-fingerprint additions (Roy 2026-06-10) - captured from the
   *  client website in `analyze-website/route.ts` to give Pedro more
   *  signal beyond the color palette.
   *
   *  All optional + URL strings:
   *   - `logoUrl`        - best-guess brand mark (og:image > apple
   *                         touch-icon > favicon > "logo"-named header
   *                         img). Used as a reference image when the
   *                         "Logo" toggle is on.
   *   - `heroImageUrl`   - first sizeable content image, excluding logos.
   *                         Used as a layout/composition reference when
   *                         "Look & feel" is on.
   *   - `taglineHeadline` - `<h1>` text (≤200 chars).
   *   - `taglineSubline`  - first `<p>` after the h1 (≤400 chars).
   *                         Feeds the tone-of-voice prompt for ad copy
   *                         generation, not the image prompt.
   */
  logoUrl?: string
  heroImageUrl?: string
  taglineHeadline?: string
  taglineSubline?: string
  /** Quality verdict from Haiku vision (Roy 2026-06-10). Drives the
   *  three-tier fingerprint gate: score >=70 use everything per toggles,
   *  40-69 only colors+fonts, <40 fingerprint off + fallback fonts.
   *
   *  Shape mirrors `WebsiteQualityVerdict` from website-quality.ts;
   *  duplicated here as inline anonymous fields to keep this file from
   *  importing the lib (and inverting the dependency direction).
   */
  qualityVerdict?: {
    score: number
    axes: {
      design_quality: number | null
      photo_quality: number | null
      brand_consistency: number | null
      completeness: number | null
    }
    flags: string[]
    summary: string
    computedAt: string
    model: string
  }
}
