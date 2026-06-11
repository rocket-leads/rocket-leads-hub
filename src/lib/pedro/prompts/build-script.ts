import { GENERATION_RULES, type BriefData } from "@/lib/pedro/helpers"

/**
 * Stage 3: video-script prompt.
 *
 * Generates 2 UGC-stijl video ad scripts with sterk verschillende
 * psychologische triggers. Output is a fixed-format text block (not
 * JSON) - `parseScriptText` in generate-script-docx then carves it
 * into per-video hooks/body/CTA.
 *
 * Held to a strict layout because the parser keys off `---` separators
 * and "Hook 1:"-style line prefixes. Don't reformat the EXACT DIT FORMAT
 * block without updating the parser.
 */

export type ScriptPromptArgs = {
  brief: BriefData
  /** Pre-rendered list of selected angles. */
  anglesStr: string
  styleRef?: string
  huisstijl?: string
  /** Free-text steering from the CM - e.g. "harder confronterend",
   *  "minder cliché, meer concrete cijfers". Layered on top of the
   *  standard prompt. */
  steering?: string
}

export function buildScriptPrompt(args: ScriptPromptArgs): string {
  const { brief } = args
  const steeringBlock = args.steering
    ? `\n\nExtra steering van de campaign manager (laat dit zwaar wegen): ${args.steering}`
    : ""
  return `Jij bent Pedro, senior campaign manager bij Rocket Leads. Schrijf 2 UGC-stijl video ad scripts.

Client: ${brief.bedrijf} (${brief.sector})
Doelgroep: ${brief.doel}
Aanbod: ${brief.aanbod}
USP's: ${brief.usps}
Geselecteerde angles:
${args.anglesStr}
Extra hooks CM: ${brief.hooksExtra || "geen"}${steeringBlock}

REGELS:
- Video 1 en Video 2 moeten STERK VERSCHILLENDE psychologische triggers gebruiken (bv. urgentie vs. social proof, pijn vs. ambitie, angst vs. nieuwsgierigheid)
- Hooks moeten provocerend, confronterend of verrassend zijn - NIET generiek
- Body max 5 zinnen - geen informatiedump, net genoeg om te klikken
- Social proof in body moet specifiek en realistisch voelen, gebruik sectorspecifieke cijfers
- Schrijf in dezelfde taal als de input van de klant

OUTPUT EXACT DIT FORMAAT (geen markdown, geen extra uitleg):

---
VIDEO 1 - [Angle naam]

Hook 1: "..."
Hook 2: "..."
Hook 3: "..."
Hook 4: "..."
Hook 5: "..."

Body:
[Gesproken tekst van de video, 3-5 zinnen. Pakkend, geen informatiedump. Doel is klikken, niet informeren. Eindig met social proof: "Terwijl [concurrent] nog [probleem], haalt [klant X] al [resultaat] binnen. Elke maand. Automatisch."]

CTA:
[1 zin. Laagdrempelig.]

---
VIDEO 2 - [Andere angle, andere invalshoek]

Hook 1: "..."
Hook 2: "..."
Hook 3: "..."
Hook 4: "..."
Hook 5: "..."

Body:
[Zelfde structuur, andere invalshoek]

CTA:
[Passend bij video 2]

---${GENERATION_RULES}${args.styleRef ?? ""}${args.huisstijl ?? ""}`
}
