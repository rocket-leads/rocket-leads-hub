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
  tone: string
  industry: string
  brandKeywords: string
  visualStyle: string
}
