import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import {
  fetchMetaAdDetails,
  fetchMetaInsightsDaily,
  aggregateMetaDailyByDate,
} from "@/lib/integrations/meta"
import { fetchItemUpdates } from "@/lib/integrations/monday"
import { readCache, writeCache } from "@/lib/cache"
import type { ClientContext } from "@/lib/watchlist/collect-context"
import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"

export type WatchlistExpandResponse = {
  /** 14d daily trend (spend + leads). Computed live so the chart works even when the
   *  parent KpiSummary cache predates the dailyTrend field. */
  dailyTrend: Array<{ date: string; spend: number; leads: number }>
  /** Top-3 winning ads (30d) — lowest CPL with at least 3 leads. */
  winningAds: Array<{ adName: string; spend: number; leads: number; cpl: number }>
  /** Top-3 losing ads (30d) — highest CPL with at least €50 spend. */
  losingAds: Array<{ adName: string; spend: number; leads: number; cpl: number }>
  /** Concise 14d activity summary, AI-generated from Monday updates (both boards) +
   *  Trengo conversations. Null when no qualitative input is available. */
  aiSummary: string | null
}

const SPARKLINE_DAYS = 14
const AI_SUMMARY_TTL_MS = 60 * 60 * 1000 // 1h
const anthropic = new Anthropic()

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getLast30DaysRange() {
  const end = new Date()
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(start.getDate() - 29)
  return { startDate: fmtDate(start), endDate: fmtDate(end) }
}

function getTrendRange() {
  const end = new Date()
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(start.getDate() - (SPARKLINE_DAYS - 1))
  return { startDate: fmtDate(start), endDate: fmtDate(end) }
}

