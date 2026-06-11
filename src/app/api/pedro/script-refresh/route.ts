import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  runPedroRefresh,
  commonPromptPreamble,
  type RefreshEnvelope,
} from "@/lib/pedro/refresh-shared"

export const maxDuration = 120

/**
 * POST /api/pedro/script-refresh - body: { clientId, days?: 30 }
 *
 * For each winning ad, propose fresh video script variations on the
 * winning hook. Different from creative-refresh: creative-refresh is
 * lighter (hook + outline + primary copy snippet); this one writes full
 * 60s UGC-style scripts that the videograaf can shoot from.
 */

type ScriptVariant = {
  /** Short label so the CM can refer to the variant (e.g. "Variant A - Verlies-confrontatie"). */
  label: string
  /** 3-5s opener - the actual line spoken in the first frames. */
  hook: string
  /** Full 50-70 second UGC-style script with stage directions in [brackets]. */
  fullScript: string
  /** 1 line - what's different from the original winner script. */
  why: string
}

type ScriptProposal = {
  basedOnAd: { adId: string; adName: string; cpl: number | null; verdict: string }
  /** What of the winning ad we're keeping. */
  preserve: { hook: string; angle: string; format: string }
  variants: ScriptVariant[]
}

export async function POST(req: NextRequest): Promise<NextResponse<RefreshEnvelope<ScriptProposal> | { error: string }>> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { clientId?: string; days?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const clientId = String(body.clientId ?? "")
  const days = Math.max(7, Math.min(body.days ?? 30, 90))
  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }

  const result = await runPedroRefresh<ScriptProposal>({
    clientId,
    days,
    stage: "script",
    noWinnersSummary: ({ days, loserCount, stats }) =>
      loserCount > 0
        ? `Geen winners in ${days}d window (avg CPL ${stats.avgCpl ? `€${stats.avgCpl.toFixed(2)}` : "-"}, ${loserCount} loser${loserCount === 1 ? "" : "s"}). Nieuwe scripts op losers schrijven is verspilling - eerst een nieuwe angle testen via angles-refresh, dan scripts schrijven op het winnende angle.`
        : `Geen ads scoren als winner in ${days}d. Te weinig data - kies een breder window of begin met de Onboard Script flow.`,
    buildPrompt: (ctx) => `Je bent Pedro, senior campaign manager bij Rocket Leads. Je bekijkt de live Meta performance van een klant en stelt NIEUWE VIDEO SCRIPTS voor op de winnaars - volledig uitgeschreven UGC-style scripts (50-70 sec) die de videograaf direct kan opnemen, in dezelfde hook-DNA als de winnaar maar met verse executies.

${commonPromptPreamble(ctx)}
OPDRACHT:
Voor ELKE winner uit de WINNERS lijst (max 3 winners om scope behapbaar te houden):
- Identificeer de DNA: wat is de hook-stijl, de marketing angle, het format.
- Schrijf 3 NIEUWE volledige scripts die in dezelfde richting itereren - zelfde hook-categorie, zelfde angle, zelfde format. Andere opener-zin, andere body, frisse CTA.
- Scripts zijn volledig uitgeschreven (50-70 sec gesproken NL), met [stage directions] in brackets (bv. [close-up gezicht], [B-roll: showroom], [text overlay: "€2.500 bespaard"]).
- Geen kopie van scripts uit "Eerdere script" hierboven.
- Geen kopie van losers - die hebben juist niet gewerkt.

PRINCIPES (knowledge/campaigns.md):
- Hook in eerste 3 seconden moet het scrollen doorbreken.
- Structuur: hook → probleem → oplossing/positionering → social proof → CTA.
- Pijnpunten + financieel verlies + AI/technologie + branche-specifieke openers werken het best (zie knowledge base).
- Speak NL, korte zinnen.

ALLEEN JSON output (geen markdown, geen code fences), exact dit format:

{
  "summary": "1-2 zinnen overall observatie + advies (in NL). Wees direct, geen filler.",
  "proposals": [
    {
      "basedOnAd": {
        "adId": "exact ad_id van de winner",
        "adName": "exacte naam zoals in de WINNERS-lijst",
        "cpl": <number of null>,
        "verdict": "winner"
      },
      "preserve": {
        "hook": "hook-stijl die behouden moet blijven (bv. 'pijnpunt-opener')",
        "angle": "marketing angle (bv. 'subsidie-savings')",
        "format": "format (bv. 'AI avatar talking-head 9:16')"
      },
      "variants": [
        {
          "label": "Variant A - korte beschrijvende naam",
          "hook": "concrete opener-zin in NL (3-5 sec)",
          "fullScript": "volledig script (50-70 sec gesproken), met [stage directions] in brackets, in NL, één doorlopende tekst met regeleinden",
          "why": "1 zin: waarom deze variant in dezelfde DNA past maar fris is"
        }
      ]
    }
  ]
}

Genereer 1-3 proposals (1 per winner). Per proposal: 3 varianten. Alle tekst NL. Geen datums.`,
    parseProposals: (parsed) => {
      const proposals = Array.isArray(parsed.proposals)
        ? (parsed.proposals as ScriptProposal[]).filter(
            (p) => p && typeof p === "object" && p.basedOnAd && Array.isArray(p.variants),
          )
        : []
      return { summary: parsed.summary ?? "", proposals }
    },
  })

  if (result.kind === "error") {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.response)
}
