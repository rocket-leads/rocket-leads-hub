import { GENERATION_RULES, type BriefData, type Angle } from "@/lib/pedro/helpers"

/**
 * Stage 5: Lovable LP prompt.
 *
 * Generates the complete Lovable prompt the CM pastes into the Loveable
 * builder. Output specifies hero / pain / offer / USP / form sections,
 * Meta Pixel + Zapier webhook tracking, and UTM parameter handling.
 *
 * The "ALGEMENE benadering" rule is critical: the LP must work for ALL
 * selected angles simultaneously since one LP serves multiple ad variants.
 * Picking a single angle would orphan the rest.
 */

export type LpPromptArgs = {
  brief: BriefData
  selectedAngles: Angle[]
  /** Pre-rendered angles list (e.g. via anglesString helper). */
  anglesStr: string
  /** Already-rendered video-script context block (empty when script skipped). */
  scriptContext?: string
  /** Style reference from existing Rocket Leads Meta ads. */
  styleRef?: string
  /** Huisstijl block tailored for LP (huisstijlForLp helper). */
  huisstijl?: string
  stijl: string
  lengte: string
  pixelId?: string
  webhookUrl?: string
  utmStr?: string
  /** Free-text steering from the CM — e.g. "minder klaagverhaal,
   *  meer urgentie", "korter onder de fold". Layered on top of the
   *  standard prompt. */
  steering?: string
}

export function buildLpPrompt(args: LpPromptArgs): string {
  const { brief } = args
  const pixel = args.pixelId || "niet opgegeven"
  const webhook = args.webhookUrl || "niet opgegeven"
  const utm = args.utmStr || "utm_source=meta&utm_medium=paid"
  const angleNames = args.selectedAngles.map((a) => a.titel).join(", ")

  // Lengte-specific section toggles. "Short" gets only hero+CTA. Long
  // adds FAQ + objection-handling. Anything else gets the medium block.
  const formProofSection =
    args.lengte !== "Short - hero + CTA" ? ", social proof, leadformulier" : ""
  const longExtras = args.lengte === "Long - + FAQ + bezwaren" ? ", FAQ, bezwaren" : ""

  return `Jij bent Pedro bij Rocket Leads. Genereer een volledige Lovable prompt.${args.styleRef ?? ""}
${args.huisstijl ?? ""}

Client: ${brief.bedrijf} (${brief.sector})
Doelgroep: ${brief.doel}
Aanbod: ${brief.aanbod}
USP's: ${brief.usps}
Geselecteerde angles:
${args.anglesStr}
Hooks: ${brief.hooksExtra || brief.hooksAM}${args.scriptContext ?? ""}

LP config:
- Stijl: ${args.stijl}
- Lengte: ${args.lengte}
- Meta Pixel ID: ${pixel}
- Zapier Webhook: ${webhook}
- UTM: ${utm}
${args.steering ? `\nExtra steering van de campaign manager (laat dit zwaar wegen): ${args.steering}\n` : ""}
BELANGRIJK: De landingspagina moet een ALGEMENE, overkoepelende benadering hebben die aansluit op ALLE geselecteerde angles. Niet focussen op één angle maar de kernboodschap zo formuleren dat bezoekers vanuit elke invalshoek (${angleNames}) zich herkennen in de pagina.

Specificeer hero sectie (breed ingestoken), pijnpunten, aanbod+USP's${formProofSection}${longExtras}.
Technisch: Pixel fbq('init') + fbq('track','PageView') + fbq('track','Lead') on submit. Form POST naar ${webhook} met velden + UTM params uit URL.${GENERATION_RULES}`
}
