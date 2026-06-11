import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaAdDetails } from "@/lib/integrations/meta"
import { cachedFetch } from "@/lib/cache"
import {
  computeAccountStats,
  scoreAd,
  renderAdsForPrompt,
  type ScoredAd,
} from "@/lib/pedro/performance"
import { loadPedroSystemPrompt } from "@/lib/pedro/knowledge"
import { pastContextForStage } from "@/lib/pedro/past-campaigns"
import {
  assignAdNamesToVariants,
  getMaxAdNumberByFormat,
  type AdFormatHint,
  type NamedProposal,
} from "@/lib/pedro/refresh-naming"
import { fanOutVariantsToTable } from "@/lib/pedro/variants"
import { buildVoiceCorpus } from "@/lib/pedro/voice-corpus"
import { buildCreativeRefreshContext } from "@/lib/pedro/creative-refresh-context"
import { fetchClientById } from "@/lib/integrations/monday"
import { analyzeAdsParallel } from "@/lib/pedro/ad-creative-vision"

// Creative refresh: full knowledge base + per-ad performance render +
// past-campaign context + 4000 output tokens. Routinely 40-90s on
// Sonnet 4. Without maxDuration Vercel kills at 10s and the CM sees a
// 504 HTML page instead of refresh proposals.
export const maxDuration = 120

/**
 * POST /api/pedro/creative-refresh
 *   body: { clientId, days?: 30 }
 *
 * Pedro's first concrete optimisation feature. Reads live Meta performance
 * for a client, identifies winners, and proposes 3-5 iterations on each
 * winner - same hook/angle/format DNA, fresh executions. Per knowledge/
 * campaigns.md this is the canonical move when something is winning:
 * never "let it run", always iterate to keep CPL low and avoid fatigue.
 *
 * Returns structured proposals so the UI can render each as a card the
 * CM reviews + ships. Stored output also becomes part of the client's
 * Pedro deliverable history for the next round.
 */

const anthropic = new Anthropic()

type Proposal = NamedProposal

type RefreshResponse =
  | {
      mode: "iterate-winners"
      /** Row id in pedro_refreshes - null when persistence failed; UI uses
       *  this to power Save-to-Inbox / Save-to-Drive (no id = no save). */
      refreshId: string | null
      clientId: string
      clientName: string
      window: { start: string; end: string; days: number }
      stats: {
        totalSpend: number
        totalLeads: number
        avgCpl: number | null
        avgCtr: number | null
        winnerCount: number
        loserCount: number
      }
      trend: {
        spendDeltaPct: number | null
        leadsDeltaPct: number | null
        cplDeltaPct: number | null
      }
      proposals: Proposal[]
      summary: string
      warnings: string[]
    }
  | {
      mode: "no-winners"
      clientId: string
      clientName: string
      window: { start: string; end: string; days: number }
      summary: string
      warnings: string[]
    }
  | { error: string }

