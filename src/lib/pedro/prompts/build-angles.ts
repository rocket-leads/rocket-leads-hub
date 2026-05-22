import { GENERATION_RULES, type BriefData, type Angle } from "@/lib/pedro/helpers"

/**
 * Stage 2: marketing-angles prompt.
 *
 * Produces N marketing angles with different psychological triggers
 * (default N=5; smaller N when regenerating a subset). Optionally
 * seeded with branche-specific research (winning angles + hook
 * patterns) so Pedro builds on what's worked instead of starting cold.
 *
 * Output contract: pure JSON array of N `Angle` objects. The component
 * `parseJSON<Angle[]>` consumes this directly. CM may regenerate a
 * subset by passing `count` + `keepAngles` (the angles already on the
 * board that should NOT be repeated) + optional `steering` note.
 */

export type AnglesPromptArgs = {
  brief: BriefData
  /** Comma/list block from research stage — "Winnende angles in deze branche", "Hook-patronen". Optional. */
  researchContext?: string
  /** Style reference from existing Rocket Leads Meta ads. Optional. */
  styleRef?: string
  /** Huisstijl block from website analysis or manual paste. Optional. */
  huisstijl?: string
  /** How many angles to generate. Defaults to 5 (full set). When the
   *  CM picks "regenerate selected", this is the count of selected. */
  count?: number
  /** Existing angles the CM wants to KEEP — used as a "vermijd deze
   *  invalshoeken, kom met iets anders" block so the regenerated set
   *  doesn't repeat what's already on the board. */
  keepAngles?: Angle[]
  /** Free-text steering from the CM — e.g. "maak ze harder
   *  confronterend" or "meer richting AI/automatisering". */
  steering?: string
}

export function buildAnglesPrompt(args: AnglesPromptArgs): string {
  const { brief } = args
  const count = Math.max(1, Math.min(args.count ?? 5, 10))
  const extraHooks = brief.hooksExtra
    ? `\nExtra hooks campaign manager (prioriteit): ${brief.hooksExtra}`
    : ""

  const keepBlock =
    args.keepAngles && args.keepAngles.length > 0
      ? `\n\nDe volgende angles staan al op het bord. Vermijd deze invalshoeken — kom met iets nieuws dat niet overlapt:\n${args.keepAngles
          .map((a) => `- "${a.titel}" — ${a.beschrijving}`)
          .join("\n")}`
      : ""

  const steeringBlock = args.steering
    ? `\n\nExtra steering van de campaign manager (laat dit zwaar wegen): ${args.steering}`
    : ""

  return `Jij bent Pedro, senior campaign manager bij Rocket Leads NL. B2C lead gen campagnes voor Meta.

Client:
- Bedrijf: ${brief.bedrijf} (${brief.sector})
- Doelgroep: ${brief.doel}
- Pijnpunt: ${brief.pijn}
- Aanbod: ${brief.aanbod}
- USP's: ${brief.usps}
- Hooks kick-off: ${brief.hooksAM}${extraHooks}${args.researchContext ?? ""}${keepBlock}${steeringBlock}

Genereer precies ${count} marketing angle${count === 1 ? "" : "s"}. Varieer in psychologische trigger (urgentie, angst, autoriteit, social proof, nieuwsgierigheid, etc.).
ALLEEN JSON, een array van ${count} object${count === 1 ? "" : "en"} in dit formaat:
[{"nummer":1,"titel":"naam","beschrijving":"2 zinnen uitleg"}${count > 1 ? ",..." : ""}]${GENERATION_RULES}${args.styleRef ?? ""}${args.huisstijl ?? ""}`
}
