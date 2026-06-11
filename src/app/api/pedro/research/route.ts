import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { auth } from "@/lib/auth"
import { loadPedroSystemPrompt } from "@/lib/pedro/knowledge"
import {
  findCompetitors,
  scrapeWinningAds,
  type CompetitorSuggestion,
} from "@/lib/onboarding/competitor-research"
import { createAdminClient } from "@/lib/supabase/server"

interface ResearchInput {
  branche: string
  doelgroep: string
  propositie: string
  extraContext: string
  /** When set, the route uses this client to scope competitor scrape
   *  output (writes to `client_competitor_ads` and pulls top winners
   *  back from that table). Without it, the route falls back to
   *  RL-Meta-only research (legacy behaviour). */
  clientId?: string
  /** Used by the competitor flow to anchor the geographic scope of
   *  both the AI suggestions and the Apify scraper. Defaults to NL. */
  country?: string
  /** Opt-in: include Apify competitor scrape in the research pipeline.
   *  CM toggles this on per run - defaults off in the API so accidental
   *  re-runs don't burn Apify credits. The UI defaults it ON when a
   *  client is selected. */
  includeCompetitors?: boolean
  /** Optional - the client's own company name to exclude from
   *  competitor suggestions. We fall back to the brand in `klantnaam`
   *  context when the caller doesn't pass one. */
  ownCompanyName?: string
}

interface MetaAd {
  title: string
  body: string
  accountName: string
  campaignName: string
}

interface TopScrapedAd {
  competitor_name: string
  headline: string | null
  body: string | null
  cta_text: string | null
  creative_type: string | null
  creative_preview_url: string | null
  days_running: number | null
}

// SDK reads ANTHROPIC_API_KEY from env automatically.
const anthropic = new Anthropic()

// Research generation now optionally orchestrates a full Apify scrape
// on top of the existing synthesis pass - that can run 60-180s
// end-to-end for 5 competitors. Bumped the ceiling so the synthesis
// call survives even when the scrape is slow.
export const maxDuration = 300

async function fetchRLMetaAds(req: NextRequest): Promise<MetaAd[]> {
  try {
    const url = new URL("/api/pedro/meta/campaigns", req.nextUrl.origin)
    // Forward the auth cookie so the inner endpoint accepts the request.
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { cookie: req.headers.get("cookie") ?? "" },
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.ads || []).slice(0, 30) as MetaAd[]
  } catch {
    return []
  }
}

/**
 * Fetch the top-N currently-running competitor ads for a client, ordered
 * by `days_running desc` (longer-running ≈ winning bias, since Meta
 * keeps spending on the ones that convert). Caller has already written
 * the scrape; this just reads back the sorted slice that goes into the
 * Pedro synthesis prompt.
 */
