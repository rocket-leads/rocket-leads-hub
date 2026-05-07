import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { auth } from "@/lib/auth"
import { loadPedroSystemPrompt } from "@/lib/pedro/knowledge"

interface ResearchInput {
  branche: string
  doelgroep: string
  propositie: string
  extraContext: string
}

interface MetaAd {
  title: string
  body: string
  accountName: string
  campaignName: string
}

// SDK reads ANTHROPIC_API_KEY from env automatically.
const anthropic = new Anthropic()

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

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const input = (await req.json()) as ResearchInput
    if (!input.branche?.trim()) {
      return NextResponse.json({ error: "Branche is verplicht" }, { status: 400 })
    }

    const allAds = await fetchRLMetaAds(req)
    const brancheLower = input.branche.toLowerCase()
    const branchKeywords = brancheLower.split(/[\s/&,-]+/).filter(Boolean)
    const relevantAds = allAds.filter((ad) => {
      const haystack = `${ad.accountName} ${ad.campaignName} ${ad.title} ${ad.body}`.toLowerCase()
      return branchKeywords.some((kw) => kw.length > 2 && haystack.includes(kw))
    })
    const adSample = (relevantAds.length > 0 ? relevantAds : allAds).slice(0, 12)
    const adRef = adSample.length > 0
      ? adSample.map((ad, i) =>
          `[Ad ${i + 1}] (${ad.accountName})\nTitel: "${ad.title}"\nBody: ${ad.body.substring(0, 350)}`
        ).join("\n\n")
      : "Geen RL Meta ads beschikbaar -- baseer op algemene branche kennis"

    const prompt = `Jij bent Pedro, senior campaign manager bij Rocket Leads NL. Je doet research naar wat werkt in deze branche.

ONDERZOEKSCONTEXT:
- Branche: ${input.branche}
- Doelgroep: ${input.doelgroep || "niet gespecificeerd"}
- Propositie: ${input.propositie || "niet gespecificeerd"}
${input.extraContext ? `- Extra context: ${input.extraContext}` : ""}

REFERENTIE -- Bestaande RL Meta ads in (vergelijkbare) branche:
${adRef}

OPDRACHT: Genereer een complete research-analyse die een campaign manager kan gebruiken als basis voor een nieuwe campagne in deze branche. Baseer je op:
1. De bestaande RL ads hierboven (als die in de branche zitten)
2. Algemene best practices voor lead generation Meta ads in deze sector
3. Patronen die je herkent bij winnende ads in vergelijkbare niches

WEES SPECIFIEK:
- Geen algemene marketing-tips
- Wel concrete hooks, exacte zinnen, specifieke psychologische triggers
- Voorbeelden moeten direct bruikbaar zijn
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
      "source": "RL ad / branche best practice / vergelijkbare niche",
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

    return NextResponse.json({ research })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Research mislukt"
    console.error("Pedro research error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
