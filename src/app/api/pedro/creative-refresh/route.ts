import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaAdDetails } from "@/lib/integrations/meta"
import { cachedFetch } from "@/lib/cache"
import {
  computeAccountStats,
  computeTrend,
  scoreAd,
  renderAdsForPrompt,
  type ScoredAd,
} from "@/lib/pedro/performance"
import { loadPedroSystemPrompt } from "@/lib/pedro/knowledge"
import { pastContextForStage } from "@/lib/pedro/past-campaigns"
import { crossClientExamplesBlock } from "@/lib/pedro/cross-client-examples"
import {
  assignAdNamesToVariants,
  getMaxAdNumberByFormat,
  type AdFormatHint,
  type NamedProposal,
} from "@/lib/pedro/refresh-naming"
import { fanOutVariantsToTable } from "@/lib/pedro/variants"
import { pastVariantsContextBlock } from "@/lib/pedro/past-variants-context"

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
 * winner — same hook/angle/format DNA, fresh executions. Per knowledge/
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
      /** Row id in pedro_refreshes — null when persistence failed; UI uses
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

function priorRange(days: number): { start: string; end: string } {
  const end = new Date()
  end.setDate(end.getDate() - days)
  const start = new Date()
  start.setDate(start.getDate() - days * 2 + 1)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export async function POST(req: NextRequest): Promise<NextResponse<RefreshResponse>> {
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

  // ── 1. Resolve client ──
  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("monday_item_id, name, meta_ad_account_id")
    .eq("monday_item_id", clientId)
    .maybeSingle()

  if (!client) return NextResponse.json({ error: "Klant niet gevonden in hub" }, { status: 404 })
  if (!client.meta_ad_account_id) {
    return NextResponse.json({ error: "Geen Meta ad account voor deze klant" }, { status: 400 })
  }

  // ── 2. Pull current + prior windows in parallel (cached) ──
  const cur = dateRange(days)
  const prior = priorRange(days)
  const [adsRaw, adsPriorRaw] = await Promise.all([
    cachedFetch(`pedro_perf:${client.meta_ad_account_id}:${cur.start}:${cur.end}`, () =>
      fetchMetaAdDetails(client.meta_ad_account_id, cur.start, cur.end),
    ).catch(() => [] as Awaited<ReturnType<typeof fetchMetaAdDetails>>),
    cachedFetch(`pedro_perf:${client.meta_ad_account_id}:${prior.start}:${prior.end}`, () =>
      fetchMetaAdDetails(client.meta_ad_account_id, prior.start, prior.end),
    ).catch(() => [] as Awaited<ReturnType<typeof fetchMetaAdDetails>>),
  ])

  const stats = computeAccountStats(adsRaw)
  const priorStats = computeAccountStats(adsPriorRaw)
  const trend = computeTrend(
    { totalSpend: stats.totalSpend, totalLeads: stats.totalLeads, avgCpl: stats.avgCpl },
    { totalSpend: priorStats.totalSpend, totalLeads: priorStats.totalLeads, avgCpl: priorStats.avgCpl },
  )

  const scored: ScoredAd[] = adsRaw.map((a) => scoreAd(a, stats.avgCpl))
  const winners = scored.filter((a) => a.verdict === "winner")
  const losers = scored.filter((a) => a.verdict === "loser")

  const warnings: string[] = []
  if (stats.totalSpend < 100) {
    warnings.push("Window-spend is laag (<€100); aanbevelingen zijn richtinggevend.")
  }
  if (stats.totalLeads === 0) {
    warnings.push("Geen leads in dit window — geen baseline voor verdict.")
  }
  warnings.push(
    "Lead-quality (Monday CRM updates per UTM) zit nog niet in deze analyse — winnaars zijn 'goedkoop', niet automatisch 'goed'. Verifieer in Monday voor je itereert.",
  )

  // ── 3. No-winners path: tell the CM the situation, don't fabricate ──
  if (winners.length === 0) {
    const fallbackSummary =
      losers.length > 0
        ? `Geen winners in ${days}d window (avg CPL ${stats.avgCpl ? `€${stats.avgCpl.toFixed(2)}` : "—"}, ${losers.length} loser${losers.length === 1 ? "" : "s"}). Dit is een new-angle moment, geen creative-refresh moment. Run de "New angle test"-stage zodra die ship is.`
        : `Geen ads scoren als winner in ${days}d window. Te weinig data of huidige angle is uitgewerkt. Overweeg een nieuwe angle-test in plaats van itereren op ondergemiddelde performance.`
    return NextResponse.json({
      mode: "no-winners",
      clientId,
      clientName: client.name,
      window: { ...cur, days },
      summary: fallbackSummary,
      warnings,
    })
  }

  // ── 4. Compose the iterate-on-winners prompt ──
  // Pull past creatives for anti-repeat context + the brief for tone +
  // cross-client examples (same-vertical RL winners) so Pedro's
  // proposals are grounded in what already works in this niche.
  // Sector for cross-client lookup comes from the latest saved brief —
  // empty string if none, in which case we skip cross-client.
  const { data: stateRow } = await supabase
    .from("pedro_client_state")
    .select("brief")
    .eq("client_id", clientId)
    .order("campaign_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ brief: { sector?: string } | null }>()
  const currentSector = stateRow?.brief?.sector ?? ""

  const [pastCreatives, pastBrief, crossClient, pastVariants] = await Promise.all([
    pastContextForStage(clientId, "creatives", 2).catch(() => ""),
    pastContextForStage(clientId, "brief", 1).catch(() => ""),
    currentSector
      ? crossClientExamplesBlock(supabase, clientId, currentSector, 4).catch(() => "")
      : Promise.resolve(""),
    pastVariantsContextBlock(supabase, clientId).catch(() => ""),
  ])

  // Compact the winners + a few losers (so Claude sees what NOT to copy).
  const winnersBlock = renderAdsForPrompt(winners, 5)
  const losersBlock = renderAdsForPrompt(losers, 3)
  const allAdsBlock = renderAdsForPrompt(scored, 10)

  const trendLine = (() => {
    const parts: string[] = []
    if (trend.spendDeltaPct != null) parts.push(`spend ${trend.spendDeltaPct >= 0 ? "+" : ""}${trend.spendDeltaPct.toFixed(0)}%`)
    if (trend.leadsDeltaPct != null) parts.push(`leads ${trend.leadsDeltaPct >= 0 ? "+" : ""}${trend.leadsDeltaPct.toFixed(0)}%`)
    if (trend.cplDeltaPct != null) parts.push(`CPL ${trend.cplDeltaPct >= 0 ? "+" : ""}${trend.cplDeltaPct.toFixed(0)}%`)
    return parts.length ? parts.join(" / ") : "geen trend (te weinig prior data)"
  })()

  const prompt = `Je bent Pedro, senior campaign manager bij Rocket Leads. Je bekijkt de live Meta performance van een klant en stelt CREATIVE REFRESH proposals voor: nieuwe variaties op de winnende ads in dezelfde DNA (zelfde hook/angle/format), om CPL laag te houden en ad fatigue te voorkomen.

KLANT: ${client.name} (Monday item ${clientId})
WINDOW: laatste ${days} dagen (${cur.start} → ${cur.end})

ACCOUNT STATS:
- Total spend: €${stats.totalSpend.toFixed(0)}, ${stats.totalLeads} leads
- Account avg CPL: ${stats.avgCpl != null ? `€${stats.avgCpl.toFixed(2)}` : "—"}
- Account avg CTR: ${stats.avgCtr != null ? `${stats.avgCtr.toFixed(2)}%` : "—"}
- Active ads (≥€10 spend): ${stats.activeAdCount}
- Trend vs prior ${days}d: ${trendLine}

WINNERS (sorted by spend, top 5):
${winnersBlock}

LOSERS (top 3 by spend — these are NOT to copy):
${losersBlock}

ALLE ADS (top 10 by spend):
${allAdsBlock}
${pastCreatives}
${pastBrief}
${crossClient}
${pastVariants}
OPDRACHT:
Voor ELKE winner uit de WINNERS lijst (max 3 winners om scope behapbaar te houden):
- Identificeer de DNA: wat is de hook-stijl, de marketing angle, het format.
- Stel 3 nieuwe variaties voor die in dezelfde richting itereren — zelfde hook-categorie, zelfde angle, zelfde format. Verse executies, nieuwe openers, andere B-roll, frisse CTA.
- Geen kopie van bestaande ads (zie "Eerdere creatives" hierboven).
- Geen kopie van losers — die hebben juist NIET gewerkt.

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
      "variants": [
        {
          "label": "Variant A — korte beschrijvende naam",
          "formatHint": "Photo" | "Video",
          "topicLabel": "kort thema-label in NL, max 4 woorden, bv. 'Subsidie savings', 'Voor/na transformatie', 'Pijnpunt opener'. Geen jaartal, geen datum.",
          "newHook": "een nieuwe opener-zin in NL die in dezelfde DNA past",
          "scriptOutline": "3-5 bullet points van de script-flow (in NL)",
          "primaryCopySnippet": "primary text opener van max 60 woorden (in NL)",
          "why": "1 zin: waarom deze variatie de DNA van [adName] respecteert maar fris is"
        }
      ]
    }
  ]
}

NAMING — de CM moet de ad straks 1:1 in Meta zetten met onze conventie:
- formatHint: erf van de winner. Was de winner een "Photo X | …" → variant is "Photo". Was het een "Video X | …" → variant is "Video". Geen mixing.
- topicLabel: dit wordt het laatste deel van de ad-naam ("Photo 7 | <topicLabel>"). Houd 'm kort en herkenbaar — bij voorkeur de angle of het hook-thema. Geen klantnamen, geen datums. Pedro genereert ALLEEN het topic-deel; het systeem voegt het volgnummer toe.

Genereer 1-3 proposals (1 per winner, max 3). Per proposal: 3 varianten. Alle tekst NL. Geen datums.`

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
      { error: "Pedro gaf ongeldig antwoord — probeer opnieuw." },
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
  // + non-tested), not just winners — otherwise we could pick a number
  // that's already used by a loser ad that's still in the account.
  const allAdNames = adsRaw.map((a) => a.adName).filter((n): n is string => !!n)
  const maxByFormat = getMaxAdNumberByFormat(allAdNames)
  const nextByFormat: Record<AdFormatHint, number> = {
    Photo: maxByFormat.Photo + 1,
    Video: maxByFormat.Video + 1,
  }
  const responseProposals: Proposal[] = []
  for (const rawProposal of rawProposals as Array<Partial<Proposal>>) {
    const variantsIn = Array.isArray(rawProposal.variants) ? rawProposal.variants : []
    const namedVariants = assignAdNamesToVariants(
      variantsIn as Parameters<typeof assignAdNamesToVariants>[0],
      nextByFormat,
    )
    responseProposals.push({
      basedOnAd: {
        adId: rawProposal.basedOnAd?.adId ?? "",
        adName: rawProposal.basedOnAd?.adName ?? "",
        cpl: rawProposal.basedOnAd?.cpl ?? null,
        verdict: rawProposal.basedOnAd?.verdict ?? "winner",
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
  // pedro_client_state.creatives.refreshes[] write — flat table makes
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

  return NextResponse.json({
    mode: "iterate-winners",
    refreshId,
    clientId,
    clientName: client.name,
    window: { ...cur, days },
    stats: envelope.stats,
    trend,
    proposals: responseProposals,
    summary: responseSummary,
    warnings,
  })
}