function dateRange(days: number): { start: string; end: string } {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days + 1)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export async function POST(req: NextRequest): Promise<NextResponse<RefreshResponse>> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: {
    clientId?: string
    days?: number
    /** Roy 2026-06-10 ad-picker flow: wanneer set, skip de window-based
     *  auto-winner detection en itereer specifiek op deze ad. CM heeft
     *  'm gekozen uit de campagne-ad-picker (zie /api/pedro/campaigns-with-ads).
     *  Bypasst de fragiele "geen winners in window" leeg-state. */
    sourceAdId?: string
    /** Optionele Supabase Storage path van een handmatig-geüploade
     *  screenshot van de gekozen ad. Pedro gebruikt 'm als reference
     *  image bij image generation (vervangt of vult aan op Meta's
     *  thumbnail die voor veel dynamic creatives leeg is).
     *  Roy 2026-06-10. */
    sourceScreenshotPath?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const clientId = String(body.clientId ?? "")
  const days = 30 // Roy 2026-06-11: window-instellingen weg, flow is volledig handmatig
  const sourceAdId = body.sourceAdId?.trim() || ""
  const sourceScreenshotPath = body.sourceScreenshotPath?.trim() || ""
  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }
  // Roy 2026-06-11: sourceAdId is nu verplicht. De window-based auto-
  // winner-detection is verwijderd - CM kiest expliciet welke ad uit de
  // AdPicker hij wil itereren. Zonder gekozen ad is er geen refresh.
  if (!sourceAdId) {
    return NextResponse.json(
      {
        error:
          "Kies een specifieke ad uit de campagne-picker om een refresh te genereren.",
      },
      { status: 400 },
    )
  }

  // ── 1. Resolve client ──
  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("id, monday_item_id, name, meta_ad_account_id")
    .eq("monday_item_id", clientId)
    .maybeSingle()

  if (!client) return NextResponse.json({ error: "Klant niet gevonden in hub" }, { status: 404 })
  if (!client.meta_ad_account_id) {
    return NextResponse.json({ error: "Geen Meta ad account voor deze klant" }, { status: 400 })
  }

  // ── 1b. Hard brief gate (Roy 2026-06-09) ──
  // Without a baseline brief Pedro hallucinates business models - the
  // Zumex B2C smoothie flop showed this. Same completion bar as Pedro
  // Onboard: brief counts as filled when `bedrijf` AND `aanbod` are
  // both non-empty (see pedro-campaign.tsx:1822). 409 + structured
  // body lets the UI catch and open the inline brief modal without
  // bouncing the user to /pedro/onboard.
  //
  // Sources we consider valid:
  //   1. pedro_client_state.brief - live draft, primary source
  //   2. pedro_stage_versions (stage='brief') - saved snapshots
  // If only #2 has it (e.g. CM saved via Onboard's "Save final version"
  // but never updated the live draft), we lazy-sync into client_state
  // so subsequent runs hit the fast path + every other Pedro feature
  // sees it too.
  {
    const [briefRowRes, versionRowRes] = await Promise.all([
      supabase
        .from("pedro_client_state")
        .select("brief, campaign_number")
        .eq("client_id", clientId)
        .order("campaign_number", { ascending: false })
        .limit(1)
        .maybeSingle<{ brief: Record<string, unknown> | null; campaign_number: number }>(),
      supabase
        .from("pedro_stage_versions")
        .select("data, campaign_number")
        .eq("client_id", clientId)
        .eq("stage", "brief")
        .order("saved_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ data: Record<string, unknown> | null; campaign_number: number }>(),
    ])

    let brief = briefRowRes.data?.brief ?? null
    const versionBrief = versionRowRes.data?.data ?? null

    const isComplete = (b: Record<string, unknown> | null) => {
      const bedrijf = typeof b?.bedrijf === "string" ? b.bedrijf.trim() : ""
      const aanbod = typeof b?.aanbod === "string" ? b.aanbod.trim() : ""
      return bedrijf.length > 0 && aanbod.length > 0
    }

    // Lazy sync: live draft is empty/incomplete but a saved version
    // exists - promote it. Best-effort; if the upsert fails the gate
    // still blocks below.
    if (!isComplete(brief) && isComplete(versionBrief)) {
      try {
        await supabase
          .from("pedro_client_state")
          .upsert(
            {
              client_id: clientId,
              campaign_number: versionRowRes.data?.campaign_number ?? 1,
              brief: versionBrief,
            },
            { onConflict: "client_id,campaign_number" },
          )
        brief = versionBrief
      } catch (e) {
        console.error(
          "[creative-refresh] brief lazy-sync failed:",
          e instanceof Error ? e.message : e,
        )
      }
    }

    if (!isComplete(brief)) {
      const bedrijf = typeof brief?.bedrijf === "string" ? brief.bedrijf.trim() : ""
      const aanbod = typeof brief?.aanbod === "string" ? brief.aanbod.trim() : ""
      return NextResponse.json(
        {
          error: "Brief ontbreekt voor deze klant - vul eerst de creative briefing in.",
          requires_brief: true,
          clientId,
          clientName: client.name,
          // Echo back whichever brief we found (live draft OR latest
          // saved version) so the modal prefills whatever's there
          // rather than starting blank.
          current_brief: brief ?? versionBrief ?? null,
          missing_fields: [
            ...(!bedrijf ? ["bedrijf"] : []),
            ...(!aanbod ? ["aanbod"] : []),
          ],
        },
        { status: 409 },
      )
    }
  }

  // Roy 2026-06-10 BUG FIX: respecteer de campaign-selectie uit
  // `client_campaigns`. Eerder werden ALLE ads in het Meta account
  // gefetcht, ook als de CM in Beheer maar 1 van de 26 campagnes had
  // geselecteerd. Resultaat: winners uit niet-gerelateerde campagnes
  // (Tosti's uit Unox' campagne werd gepakt als Zumex-winner, terwijl
  // Zumex alleen "RL | Zumex NL | LF" geselecteerd had).
  const { data: selectedRows } = await supabase
    .from("client_campaigns")
    .select("meta_campaign_id")
    .eq("client_id", client.id)
    .eq("is_selected", true)
  const selectedCampaignIds = new Set<string>(
    (selectedRows ?? [])
      .map((r) => r.meta_campaign_id as string | null)
      .filter((id): id is string => !!id),
  )
  const campaignFilter = selectedCampaignIds.size > 0 ? selectedCampaignIds : undefined

  // ── 2. Pull current window (cached) + voice corpus window in parallel ──
  // Roy 2026-06-11: prior-window fetch + trend zijn volledig verwijderd
  // - proces is handmatig, geen vergelijking met "vorige periode" meer.
  // Cache key matcht campaigns-with-ads zodat AdPicker → Generate warm
  // door de cache loopt.
  //
  // Voice corpus window = 180 dagen. Klanten draaien vaak maar 2-3 ads
  // per maand; 30d is niet genoeg om de "stem" van de klant te kappen.
  // Dit is een aparte fetch - gefilterd op zelfde campagnes maar in een
  // breder venster, gecached onder eigen key.
  const cur = dateRange(days)
  const corpusStart = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 180)
    return d.toISOString().slice(0, 10)
  })()
  const filterTag = campaignFilter
    ? `:cf:${[...selectedCampaignIds].sort().join(",")}`
    : ""
  const [adsRaw, adsCorpusRaw] = await Promise.all([
    cachedFetch(
      `pedro_perf:${client.meta_ad_account_id}:${cur.start}:${cur.end}${filterTag}`,
      () => fetchMetaAdDetails(client.meta_ad_account_id, cur.start, cur.end, campaignFilter),
    ).catch(() => [] as Awaited<ReturnType<typeof fetchMetaAdDetails>>),
    cachedFetch(
      `pedro_corpus:${client.meta_ad_account_id}:${corpusStart}:${cur.end}${filterTag}`,
      () => fetchMetaAdDetails(client.meta_ad_account_id, corpusStart, cur.end, campaignFilter),
    ).catch(() => [] as Awaited<ReturnType<typeof fetchMetaAdDetails>>),
  ])
  const voiceCorpus = buildVoiceCorpus(adsCorpusRaw)

  const stats = computeAccountStats(adsRaw)
  // Trend kept as a no-op stub so envelope-readers van eerdere refreshes
  // niet crashen op een ontbrekend veld.
  const trend = { spendDeltaPct: null, leadsDeltaPct: null, cplDeltaPct: null }

  // Roy 2026-06-11: CM heeft een specifieke ad gekozen - die wordt
  // direct als enige "winner" behandeld. Geen verdict-scoring, geen
  // losers-vergelijking, geen "geen winners" leeg-state.
  const scored: ScoredAd[] = adsRaw.map((a) => scoreAd(a, stats.avgCpl))
  const picked = scored.find((a) => a.adId === sourceAdId)
  if (!picked) {
    return NextResponse.json(
      {
        error:
          "Gekozen ad niet meer gevonden in dit Meta account (laatste 30d). Mogelijk verwijderd; pak een andere ad uit de lijst.",
      },
      { status: 404 },
    )
  }
  const winners: ScoredAd[] = [{ ...picked, verdict: "winner" }]
  const losers: ScoredAd[] = [] // niet gebruikt in ad-picker prompt
  const warnings: string[] = [] // window-warnings horen bij oude auto-detect flow

  // ── 4. Compose the iterate-on-winners prompt ──
  // Pull past creatives for anti-repeat context + the brief for tone +
  // cross-client examples (same-vertical RL winners) so Pedro's
  // proposals are grounded in what already works in this niche.
  // Sector for cross-client lookup comes from the latest saved brief -
  // empty string if none, in which case we skip cross-client.
  const { data: stateRow } = await supabase
    .from("pedro_client_state")
    .select("brief")
    .eq("client_id", clientId)
    .order("campaign_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ brief: { sector?: string } | null }>()
  const currentSector = stateRow?.brief?.sector ?? ""

  // Fetch the full MondayClient row so the context composer can pull
  // Drive folder id, account manager, etc. Best-effort: if Monday is
  // unreachable we still build a context block from the other sources.
  const mondayClient = await fetchClientById(clientId).catch(() => null)

  // Roy 2026-06-11: cross-client examples + past-variants zijn weg -
  // handmatige flow heeft geen branche-vergelijking nodig. Alleen
  // pastCreatives (anti-repeat) + pastBrief (tone) + clientContext.
  const [pastCreatives, pastBrief, clientContext] = await Promise.all([
    pastContextForStage(clientId, "creatives", 2).catch(() => ""),
    pastContextForStage(clientId, "brief", 1).catch(() => ""),
    mondayClient
      ? buildCreativeRefreshContext(mondayClient).catch((e) => {
          console.error(
            "[creative-refresh] context build failed:",
            e instanceof Error ? e.message : e,
          )
          return null
        })
      : Promise.resolve(null),
  ])

  if (clientContext) {
    console.log(
      `[creative-refresh] context sources for ${clientId}:`,
      JSON.stringify(clientContext.sources),
      `chars=${clientContext.charCount}`,
      `brand=${clientContext.sources.brandStyle ? "y" : "n"} feedback=${clientContext.sources.feedbackCount}`,
    )
  }

  // Roy 2026-06-11: vision op alleen de gekozen ad (1 Haiku call,
  // cached na de eerste keer per ad). Geen losers-analyse meer.
  const visionTargets = winners
    .slice(0, 1)
    .filter((a) => a.adId && a.thumbnailUrl)
    .map((a) => ({
      adId: a.adId,
      adName: a.adName,
      thumbnailUrl: a.thumbnailUrl,
      clientId,
    }))
  const visionByAdId = await analyzeAdsParallel(supabase, visionTargets).catch(
    () => new Map<string, string>(),
  )
  console.log(
    `[creative-refresh] vision analyses for ${clientId}: ${visionByAdId.size}/${visionTargets.length} ads`,
  )

  const winnersBlock = renderAdsForPrompt(winners, 5, visionByAdId)

  // Roy 2026-06-11: prompt-flow is volledig handmatig - CM heeft 1
  // specifieke ad gekozen, Pedro itereert op DIE ad. Geen window/winner
  // detection meer, geen losers vergelijking.
  const promptIntro = `Je bent Pedro, senior campaign manager bij Rocket Leads. De CM heeft EEN specifieke ad gekozen om op te itereren. Je taak: 3 nieuwe varianten genereren die elk een DUIDELIJK BESTAANDE hook/angle uit de source-copy amplificeren.

KLANT: ${client.name} (Monday item ${clientId})

${clientContext?.block ?? "CLIENT CONTEXT: niet beschikbaar - wees expliciet voorzichtig met aannames over wat klant verkoopt of wie de doelgroep is."}

GEKOZEN AD (door CM geselecteerd - DIT is de DNA-bron voor hooks/angles):
${winnersBlock}
${voiceCorpus ? `\n${voiceCorpus}\n` : ""}
${pastCreatives}
${pastBrief}
DE METHODE (verplicht, geen shortcuts):

STAP 1 - EXTRACTIE: lees de primary copy + headline + description van de gekozen ad woord-voor-woord. Identificeer ELKE distincte hook/angle/pijnpunt die er expliciet in voorkomt. Een typische Zumex-achtige ad heeft 3-5 hooks verspreid over verschillende zinnen/alinea's. Voorbeelden van hooks die je moet detecteren:
- ROI / "vanaf €X per dag" / kostenargument
- Ruimte-argument / "neemt weinig plek in"
- Gemak / "snel te reinigen" / "iedereen kan ermee werken"
- Financiering / "leasen mogelijk" / "geen directe investering"
- Verse sappen-trend / klantvraag
- Service / Nederlandse support
- Garantie / kwaliteit
- Marktleider / sociale bewijs

Output deze hooks in het \`extractedHooks\` array per proposal: 3-5 items, elk met een KORTE LABEL én een DIRECTE QUOTE uit de source-copy.

STAP 2 - AMPLIFICATIE: kies 3 van die geëxtraheerde hooks (een variant per hook) en maak van elke ervan een nieuwe variant die DIE specifieke hook als spine heeft. De variant herformuleert de hook, maar laat de KERN ervan herkenbaar. Forbid: nieuwe hooks bedenken die NIET in de source-copy staan.

STAP 3 - BEWIJS: per variant moet \`sourceHookQuote\` een DIRECTE quote uit de source bevatten die jouw variant amplificeert. Als je die quote niet kunt vinden in de source, is je variant FOUT - gooi 'm weg en kies een andere hook.

STAP 4 - VOCABULARY LOCK: gebruik UITSLUITEND product/dienst-omschrijvingen die ook in de KLANT VOICE CORPUS hierboven voorkomen. Klanten zijn picky op hoe hun eigen product beschreven wordt. Voorbeelden van waar dit fout gaat:
- Klant zegt "sappenautomaat" → je schrijft NIET "sappenmachine" of "sapmachine" of "sapautomaat" (al die varianten zijn FOUT, alleen het exacte woord uit de corpus mag).
- Klant zegt "Nederlandse service" → niet "lokale service" of "service in Nederland".
- Klant zegt "verse sappen" → niet "verse jus" of "vers sap".
- Hooks/openers/angles mogen creatief afwijken, MAAR product- en dienstomschrijvingen moeten woord-voor-woord matchen met de corpus.
- Twijfel? Kies het meest-gebruikte woord uit de corpus.

VERBODEN - typische faalmodi:
- Nieuwe angles bedenken die nergens in de source staan ("marge", "klantenvraag", "service-defect" als die niet expliciet in de source-copy genoemd worden).
- Nieuwe productnamen bedenken die niet in de voice corpus staan ("sappenmachine" als de klant "sappenautomaat" zegt).
- Generieke marketing-claims toevoegen waar de source er niet over begint.
- Alle 3 varianten op dezelfde extracted hook bouwen (Meta dynamic creative wil VARIATIE).

FORMAT: het format van de gekozen ad bepaalt het format van alle 3 varianten (Photo → Photo, Video → Video).

Output: EXACT 1 proposal (de gekozen ad) met \`extractedHooks\` + 3 varianten die elk een andere extracted hook amplificeren.`

  const promptTail = `

GROUND-TRUTH REGEL (Roy 2026-06-09):
- Je proposals MOETEN gebaseerd zijn op de CLIENT CONTEXT + WINNERS primary copy + WINNERS Visual. Speculeer NOOIT over wat de klant verkoopt of wie de doelgroep is op basis van alleen de bedrijfsnaam of ad-naam.
- De ad-NAAM ("Tosti's", "Pricelist", etc.) is een interne label en NIET een aanwijzing voor de productinhoud. Negeer de naam als signaal voor product/doelgroep en leid alles af van de bodies/Visual.
- Als CLIENT CONTEXT en WINNERS primary copy elkaar tegenspreken, vertrouw op de WINNERS bodies + Visual (die werken bewezen).
- Als beide afwezig of dun zijn: zeg dat expliciet in je summary ("context dun, voorzichtig met aannames") en blijf bij wat de ad-namen suggereren - geen invented productverhalen.
- B2B vs B2C: leid dit AF van de ad bodies, Visual, en briefing, niet uit aannames over de branche.

PRINCIPES (knowledge/campaigns.md):
- Een winnende ad is geen rustpunt maar een signaal. Verdubbelen op winnaars met nieuwe iteraties.
- NOOIT budget-verhoging aanbevelen. Budgets zijn vast bij RL klanten.
- Wees specifiek met namen, hooks, exacte zinnen. Geen generieke marketing-tips.
- Iteraties moeten progressief zijn: herhaal niet, varieer.

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
        "hook": "wat behouden moet blijven (hook-stijl, bv. 'pijnpunt-opener' of 'fake-news contrarian')",
        "angle": "marketing angle (bv. 'subsidie-savings', 'voor/na transformatie')",
        "format": "format (bv. 'AI avatar talking-head 9:16', 'photo carousel')"
      },
      "extractedHooks": [
        {
          "label": "Korte 2-3 woord label, bv. 'ROI €3/dag' of 'Ruimte-argument'",
          "quote": "Directe quote uit de source primary copy/headline/description, max 200 char."
        }
      ],
      "variants": [
        {
          "label": "Variant A - korte beschrijvende naam",
          "formatHint": "Photo" | "Video",
          "topicLabel": "kort thema-label in NL, max 4 woorden, bv. 'Subsidie savings', 'Voor/na transformatie', 'Pijnpunt opener'. Geen jaartal, geen datum.",
          "sourceHookQuote": "VERPLICHT - directe quote uit de source-copy van DE hook die deze variant amplificeert. Moet matchen met één van extractedHooks[].quote. Geen quote = geen variant.",
          "newHook": "een nieuwe opener-zin in NL die de gekozen extractedHook[].label amplificeert. Quote-niveau verbinding met de source moet er zijn, niet alleen 'gerelateerd'.",
          "scriptOutline": "3-5 bullet points van de script-flow (in NL)",
          "primaryCopySnippet": "primary text van 40-80 woorden in NL. Begint met de hook of een vergelijkbare pijnpunt-opener; vertelt 2-3 zinnen waarom RL/klant dit oplost; sluit af met soft CTA.",
          "headline": "ÉÉN korte Meta headline van max 35 char in NL. Pijnpunt-vraag of herkenbare situatie uit DOELGROEP-perspectief (niet product-claim). Voorbeelden: 'Vragen je gasten ook naar verse sappen?' / 'Te hoge stookkosten ondanks isolatie?'. GEEN punt op het eind, GEEN merknaam, GEEN brand-slogan.",
          "altHeadlines": ["VERPLICHT: 2 alternatieve headlines in NL, zelfde DNA als de primaire, andere invalshoek (bv. seizoen, ROI, sociale druk). Elke max 35 char. Geen punt op eind. Format: array van 2 strings."],
          "altPrimaryTexts": ["VERPLICHT: 2 alternatieve primary texts in NL, 40-80 woorden, andere opener dan primary. Format: array van 2 strings. Meta draait dynamic creative met deze 3 totaal - varieer hook + bewijs zodat Meta verschillende segmenten kan raken."],
          "linkDescription": "Optionele ~30 char link description in NL (mag lege string zijn). Korte ondersteunende regel onder de headline, niet verplicht.",
          "imagePrompt": "ENGLISH visual brief van max 140 woorden voor de image-gen (Gemini Nano Banana Pro). Gemini krijgt straks tot 3 reference images. Beschrijf: scene/setting, ONE clear subject, mood, lighting, ONE clean on-image headline. Verwijs naar references zo: 'using the client product visible in the reference photos'. Schrijf in English voor model fidelity. \n\nHARDE REGELS - RL is een marketingbureau, deze creatives moeten LEVERBAAR zijn. Bij twijfel = TE WEINIG, niet te veel:\n(A) EXACTLY ONE on-image text element. The exact Dutch headline. NIETS anders. NO badges, NO price labels (€..), NO comparison stickers (LAGE/3x MARGE), NO sticker/sign overlays, NO secondary captions, NO photo captions. The model often duplicates the same badge twice - explicitly forbid: 'Do not duplicate any text element. Render the headline exactly ONCE.'\n(B) Brand handling. NO competing brand names visible (no QualityFry/Blendtec/etc in a Zumex shot). NO large logo. Subtle brand presence only if it occurs naturally on a product surface.\n(C) Typography quality. ONE consistent sans-serif typeface for the whole headline. Even letter spacing. Center-aligned or left-aligned consistently. Sufficient padding around the headline (≥8% of canvas on each side). NO mixed weights within the same line unless explicitly framed. NO outline + fill mixed. Use the BRAND IDENTITY hex codes from context for color accents.\n(D) Composition. Clean photographic background. ONE subject in focus. The headline sits in clear negative space - never on top of busy detail. Resolution must look professional, not collage-y.\n(E) On-image text is the headline. Pijnpunt-vraag/situatie uit doelgroep-perspectief, GEEN product-claim. Use the variant's 'headline' field verbatim where possible.\n(F) Honoreer KLANT-FEEDBACK PATRONEN uit context als wetten.\n\nExplicit deny list (write these as 'NEGATIVE: ...' at the end of the prompt): no badges, no sticker overlays, no price tags, no comparison labels, no duplicated text, no competing brand watermarks, no '€X' price callouts, no '3x'/'2x' multiplier stickers, no before/after split overlays, no mixed fonts.",
          "why": "1 zin: 'Amplificeert hook \"<extractedHook label>\": <quote>'. Geen vage 'respecteert DNA' - wees expliciet welke hook deze variant pakt."
        }
      ]
    }
  ]
}

NAMING - de CM moet de ad straks 1:1 in Meta zetten met onze conventie:
- formatHint: erf van de winner. Was de winner een "Photo X | …" → variant is "Photo". Was het een "Video X | …" → variant is "Video". Geen mixing.
- topicLabel: dit wordt het laatste deel van de ad-naam ("Photo 7 | <topicLabel>"). Houd 'm kort en herkenbaar - bij voorkeur de angle of het hook-thema. Geen klantnamen, geen datums. Pedro genereert ALLEEN het topic-deel; het systeem voegt het volgnummer toe.

Genereer EXACT 1 proposal (alleen de gekozen ad). Per proposal: 3 varianten. Alle tekst NL. Geen datums.`

  const prompt = promptIntro + promptTail

  const system = await loadPedroSystemPrompt()
  let raw = ""
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: prompt }],
    })
    raw = message.content[0]?.type === "text" ? message.content[0].text : ""
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Claude API fout" },
      { status: 500 },
    )
  }

  const cleaned = raw.replace(/```json|```/g, "").trim()
  let parsed: { summary?: string; proposals?: Proposal[] }
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return NextResponse.json(
      { error: "Pedro gaf ongeldig antwoord - probeer opnieuw." },
      { status: 500 },
    )
  }

  const rawProposals = Array.isArray(parsed.proposals) ? parsed.proposals : []
  const responseSummary = parsed.summary ?? ""

  // ── 5. Assign canonical RL ad names to every variant. ──
  // The CM copies these 1:1 into Meta so the UTM later ties incoming
  // leads back to the exact Pedro-generated variant. Without this step
  // there's no learning loop. Numbers start from max(existing)+1 per
  // format and increment across all variants in this refresh so two
  // Photo variants never collide.
  //
  // We derive the format pool from the FULL ad list (winners + losers
  // + non-tested), not just winners - otherwise we could pick a number
  // that's already used by a loser ad that's still in the account.
  const allAdNames = adsRaw.map((a) => a.adName).filter((n): n is string => !!n)
  const maxByFormat = getMaxAdNumberByFormat(allAdNames)
  const nextByFormat: Record<AdFormatHint, number> = {
    Photo: maxByFormat.Photo + 1,
    Video: maxByFormat.Video + 1,
  }
  // Roy 2026-06-10: bouw een lookup van adId → ScoredAd zodat we per
  // proposal de winner's volledige Meta metadata kunnen snapshotten in
  // de envelope. Dit maakt push-to-meta resilient - de push leest
  // straks uit deze snapshot ipv een live Meta-lookup, zodat verwijderde
  // winners de flow niet meer blokkeren.
  const scoredByAdId = new Map(scored.map((a) => [a.adId, a]))

  const responseProposals: Proposal[] = []
  for (const rawProposal of rawProposals as Array<Partial<Proposal>>) {
    const variantsIn = Array.isArray(rawProposal.variants) ? rawProposal.variants : []
    const namedVariants = assignAdNamesToVariants(
      variantsIn as Parameters<typeof assignAdNamesToVariants>[0],
      nextByFormat,
    )
    const winnerAdId = rawProposal.basedOnAd?.adId ?? ""
    const winnerAd = winnerAdId ? scoredByAdId.get(winnerAdId) : undefined
    // Roy 2026-06-10: sourceScreenshotPath wordt alleen toegevoegd aan de
    // proposal die op de gekozen sourceAdId itereert (ad-picker flow).
    // Andere proposals (legacy multi-winner flow) krijgen 'm niet.
    const isPickedSource = !!sourceAdId && winnerAdId === sourceAdId
    const snapshot = winnerAd
      ? {
          campaignId: winnerAd.campaignId,
          campaignName: winnerAd.campaignName,
          adsetId: winnerAd.adsetId,
          adsetName: winnerAd.adsetName,
          pageId: winnerAd.pageId,
          instagramActorId: winnerAd.instagramActorId,
          leadGenFormId: winnerAd.leadGenFormId,
          linkUrl: winnerAd.linkUrl,
          callToActionType: winnerAd.callToActionType,
          ...(isPickedSource && sourceScreenshotPath
            ? { sourceScreenshotPath }
            : {}),
        }
      : undefined
    responseProposals.push({
      basedOnAd: {
        adId: winnerAdId,
        adName: rawProposal.basedOnAd?.adName ?? "",
        cpl: rawProposal.basedOnAd?.cpl ?? null,
        verdict: rawProposal.basedOnAd?.verdict ?? "winner",
        ...(snapshot ? { snapshot } : {}),
      },
      preserve: {
        hook: rawProposal.preserve?.hook ?? "",
        angle: rawProposal.preserve?.angle ?? "",
        format: rawProposal.preserve?.format ?? "",
      },
      variants: namedVariants,
    })
  }

  // ── 6. Persist to pedro_refreshes. Replaces the old
  // pedro_client_state.creatives.refreshes[] write - flat table makes
  // history queries + inbox/Drive linking trivial. Failure is logged
  // but doesn't block the response: the CM still gets proposals. ──
  let refreshId: string | null = null
  const envelope = {
    stats: {
      totalSpend: stats.totalSpend,
      totalLeads: stats.totalLeads,
      avgCpl: stats.avgCpl,
      avgCtr: stats.avgCtr,
      winnerCount: winners.length,
      loserCount: losers.length,
    },
    trend,
    summary: responseSummary,
    proposals: responseProposals,
    warnings,
  }
  try {
    const { data: insertRow, error } = await supabase
      .from("pedro_refreshes")
      .insert({
        client_id: clientId,
        stage: "creatives",
        generated_by: session.user.id,
        window_start: cur.start,
        window_end: cur.end,
        window_days: days,
        envelope,
      })
      .select("id")
      .single()
    if (error) throw error
    refreshId = insertRow?.id ?? null

    // Fan-out variants into the flat `pedro_variants` table. Each row
    // becomes a learning target: sync-pedro-variants cron will later
    // match `ad_name` against live Meta ads and stamp an outcome
    // (winner/loser/neutral). The next refresh prompt reads back from
    // here as the LEARNING block, so Pedro can repeat what worked.
    if (refreshId) {
      await fanOutVariantsToTable({
        supabase,
        refreshId,
        clientId,
        stage: "creatives",
        proposals: responseProposals,
      })
    }
  } catch (e) {
    console.error("[pedro/creative-refresh] persist error:", e instanceof Error ? e.message : e)
  }

  // Stitch variant ids back into the response so the UI can call
  // generate-image / upload-image / launch endpoints immediately on
  // a fresh refresh - no reload needed. Best-effort: if the lookup
  // fails the UI just hides the per-variant image affordances until
  // the next reload (which reads from refreshes/[id] with the join).
  let enrichedProposals: typeof responseProposals = responseProposals
  if (refreshId) {
    try {
      const { data: variantRows } = await supabase
        .from("pedro_variants")
        .select("id, ad_name")
        .eq("refresh_id", refreshId)
      const byAdName = new Map<string, string>()
      for (const r of (variantRows ?? []) as Array<{ id: string; ad_name: string }>) {
        byAdName.set(r.ad_name, r.id)
      }
      enrichedProposals = responseProposals.map((p) => ({
        ...p,
        variants: p.variants.map((v) => ({
          ...v,
          variantId: byAdName.get(v.adName) ?? null,
          image: {
            hasImage: false,
            imagePrompt: v.imagePrompt ?? null,
          },
          metaAdId: null,
          launchedAt: null,
        })) as typeof p.variants,
      }))
    } catch (e) {
      console.error(
        "[pedro/creative-refresh] enrich variant ids failed (continuing without):",
        e instanceof Error ? e.message : e,
      )
    }
  }

  return NextResponse.json({
    mode: "iterate-winners",
    refreshId,
    clientId,
    clientName: client.name,
    window: { ...cur, days },
    stats: envelope.stats,
    trend,
    proposals: enrichedProposals,
    summary: responseSummary,
    warnings,
  })
}
