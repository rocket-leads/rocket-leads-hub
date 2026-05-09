import { GENERATION_RULES, type BriefData } from "@/lib/pedro/helpers"

/**
 * Stage 2: marketing-angles prompt.
 *
 * Produces 5 marketing angles with different psychological triggers.
 * Optionally seeded with branche-specific research (winning angles +
 * hook patterns) so Pedro builds on what's worked instead of starting
 * cold every campaign.
 *
 * Output contract: pure JSON array of 5 `Angle` objects. The component
 * `parseJSON<Angle[]>` consumes this directly.
 */

export type AnglesPromptArgs = {
  brief: BriefData
  /** Comma/list block from research stage — "Winnende angles in deze branche", "Hook-patronen". Optional. */
  researchContext?: string
  /** Style reference from existing Rocket Leads Meta ads. Optional. */
  styleRef?: string
  /** Huisstijl block from website analysis or manual paste. Optional. */
  huisstijl?: string
}

export function buildAnglesPrompt(args: AnglesPromptArgs): string {
  const { brief } = args
  const extraHooks = brief.hooksExtra
    ? `\nExtra hooks campaign manager (prioriteit): ${brief.hooksExtra}`
    : ""

  return `Jij bent Pedro, senior campaign manager bij Rocket Leads NL. B2C lead gen campagnes voor Meta.

Client:
- Bedrijf: ${brief.bedrijf} (${brief.sector})
- Doelgroep: ${brief.doel}
- Pijnpunt: ${brief.pijn}
- Aanbod: ${brief.aanbod}
- USP's: ${brief.usps}
- Hooks kick-off: ${brief.hooksAM}${extraHooks}${args.researchContext ?? ""}

Genereer precies 5 marketing angles. Varieer in psychologische trigger (urgentie, angst, autoriteit, social proof, nieuwsgierigheid, etc.).
ALLEEN JSON:
[{"nummer":1,"titel":"naam","beschrijving":"2 zinnen uitleg"},{"nummer":2,"titel":"...","beschrijving":"..."},{"nummer":3,"titel":"...","beschrijving":"..."},{"nummer":4,"titel":"...","beschrijving":"..."},{"nummer":5,"titel":"...","beschrijving":"..."}]${GENERATION_RULES}${args.styleRef ?? ""}${args.huisstijl ?? ""}`
}