async function fetchTopScrapedAds(
  clientId: string,
  limit = 12,
): Promise<TopScrapedAd[]> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("client_competitor_ads")
    .select(
      "competitor_name, headline, body, cta_text, creative_type, creative_preview_url, days_running, was_active_at_scrape",
    )
    .eq("monday_item_id", clientId)
    .eq("was_active_at_scrape", true)
    .order("days_running", { ascending: false, nullsFirst: false })
    .limit(limit)
  return (data ?? []) as TopScrapedAd[]
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const input = (await req.json()) as ResearchInput
    if (!input.branche?.trim()) {
      return NextResponse.json({ error: "Branche is verplicht" }, { status: 400 })
    }

    // ── Phase 1 (optional): competitor discovery + Apify scrape ──
    // Runs in the background of "Start research"; CM sees a progress
    // indicator. The synthesis prompt below picks up whatever this
    // produced so the research is grounded in actual live competitor
    // ads, not just RL's own + branche-generics.
    let competitors: CompetitorSuggestion[] = []
    let topScrapedAds: TopScrapedAd[] = []
    let competitorScrapeError: string | null = null
    const country = (input.country || "NL").toUpperCase()
    if (input.includeCompetitors && input.clientId) {
      try {
        competitors = await findCompetitors({
          ownCompanyName: input.ownCompanyName ?? "",
          country,
          sector: input.branche,
          doelgroep: input.doelgroep,
          aanbod: input.propositie,
          usps: input.extraContext,
        })
        if (competitors.length > 0) {
          await scrapeWinningAds({
            mondayItemId: input.clientId,
            competitors,
            country,
            maxAdsPerCompetitor: 20,
          })
          topScrapedAds = await fetchTopScrapedAds(input.clientId, 12)
        }
      } catch (e) {
        // Soft failure: surface the message but still run synthesis
        // with whatever we have (RL ads alone). Forcing the whole
        // request to 500 because Apify hiccup'd would burn the CM's
        // existing context unnecessarily.
        competitorScrapeError = e instanceof Error ? e.message : "Competitor scrape mislukt"
        console.error("[pedro/research] competitor flow failed:", competitorScrapeError)
      }
    }

    // ── RL Meta ads - same logic as before, used either as primary
    // reference (no competitor flow) or as supplementary signal
    // (combined with scraped competitor ads). ──
    const allAds = await fetchRLMetaAds(req)
    const brancheLower = input.branche.toLowerCase()
    const branchKeywords = brancheLower.split(/[\s/&,-]+/).filter(Boolean)
    const relevantAds = allAds.filter((ad) => {
      const haystack = `${ad.accountName} ${ad.campaignName} ${ad.title} ${ad.body}`.toLowerCase()
      return branchKeywords.some((kw) => kw.length > 2 && haystack.includes(kw))
    })
    const adSample = (relevantAds.length > 0 ? relevantAds : allAds).slice(0, 12)
    const rlAdRef = adSample.length > 0
      ? adSample.map((ad, i) =>
          `[RL Ad ${i + 1}] (${ad.accountName})\nTitel: "${ad.title}"\nBody: ${ad.body.substring(0, 350)}`
        ).join("\n\n")
      : "Geen RL Meta ads beschikbaar"

    const competitorAdRef = topScrapedAds.length > 0
      ? topScrapedAds.map((ad, i) =>
          `[Concurrent ${i + 1}] ${ad.competitor_name}${ad.days_running ? ` (${ad.days_running}d live)` : ""}\n` +
          `Titel: "${ad.headline ?? "-"}"\n` +
          `Body: ${(ad.body ?? "").substring(0, 350)}\n` +
          `CTA: ${ad.cta_text ?? "-"}`
        ).join("\n\n")
      : null

    const competitorSummary = competitors.length > 0
      ? competitors.map((c) => `- ${c.name}: ${c.relevance}`).join("\n")
      : null

    // ── Pedro synthesis ──
    // Adapt the prompt to whichever context is available. Competitor
    // ads take precedence as "winning patterns we want to mirror"; RL
    // ads stay as the proof-of-house-voice signal.
    const prompt = `Jij bent Pedro, senior campaign manager bij Rocket Leads NL. Je doet research naar wat werkt in deze branche.

ONDERZOEKSCONTEXT:
- Branche: ${input.branche}
- Doelgroep: ${input.doelgroep || "niet gespecificeerd"}
- Propositie: ${input.propositie || "niet gespecificeerd"}
- Land: ${country}
${input.extraContext ? `- Extra context: ${input.extraContext}` : ""}

${competitorSummary ? `CONCURRENTEN GEVONDEN (Claude + Apify scrape):\n${competitorSummary}\n` : ""}
${competitorAdRef ? `LIVE WINNING ADS VAN DEZE CONCURRENTEN (Apify scrape, geordend op days_running desc - longer-running = sterker signaal):\n${competitorAdRef}\n` : ""}
REFERENTIE -- Bestaande RL Meta ads in (vergelijkbare) branche:
${rlAdRef}

OPDRACHT: Genereer een complete research-analyse die een campaign manager kan gebruiken als basis voor een nieuwe campagne in deze branche. Baseer je op:
${competitorAdRef ? "1. De LIVE concurrent ads hierboven - dit is het sterkste signaal: deze advertenties draaien al langer en zijn dus winners.\n2. De bestaande RL ads als context voor RL's huisstijl.\n3. Algemene best practices voor lead generation Meta ads in deze sector." : "1. De bestaande RL ads hierboven (als die in de branche zitten).\n2. Algemene best practices voor lead generation Meta ads in deze sector.\n3. Patronen die je herkent bij winnende ads in vergelijkbare niches."}

WEES SPECIFIEK:
- Geen algemene marketing-tips
- Wel concrete hooks, exacte zinnen, specifieke psychologische triggers
- ${competitorAdRef ? "Citeer waar mogelijk de werkelijke hooks/headlines uit de live concurrent ads" : "Voorbeelden moeten direct bruikbaar zijn"}
- Insights moeten anders zijn dan "wees authentiek" -- echte tactische observaties

ALLEEN JSON output (geen markdown, geen code fences), exact dit format:

{
  "branche": "${input.branche}",
  "doelgroep": "${input.doelgroep}",
  "propositie": "${input.propositie}",
  "insights": {
    "winningAngles": ["3-5 concrete winnende angles voor deze branche"],
    "commonHooks": ["3-5 type hooks die bewezen werken (bv. 'urgentie zonder datum: Niet meer dan X betalen voor Y')"],
    "visualPatterns": ["3-5 visuele patronen (bv. voor/na, before/after met arrow, person POV)"],
    "cta_styles": ["3-5 CTA voorbeelden in deze branche"],
    "pricingStrategies": ["2-4 manieren waarop deze branche prijs communiceert"],
    "socialProofTactics": ["2-4 social proof tactieken specifiek voor deze branche"]
  },
  "exampleAds": [
    {
      "title": "Korte ad title",
      "body": "Volledige ad copy 80-120 woorden in Nederlands die je zou maken voor een fictieve klant in deze branche, gebaseerd op de winnende patronen",
      "hook": "De openings-hook van deze ad",
      "source": "RL ad / concurrent ad / branche best practice",
      "insight": "Waarom deze ad werkt (1 zin)"
    }
  ],
  "recommendations": [
    "5-7 concrete aanbevelingen voor een nieuwe campagne in deze branche, op basis van de research"
  ]
}

Genereer 4-6 voorbeeld ads. Alle tekst in het Nederlands. Valuta in €.`

    const system = await loadPedroSystemPrompt()
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: prompt }],
    })

    const text = message.content[0].type === "text" ? message.content[0].text : ""
    const cleaned = text.replace(/```json|```/g, "").trim()

    let research
    try {
      research = JSON.parse(cleaned)
    } catch (parseErr) {
      console.error("Pedro research JSON parse failed:", parseErr, "Raw:", cleaned.substring(0, 500))
      return NextResponse.json(
        { error: "Pedro gaf een ongeldig antwoord terug -- probeer opnieuw" },
        { status: 500 }
      )
    }

    // Attach the competitor enrichment to the response so the UI can
    // render the new "Concurrenten" + "Top live ads" sections. Empty
    // arrays when the CM didn't run the scrape - UI skips those blocks.
    research.competitors = competitors.map((c) => ({
      name: c.name,
      relevance: c.relevance,
      facebookPageUrl: c.facebookPageUrl ?? null,
      websiteUrl: c.websiteUrl ?? null,
    }))
    research.topCompetitorAds = topScrapedAds
    if (competitorScrapeError) {
      research.competitorScrapeWarning = competitorScrapeError
    }

    return NextResponse.json({ research })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Research mislukt"
    console.error("Pedro research error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
