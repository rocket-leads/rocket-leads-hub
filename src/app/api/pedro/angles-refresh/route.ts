import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  runPedroRefresh,
  commonPromptPreamble,
  type RefreshEnvelope,
} from "@/lib/pedro/refresh-shared"

export const maxDuration = 120

/**
 * POST /api/pedro/angles-refresh - body: { clientId, days?: 30 }
 *
 * Pedro reads live Meta performance, identifies which angles are working
 * and which aren't, then proposes NEW angles to test that fit the
 * client's brand + ICP and ride patterns we've seen win in the same
 * vertical at other RL clients.
 *
 * Different from creative-refresh: that one iterates on the WINNING
 * ad's DNA; this one proposes ENTIRELY NEW angles to test alongside
 * (or to replace exhausted angles in the losers block).
 */

type AnglesProposal = {
  /** Short descriptive name for the angle - used as the proposal title in UI. */
  title: string
  /** 1-2 line description of the angle's core argument. */
  description: string
  /** What kind of customer pain / desire this angle hits. */
  hookCategory: string
  /** Concrete opener line(s) to seed the script in this angle. */
  openerExamples: string[]
  /** Why this angle is worth testing right now given the perf data. */
  why: string
}

export async function POST(req: NextRequest): Promise<NextResponse<RefreshEnvelope<AnglesProposal> | { error: string }>> {
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

  const result = await runPedroRefresh<AnglesProposal>({
    clientId,
    days,
    stage: "angles",
    noWinnersSummary: ({ days, loserCount, stats }) =>
      loserCount > 0
        ? `Geen winners in ${days}d window (avg CPL ${stats.avgCpl ? `€${stats.avgCpl.toFixed(2)}` : "-"}, ${loserCount} loser${loserCount === 1 ? "" : "s"}). Dit is precies het moment voor nieuwe angles - de huidige angles trekken niet. Pedro voorstelde geen nieuwe angles automatisch omdat winners + losers samen het signaal vormen; run angles-refresh nogmaals wanneer er minimaal 1 winner is, of doe de Onboard Angles flow van scratch.`
        : `Geen ads scoren als winner in ${days}d. Te weinig data om een richting te kiezen - kies een breder window of doe de Onboard Angles flow van scratch.`,
    buildPrompt: (ctx) => `Je bent Pedro, senior campaign manager bij Rocket Leads. Je bekijkt de live Meta performance van een klant en stelt NIEUWE ANGLES voor om te testen - niet itereren op winnaars, maar onontgonnen invalshoeken die de doelgroep van een andere kant raken.

${commonPromptPreamble(ctx)}
OPDRACHT:
Stel 3-5 NIEUWE angles voor (geen variaties op bestaande winnaars - die doet creative-refresh). Elke angle moet:
- Een fundamenteel andere invalshoek zijn dan wat de WINNERS hierboven al doen.
- Aansluiten bij de brief (zie "Eerdere brief" hierboven) en de cross-client patterns voor deze branche.
- Geen kopie zijn van angles uit "Eerdere angles" (die zijn al getest of lopen).
- Geen kopie zijn van wat de LOSERS deden - die hebben juist niet gewerkt.

PRINCIPES (knowledge/campaigns.md):
- Universele winnende angles: garantie, gratis-iets-van-waarde, prijslijst, financieel/ROI, uniek/revolutionair, schaarste, pijnpunten, branche-specifiek.
- Per branche werken specifieke angles (zie cross-client examples).
- NOOIT budget-verhoging aanbevelen.

ALLEEN JSON output (geen markdown, geen code fences), exact dit format:

{
  "summary": "1-2 zinnen overall observatie + advies (in NL). Wees direct, geen filler.",
  "proposals": [
    {
      "title": "Korte naam voor de angle (max 6 woorden, NL)",
      "description": "1-2 zinnen die de kern van de angle uitleggen (NL)",
      "hookCategory": "Welk pijnpunt/verlangen dit raakt (bv. 'financieel verlies', 'snelheid', 'schaarste', NL)",
      "openerExamples": ["Concrete opener-zin 1 (NL)", "Concrete opener-zin 2 (NL)", "Concrete opener-zin 3 (NL)"],
      "why": "1 zin: waarom juist deze angle nu het testen waard is gegeven de perf data en branche (NL)"
    }
  ]
}

Genereer 3-5 proposals. Alle tekst NL. Geen datums.`,
    parseProposals: (parsed) => {
      const proposals = Array.isArray(parsed.proposals)
        ? (parsed.proposals as AnglesProposal[]).filter((p) => p && typeof p === "object" && typeof p.title === "string")
        : []
      return { summary: parsed.summary ?? "", proposals }
    },
  })

  if (result.kind === "error") {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.response)
}