function fillTrend(
  byDate: Array<{ date: string; spend: number; leads: number }>,
  startDate: string,
): Array<{ date: string; spend: number; leads: number }> {
  const map = new Map(byDate.map((d) => [d.date, d]))
  const out: Array<{ date: string; spend: number; leads: number }> = []
  const cursor = new Date(startDate + "T00:00:00Z")
  for (let i = 0; i < SPARKLINE_DAYS; i++) {
    const d = fmtDate(cursor)
    out.push(map.get(d) ?? { date: d, spend: 0, leads: 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

async function generateAiSummary(
  clientName: string,
  insight: string,
  inputs: { leadBoardUpdates: string; currentBoardUpdates: string; trengo: string },
): Promise<string | null> {
  const hasAnything =
    inputs.leadBoardUpdates.trim() ||
    inputs.currentBoardUpdates.trim() ||
    inputs.trengo.trim()
  if (!hasAnything) return null

  const sections: string[] = []
  if (inputs.leadBoardUpdates.trim()) {
    sections.push(`MONDAY LEAD BOARD UPDATES [WINDOW: update texts = last 14d; "Lead statuses: X" line is ALL-TIME aggregates]\n${inputs.leadBoardUpdates}`)
  }
  if (inputs.currentBoardUpdates.trim()) {
    sections.push(`MONDAY CURRENT-CLIENTS BOARD UPDATES [WINDOW: last 14d — AM/CM notes on the client row itself]\n${inputs.currentBoardUpdates}`)
  }
  if (inputs.trengo.trim()) {
    sections.push(`TRENGO CONVERSATIONS [WINDOW: last 14d]\n${inputs.trengo}`)
  }

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: `You write the Activity Summary for a campaign manager triaging clients on the Watch List. The bar is HIGH: every bullet must give the CM something they can act on or that genuinely changes the picture. Filler is worse than silence.

## What's already on screen — DO NOT REPEAT
The user already sees, for this client, in adjacent columns:
- Spend, leads, CPL, appts (last 7d) and a 14d CPL sparkline
- An "Insight" line for cost/efficiency (e.g. "CPL up 80% — €70 vs €38 prev week", "€350 spent, 0 leads in 7d")

The Insight line for THIS client right now is:
"${insight || "(none)"}"

Your bullets must NOT contain ANY of:
- CPL or CPA trend observations (rising / falling / elevated / stable / spike)
- Restatements of spend, lead count, appointment count, or 7d-vs-prev-7d changes
- "Zero leads", "no appointments" type claims
- Anything that paraphrases the Insight line above

If a draft bullet is essentially the Insight in different words, delete it.

## What to surface (in priority order)
1. **Campaign status changes** — "on hold", "paused", "going live", "resuming after content delivery", "killed".
2. **Direct client requests / decisions** — budget increase ask, new direction, scope change, complaint, content delivery commitment. Cite the channel + date when possible: "(Apr 22 WhatsApp)".
3. **Concrete blockers awaiting action** — "waiting for new creative assets before resuming", "client needs to verify Meta business manager".
4. **Lead-quality patterns ONLY when expressed as a ratio** — "11/15 leads 'niet bereikbaar' (73%, 14d)", "5/8 leads via [UTM] said 'geen budget' (14d)".
5. **Pattern across multiple Trengo messages** — repeated complaint, escalation, satisfied feedback.

## ABSOLUTE rules
- **No bare counts.** "11 leads marked unreachable" is BANNED unless paired with a denominator and ratio: "11/47 (23%, 14d)". An absolute count without a denominator is meaningless and you must SKIP that bullet.
- **The "Lead statuses: X" line is ALL-TIME** — only useful as a denominator for a ratio computation. Never quote a status count as a standalone bullet.
- **Vague references are BANNED.** "Pending invoicing clarification", "video timeline discussion", "ongoing content alignment" — useless. Either expand with the specific outcome / decision / blocker, or skip entirely.
- **Maximum 3 bullets.** ZERO bullets is correct when there's nothing concrete. Do not pad.
- Every number gets a window label inline: (7d), (14d), (all-time).
- ≤16 words per bullet. Plain English. No buzzwords.
- Never invent. If you can't compute a ratio or extract a concrete decision/event, skip the bullet.
- Output: plain bullet lines starting with "- ". No headers, no preamble.

## Examples
✅ GOOD:
- Client awaits new creative assets before resuming campaign (Apr 24 WhatsApp).
- Budget-increase request to €3k/mnd pending AM approval (Apr 22 email).
- 11/15 leads "niet bereikbaar" (73%, 14d) — follow-up timing or wrong audience.

❌ BAD:
- 11 leads marked unreachable (no denominator → useless)
- Pending invoice clarification (vague → useless)
- CPL elevated this week (duplicates Insight)
- Recent client communication ongoing (filler)
- 47 leads have status "Niet bereikbaar" (all-time count — needs ratio context)

If nothing meets this bar: output exactly one line — \`- No notable activity in the last 14d.\``,
      messages: [
        {
          role: "user",
          content: `Client: ${clientName}\n\n${sections.join("\n\n---\n\n")}\n\nReturn the bullet list only. Apply the bar strictly — fewer correct bullets beats more soft ones.`,
        },
      ],
    })
    const text = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : ""
    return text || null
  } catch (e) {
    console.error("Watchlist expand: AI summary failed", e instanceof Error ? e.message : e)
    return null
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const insight = req.nextUrl.searchParams.get("insight") ?? ""

  const supabase = await createAdminClient()
  const { data: clientRow } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id")
    .eq("monday_item_id", mondayItemId)
    .single()

  let selectedCampaignIds: Set<string> | undefined
  if (clientRow?.id) {
    const { data: rows } = await supabase
      .from("client_campaigns")
      .select("meta_campaign_id")
      .eq("client_id", clientRow.id)
      .eq("is_selected", true)
    if (rows && rows.length > 0) {
      selectedCampaignIds = new Set(rows.map((r) => r.meta_campaign_id))
    }
  }

  const adAccountId = clientRow?.meta_ad_account_id ?? null
  const trendRange = getTrendRange()
  const adRange = getLast30DaysRange()

  // Pre-baked Monday lead board updates + Trengo come from the cron-managed cache.
  const contextCache = (await readCache<Record<string, ClientContext>>("watchlist_context")) ?? {}
  const ctx = contextCache[mondayItemId]

  // Fire all live calls in parallel — Meta daily (for trend), Meta ad details (winners/losers),
  // Monday item updates (current-clients-board commentary), and the cached AI summary lookup.
  // Cache key is bumped to v2 so old summaries (built under the looser prompt) regenerate.
  const aiSummaryCacheKey = `watchlist_expand_summary_v2:${mondayItemId}`
  const cachedSummary = await readCache<{ summary: string | null; insight: string }>(aiSummaryCacheKey, AI_SUMMARY_TTL_MS)
  // If the visible Insight changed since the last summary, regenerate — the AI compares
  // against the Insight to avoid duplicates, so a stale Insight invalidates the summary.
  const cacheValid = cachedSummary != null && cachedSummary.insight === insight

  const [dailyInsights, ads, currentBoardUpdates] = await Promise.all([
    adAccountId
      ? fetchMetaInsightsDaily(adAccountId, trendRange.startDate, trendRange.endDate).catch(() => [])
      : Promise.resolve([]),
    adAccountId
      ? fetchMetaAdDetails(adAccountId, adRange.startDate, adRange.endDate, selectedCampaignIds).catch(() => [])
      : Promise.resolve([]),
    fetchItemUpdates(mondayItemId, 14).catch((e) => {
      console.error("Watchlist expand: item-updates fetch failed", mondayItemId, e instanceof Error ? e.message : e)
      return [] as Array<{ text: string; createdAt: string }>
    }),
  ])

  // 14d daily trend (filtered to selected campaigns if any).
  const dailyFiltered = selectedCampaignIds
    ? dailyInsights.filter((d) => selectedCampaignIds!.has(d.campaignId))
    : dailyInsights
  const dailyTrend = fillTrend(aggregateMetaDailyByDate(dailyFiltered), trendRange.startDate)

  // Winners/losers from ad-level data.
  const enriched = ads.map((a) => ({
    adName: a.adName,
    spend: a.spend,
    leads: a.leads,
    cpl: a.leads > 0 ? a.spend / a.leads : Infinity,
  }))
  const winningAds = enriched
    .filter((a) => a.leads >= 3)
    .sort((a, b) => a.cpl - b.cpl)
    .slice(0, 3)
    .map((a) => ({ ...a }))
  const losingAds = enriched
    .filter((a) => a.spend >= 50)
    .sort((a, b) => b.cpl - a.cpl)
    .slice(0, 3)
    // Serialize Infinity → 0; UI renders "—" for non-finite CPL anyway.
    .map((a) => ({ ...a, cpl: isFinite(a.cpl) ? a.cpl : 0 }))

  // AI summary — cached 1h per client. Source mix: lead-board updates, current-board updates,
  // Trengo. The model receives explicit per-block window labels so it can't conflate sources,
  // and the current Insight text so it can avoid duplicating what's already on screen.
  let aiSummary: string | null = cacheValid ? cachedSummary!.summary : null
  if (!cacheValid) {
    const currentBoardText = currentBoardUpdates
      .map((u) => `[${u.createdAt}] ${u.text.slice(0, 250)}`)
      .join("\n")
    aiSummary = await generateAiSummary(clientRow?.name ?? "(client)", insight, {
      leadBoardUpdates: ctx?.mondayUpdates ?? "",
      currentBoardUpdates: currentBoardText,
      trengo: ctx?.trengoSummary ?? "",
    })
    void writeCache(aiSummaryCacheKey, { summary: aiSummary, insight })
  }

  return NextResponse.json<WatchlistExpandResponse>({
    dailyTrend,
    winningAds,
    losingAds,
    aiSummary,
  }, {
    headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
  })
}
