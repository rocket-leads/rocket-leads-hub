/**
 * Shared scaffolding for Pedro's per-stage "refresh" endpoints.
 *
 * Each refresh stage (angles, script, creatives, ad-copy) follows the
 * same pipeline:
 *   1. Validate clientId, resolve client + Meta ad account
 *   2. Pull current + prior-window ad performance from Meta (cached)
 *   3. Score ads → winners + losers
 *   4. Load past context for THIS stage + cross-client same-vertical winners
 *   5. Hand stage-specific prompt to Claude → parse JSON
 *
 * Roy 2026-05-23: PedroRefresh used to be creative-only. Adding angles,
 * scripts and ad copy as siblings means triplicating ~200 lines of glue.
 * `runPedroRefresh` is that glue extracted once — each route just supplies
 * the stage-specific prompt builder and result parser.
 */

import Anthropic from "@anthropic-ai/sdk"
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
import type { PedroStage } from "@/lib/pedro/past-campaigns"

const anthropic = new Anthropic()

export type AccountStatsBlock = {
  totalSpend: number
  totalLeads: number
  avgCpl: number | null
  avgCtr: number | null
  winnerCount: number
  loserCount: number
}

export type TrendBlock = {
  spendDeltaPct: number | null
  leadsDeltaPct: number | null
  cplDeltaPct: number | null
}

export type RefreshWindow = { start: string; end: string; days: number }

/**
 * Envelope shape returned to the UI. Generic over the stage-specific
 * proposal type so every refresh component can assume the same outer
 * structure (mode, stats, trend, summary, warnings) and only render its
 * own proposals shape.
 */
export type RefreshEnvelope<TProposal> =
  | {
      mode: "iterate-winners"
      /** Row id in `pedro_refreshes` — null when persistence failed. UI
       *  uses this to power the Save-to-Inbox / Save-to-Drive buttons. */
      refreshId?: string | null
      clientId: string
      clientName: string
      window: RefreshWindow
      stats: AccountStatsBlock
      trend: TrendBlock
      proposals: TProposal[]
      summary: string
      warnings: string[]
    }
  | {
      mode: "no-winners"
      clientId: string
      clientName: string
      window: RefreshWindow
      stats: AccountStatsBlock
      trend: TrendBlock
      summary: string
      warnings: string[]
    }

/**
 * Stage context handed to the per-stage prompt builder so it can compose
 * the Claude prompt against the same numbers + past context the UI shows.
 */
export type RefreshPromptContext = {
  clientId: string
  clientName: string
  days: number
  window: RefreshWindow
  stats: ReturnType<typeof computeAccountStats>
  trend: TrendBlock
  winners: ScoredAd[]
  losers: ScoredAd[]
  allScored: ScoredAd[]
  /** Compiled "Eerdere {stage}" block — already trimmed/formatted, drop into prompt verbatim. */
  pastStageContext: string
  /** Compiled past brief block — for tone/USP/ICP continuity. */
  pastBriefContext: string
  /** Compiled cross-client same-vertical winners block — empty when no sector. */
  crossClientContext: string
}

export type RefreshError = { error: string; status: number }

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

/**
 * Run the full per-stage refresh pipeline. Returns either:
 *  - { kind: "ok", response } — RefreshEnvelope wrapped result
 *  - { kind: "error", error, status } — pass-through to NextResponse
 *
 * The caller (per-stage API route) supplies:
 *  - `stage` (drives past-context lookup)
 *  - `buildPrompt(ctx)` returning the Claude prompt string
 *  - `parseProposals(rawJson)` extracting stage-specific proposals from the
 *    parsed Claude response. Returns `[]` when none.
 *  - `noWinnersSummary(opts)` — copy for the no-winners path (varies per
 *    stage; e.g. angles says "test a new angle", scripts says "rewrite hooks")
 */
