// Shared helpers for Pedro – campaign generation AI tools

export interface VisionImage {
  data: string // base64 without prefix
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"
}

export async function callClaude(
  prompt: string,
  maxTokens = 1000,
  images?: VisionImage[]
): Promise<string> {
  const res = await fetch("/api/pedro/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, maxTokens, images }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data.text
}

export function dataUrlToVisionImage(dataUrl: string): VisionImage | null {
  const match = dataUrl.match(
    /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/
  )
  if (!match) return null
  return {
    mediaType: match[1] as VisionImage["mediaType"],
    data: match[2],
  }
}

export function sanitizeOutput(text: string): string {
  return text
    .replace(/[—–]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
}

export function parseJSON<T>(raw: string): T {
  return JSON.parse(raw.replace(/```json|```/g, "").trim())
}

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
