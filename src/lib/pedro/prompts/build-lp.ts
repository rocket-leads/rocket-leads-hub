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
  /** Free-text steering from the CM - e.g. "minder klaagverhaal,
   *  meer urgentie", "korter onder de fold". Layered on top of the
   *  standard prompt. */
  steering?: string
}

export type LpOptimizeArgs = {
  brief: BriefData
  selectedAngles: Angle[]
  anglesStr: string
  huisstijl?: string
  /** Cleaned-up text content of the existing LP (homepage scrape). */
  currentLpText: string
  /** The actual URL the CM pasted - quoted in the prompt so Pedro
   *  can reference it. */
  currentLpUrl: string
  /** Free-text "what should change" from the CM. Required for this mode. */
  steering: string
  pixelId?: string
  webhookUrl?: string
  utmStr?: string
}

/**
 * Stage 5b: Lovable LP optimization prompt.
 *
 * Different from `buildLpPrompt`: instead of building from a brief, this
 * one takes the EXISTING live LP as the starting point and asks Pedro
 * to generate a Lovable prompt that recreates the page with the CM's
 * requested changes baked in. Use this whenever a client already has a
 * live LP — the brief is still passed for tone/ICP continuity, but the
 * existing page is the structural anchor.
 */
export function buildLpOptimizePrompt(args: LpOptimizeArgs): string {
  const { brief } = args
  const pixel = args.pixelId || "niet opgegeven"
  const webhook = args.webhookUrl || "niet opgegeven"
  const utm = args.utmStr || "utm_source=meta&utm_medium=paid"
  const angleNames = args.selectedAngles.map((a) => a.titel).join(", ") || "n.v.t."

  return `Jij bent Pedro bij Rocket Leads. Genereer een volledige Lovable prompt die de HUIDIGE landingspagina van de klant nabouwt met de gevraagde aanpassingen.
${args.huisstijl ?? ""}

Client: ${brief.bedrijf} (${brief.sector})
Doelgroep: ${brief.doel}
Aanbod: ${brief.aanbod}
USP's: ${brief.usps}
${args.selectedAngles.length ? `Geselecteerde angles (${angleNames}):\n${args.anglesStr}\n` : ""}
HUIDIGE LANDINGSPAGINA — ${args.currentLpUrl}
Hieronder een uitgelezen tekst van de huidige live LP. Gebruik dit als structurele basis (hero, secties, copy-richting, CTA-positionering). Behoud wat werkt, los op wat de CM aangeeft te willen veranderen.
---
${args.currentLpText}
---

WAT DE CM WIL VERBETEREN (laat dit ZWAAR wegen):
${args.steering}

Technisch:
- Meta Pixel ID: ${pixel} - fbq('init') + fbq('track','PageView') + fbq('track','Lead') on submit
- Zapier webhook: ${webhook} - form POST naar deze URL met form-velden + UTM params uit URL
- UTM: ${utm}

INSTRUCTIES:
1. Begin met "Recreate the landing page at ${args.currentLpUrl}" als anker.
2. Spec hero / pijnpunten / aanbod+USP's / social proof / leadformulier zoals nu, OF zoals de CM vraagt te veranderen.
3. Bewaar conversie-elementen die op de huidige pagina staan (bv. specifieke trust badges, getallen, garantie-vermelding) tenzij de CM expliciet vraagt om weg te halen.
4. Bouw de gevraagde aanpassingen ONLY in - niet ongevraagd nieuwe secties bij verzinnen.
5. Houd het visueel in lijn met de brand-style (zie huisstijl boven).${GENERATION_RULES}`
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
