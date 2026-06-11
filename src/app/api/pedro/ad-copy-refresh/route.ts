import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  runPedroRefresh,
  commonPromptPreamble,
  type RefreshEnvelope,
} from "@/lib/pedro/refresh-shared"

export const maxDuration = 120

/**
 * POST /api/pedro/ad-copy-refresh - body: { clientId, days?: 30 }
 *
 * For each winning ad, propose fresh AD COPY variants - Meta primary text,
 * headlines and descriptions - that align with the winning angle but
 * read differently in the feed.
 */

type AdCopyVariant = {
  /** Short label (e.g. "Variant A - Korter & scherper"). */
  label: string
  /** Full primary text (the text above the creative). Max ~125 woorden. */
  primaryText: string
  /** 1-line punchy headline (max ~40 chars). */
  headline: string
  /** Short description shown under the headline (max ~30 chars). */
  description: string
  /** 1 line - what's different from the original. */
  why: string
}

type AdCopyProposal = {
  basedOnAd: { adId: string; adName: string; cpl: number | null; verdict: string }
  preserve: { hook: string; angle: string; format: string }
  variants: AdCopyVariant[]
}

export async function POST(req: NextRequest): Promise<NextResponse<RefreshEnvelope<AdCopyProposal> | { error: string }>> {
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

  const result = await runPedroRefresh<AdCopyProposal>({
    clientId,
    days,
    stage: "ad-copy",
    noWinnersSummary: ({ days, loserCount, stats }) =>
      loserCount > 0
        ? `Geen winners in ${days}d window (avg CPL ${stats.avgCpl ? `€${stats.avgCpl.toFixed(2)}` : "-"}, ${loserCount} loser${loserCount === 1 ? "" : "s"}). Nieuwe copy op losers schrijven is verspilling - eerst nieuwe angles testen, dan copy schrijven op het winnende angle.`
        : `Geen ads scoren als winner in ${days}d. Te weinig data - kies een breder window of begin met de Onboard Ad-copy flow.`,
    buildPrompt: (ctx) => `Je bent Pedro, senior campaign manager bij Rocket Leads. Je bekijkt de live Meta performance van een klant en stelt NIEUWE AD COPY voor op de winnaars - Meta primary text + headlines + descriptions die in dezelfde angle landen maar fris lezen in de feed.

${commonPromptPreamble(ctx)}
OPDRACHT:
Voor ELKE winner uit de WINNERS lijst (max 3 winners):
- Identificeer de DNA: hook-stijl, marketing angle, format.
- Schrijf 3 NIEUWE ad-copy varianten in dezelfde angle. Andere primary-text opener, andere zinsbouw, frisse CTA. Headlines + descriptions zijn primary-aligned (lezen als één campagne).
- Geen kopie van copy uit "Eerdere ad-copy" hierboven.
- Geen kopie van losers.

PRINCIPES (knowledge/campaigns.md):
- Primary text: korte alineas, max ~125 woorden, eerste regel = scroll-stopper.
- Headlines: max ~40 chars, één concrete claim of vraag.
- Descriptions: max ~30 chars, ondersteunt de headline.
- Geen overdrijving die Meta keurt af (vermijd "te mooi om waar te zijn" claims voor finance/medical).

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
        "hook": "hook-stijl die behouden moet blijven",
        "angle": "marketing angle",
        "format": "format"
      },
      "variants": [
        {
          "label": "Variant A - korte beschrijvende naam",
          "primaryText": "Volledige primary text (NL, max ~125 woorden)",
          "headline": "Headline (NL, max ~40 chars)",
          "description": "Description (NL, max ~30 chars)",
          "why": "1 zin: waarom deze variant in dezelfde DNA past maar fris leest"
        }
      ]
    }
  ]
}

Genereer 1-3 proposals (1 per winner). Per proposal: 3 varianten. Alle tekst NL. Geen datums.`,
    parseProposals: (parsed) => {
      const proposals = Array.isArray(parsed.proposals)
        ? (parsed.proposals as AdCopyProposal[]).filter(
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
