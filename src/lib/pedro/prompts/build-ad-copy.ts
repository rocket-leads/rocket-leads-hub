import { GENERATION_RULES, type BriefData } from "@/lib/pedro/helpers"

/**
 * Stage 6: Meta ad copy prompt.
 *
 * Generates two primary-text variants, 5 headlines (≤40 chars each),
 * and 2 descriptions (≤25 words each). Output is JSON matching
 * `AdCopy` for direct parseJSON consumption.
 *
 * The LP context - when present - is injected so the ad copy lands on
 * the same kernboodschap as the landing page. Mismatches between ad
 * promise and LP delivery destroy conversion rates more than any
 * single creative variable.
 */

export type AdCopyPromptArgs = {
  brief: BriefData
  /** Pre-rendered angles list. */
  anglesStr: string
  /** Already-rendered video-script context block (empty when script skipped). */
  scriptContext?: string
  /** First ~600 chars of the LP prompt - used to align ad-copy to LP. */
  lpPrompt?: string
  /** First ~600 chars of the Manus creatives prompt - added 2026-05-22.
   *  Ad copy now reads both LP + creatives so the headlines + primary
   *  text match the visual promise the user clicks through on Meta. */
  creativesContext?: string
  /** Style reference from existing Rocket Leads Meta ads. */
  styleRef?: string
  /** Huisstijl block. */
  huisstijl?: string
  /** Free-text steering from the CM - e.g. "korter, scherper",
   *  "minder corporate". Layered on top of the standard prompt. */
  steering?: string
}

export function buildAdCopyPrompt(args: AdCopyPromptArgs): string {
  const { brief } = args
  const lpContext = args.lpPrompt
    ? `\nLandingspagina context (match hierop!):\n${args.lpPrompt.substring(0, 600)}`
    : ""
  const creativesContext = args.creativesContext
    ? `\nCreatives context (headlines + primary text MOETEN aansluiten op deze visuele richting):\n${args.creativesContext.substring(0, 600)}`
    : ""
  const steeringBlock = args.steering
    ? `\n\nExtra steering van de campaign manager (laat dit zwaar wegen): ${args.steering}`
    : ""

  return `Jij bent Pedro, senior campaign manager bij Rocket Leads. Schrijf Meta advertentieteksten.

Client: ${brief.bedrijf} (${brief.sector})
Doelgroep: ${brief.doel}
Aanbod: ${brief.aanbod}
USP's: ${brief.usps}
Geselecteerde angles:
${args.anglesStr}
Extra hooks CM: ${brief.hooksExtra || "geen"}${args.scriptContext ?? ""}${lpContext}${creativesContext}${steeringBlock}

BELANGRIJK: De ad copy moet EXACT aansluiten op zowel de landingspagina als de visuele creatives. Gebruik dezelfde kernboodschap, voordelen, headlines en CTA zodat de bezoeker - vanaf de scroll-stoppende creative tot na de klik op de LP - één consistent verhaal beleeft.

Schrijf copy die alle geselecteerde angles dekt - wissel per variant van invalshoek:
1. Primaire tekst variant A (120-150 woorden, angle 1 als leidraad, conversational, CTA)
2. Primaire tekst variant B (100-130 woorden, andere angle als leidraad, andere toon)
3. 5 headlines max 40 tekens - mix de verschillende angles
4. 2 beschrijvingen max 25 woorden

ALLEEN JSON: {"variantA":"...","variantB":"...","headlines":"h1\\nh2\\nh3\\nh4\\nh5","beschrijving":"v1\\nv2"}${GENERATION_RULES}${args.styleRef ?? ""}${args.huisstijl ?? ""}`
}