export async function runPedroRefresh<TProposal>(args: {
  clientId: string
  days: number
  stage: PedroStage
  buildPrompt: (ctx: RefreshPromptContext) => string
  parseProposals: (parsed: { summary?: string; proposals?: unknown[] }) => {
    summary: string
    proposals: TProposal[]
  }
  noWinnersSummary: (opts: { days: number; stats: ReturnType<typeof computeAccountStats>; loserCount: number }) => string
  /** Optional model override; defaults to Sonnet 4. */
  model?: string
  /** Optional max tokens override; defaults to 4000 — enough for 3-5 proposals. */
  maxTokens?: number
}): Promise<{ kind: "ok"; response: RefreshEnvelope<TProposal> } | { kind: "error"; error: string; status: number }> {
  const { clientId, days, stage, buildPrompt, parseProposals, noWinnersSummary } = args

  // ── 1. Resolve client ──
  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("monday_item_id, name, meta_ad_account_id")
    .eq("monday_item_id", clientId)
    .maybeSingle()

  if (!client) return { kind: "error", error: "Klant niet gevonden in hub", status: 404 }
  if (!client.meta_ad_account_id) {
    return { kind: "error", error: "Geen Meta ad account voor deze klant", status: 400 }
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

  const statsBlock: AccountStatsBlock = {
    totalSpend: stats.totalSpend,
    totalLeads: stats.totalLeads,
    avgCpl: stats.avgCpl,
    avgCtr: stats.avgCtr,
    winnerCount: winners.length,
    loserCount: losers.length,
  }

  // ── 3. No-winners path: surface the situation, don't fabricate ──
  if (winners.length === 0) {
    return {
      kind: "ok",
      response: {
        mode: "no-winners",
        clientId,
        clientName: client.name,
        window: { ...cur, days },
        stats: statsBlock,
        trend,
        summary: noWinnersSummary({ days, stats, loserCount: losers.length }),
        warnings,
      },
    }
  }

  // ── 4. Past context + cross-client examples ──
  const { data: stateRow } = await supabase
    .from("pedro_client_state")
    .select("brief")
    .eq("client_id", clientId)
    .order("campaign_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ brief: { sector?: string } | null }>()
  const currentSector = stateRow?.brief?.sector ?? ""

  const [pastStage, pastBrief, crossClient] = await Promise.all([
    pastContextForStage(clientId, stage, 2).catch(() => ""),
    pastContextForStage(clientId, "brief", 1).catch(() => ""),
    currentSector
      ? crossClientExamplesBlock(supabase, clientId, currentSector, 4).catch(() => "")
      : Promise.resolve(""),
  ])

  // ── 5. Build prompt + call Claude ──
  const promptCtx: RefreshPromptContext = {
    clientId,
    clientName: client.name,
    days,
    window: { ...cur, days },
    stats,
    trend,
    winners,
    losers,
    allScored: scored,
    pastStageContext: pastStage,
    pastBriefContext: pastBrief,
    crossClientContext: crossClient,
  }
  const prompt = buildPrompt(promptCtx)
  const system = await loadPedroSystemPrompt()

  let raw = ""
  try {
    const message = await anthropic.messages.create({
      model: args.model ?? "claude-sonnet-4-20250514",
      max_tokens: args.maxTokens ?? 4000,
      system,
      messages: [{ role: "user", content: prompt }],
    })
    raw = message.content[0]?.type === "text" ? message.content[0].text : ""
  } catch (e) {
    return { kind: "error", error: e instanceof Error ? e.message : "Claude API fout", status: 500 }
  }

  const cleaned = raw.replace(/```json|```/g, "").trim()
  let parsedJson: { summary?: string; proposals?: unknown[] }
  try {
    parsedJson = JSON.parse(cleaned)
  } catch {
    return { kind: "error", error: "Pedro gaf ongeldig antwoord — probeer opnieuw.", status: 500 }
  }

  const { summary, proposals } = parseProposals(parsedJson)

  return {
    kind: "ok",
    response: {
      mode: "iterate-winners",
      clientId,
      clientName: client.name,
      window: { ...cur, days },
      stats: statsBlock,
      trend,
      summary,
      proposals,
      warnings,
    },
  }
}

/**
 * Compose the boilerplate prompt prefix shared by every refresh stage:
 * window summary + account stats + trend + winners/losers/all-ads blocks
 * + past-stage + past-brief + cross-client. Per-stage prompt builders
 * append their stage-specific OPDRACHT + JSON output spec.
 */
export function commonPromptPreamble(ctx: RefreshPromptContext): string {
  const trendLine = (() => {
    const parts: string[] = []
    if (ctx.trend.spendDeltaPct != null) parts.push(`spend ${ctx.trend.spendDeltaPct >= 0 ? "+" : ""}${ctx.trend.spendDeltaPct.toFixed(0)}%`)
    if (ctx.trend.leadsDeltaPct != null) parts.push(`leads ${ctx.trend.leadsDeltaPct >= 0 ? "+" : ""}${ctx.trend.leadsDeltaPct.toFixed(0)}%`)
    if (ctx.trend.cplDeltaPct != null) parts.push(`CPL ${ctx.trend.cplDeltaPct >= 0 ? "+" : ""}${ctx.trend.cplDeltaPct.toFixed(0)}%`)
    return parts.length ? parts.join(" / ") : "geen trend (te weinig prior data)"
  })()

  const winnersBlock = renderAdsForPrompt(ctx.winners, 5)
  const losersBlock = renderAdsForPrompt(ctx.losers, 3)
  const allAdsBlock = renderAdsForPrompt(ctx.allScored, 10)

  return `KLANT: ${ctx.clientName} (Monday item ${ctx.clientId})
WINDOW: laatste ${ctx.days} dagen (${ctx.window.start} → ${ctx.window.end})

ACCOUNT STATS:
- Total spend: €${ctx.stats.totalSpend.toFixed(0)}, ${ctx.stats.totalLeads} leads
- Account avg CPL: ${ctx.stats.avgCpl != null ? `€${ctx.stats.avgCpl.toFixed(2)}` : "—"}
- Account avg CTR: ${ctx.stats.avgCtr != null ? `${ctx.stats.avgCtr.toFixed(2)}%` : "—"}
- Active ads (≥€10 spend): ${ctx.stats.activeAdCount}
- Trend vs prior ${ctx.days}d: ${trendLine}

WINNERS (sorted by spend, top 5):
${winnersBlock}

LOSERS (top 3 by spend — these are NOT to copy):
${losersBlock}

ALLE ADS (top 10 by spend):
${allAdsBlock}
${ctx.pastStageContext}
${ctx.pastBriefContext}
${ctx.crossClientContext}`
}
