import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaAdDetails } from "@/lib/integrations/meta"
import { cachedFetch } from "@/lib/cache"
import {
  computeAccountStats,
  computeTrend,
  scoreAd,
  type ScoredAd,
} from "@/lib/pedro/performance"

/**
 * GET /api/pedro/client-performance?clientId=X&days=30
 *
 * Pedro's per-client Meta performance lens. Powers Phase 3 features:
 * creative refresh, new-angle test, copy refresh, lead-quality fix.
 *
 * Returns:
 *  - account-level stats for the window
 *  - trend vs the prior equivalent window
 *  - every ad with a verdict (winner/loser/neutral) + reason
 *  - top spenders, top winners, top losers - pre-sorted convenience lists
 *  - data-availability flags so Claude knows when context is thin
 *
 * Caches Meta calls via the same `cachedFetch` the existing
 * /api/clients/[id]/ad-details endpoint uses.
 */

function dateRange(days: number): { start: string; end: string } {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days + 1)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

function priorRange(days: number): { start: string; end: string } {
  const end = new Date()
  end.setDate(end.getDate() - days)
  const start = new Date()
  start.setDate(start.getDate() - days * 2 + 1)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const clientId = req.nextUrl.searchParams.get("clientId")
  const daysParam = parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10)
  const days = Number.isFinite(daysParam) ? Math.max(1, Math.min(daysParam, 365)) : 30

  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("monday_item_id, name, meta_ad_account_id")
    .eq("monday_item_id", clientId)
    .maybeSingle()

  if (!client) {
    return NextResponse.json({ error: "Klant niet gevonden in hub" }, { status: 404 })
  }

  if (!client.meta_ad_account_id) {
    return NextResponse.json({
      clientId,
      clientName: client.name,
      adAccountId: null,
      window: dateRange(days),
      account: null,
      ads: [] as ScoredAd[],
      topByspend: [],
      winners: [],
      losers: [],
      trend: null,
      warnings: [
        "Geen Meta ad account gekoppeld voor deze klant - kan geen performance-analyse doen.",
      ],
    })
  }

  const cur = dateRange(days)
  const prior = priorRange(days)
  const cacheKeyCur = `pedro_perf_v2_creative_fix:${client.meta_ad_account_id}:${cur.start}:${cur.end}`
  const cacheKeyPrior = `pedro_perf_v2_creative_fix:${client.meta_ad_account_id}:${prior.start}:${prior.end}`

  const [adsRaw, adsPriorRaw] = await Promise.all([
    cachedFetch(cacheKeyCur, () =>
      fetchMetaAdDetails(client.meta_ad_account_id, cur.start, cur.end),
    ).catch((e) => {
      console.error("Pedro performance - current window error:", e)
      return [] as Awaited<ReturnType<typeof fetchMetaAdDetails>>
    }),
    cachedFetch(cacheKeyPrior, () =>
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

  const topByspend = [...scored].sort((a, b) => b.spend - a.spend).slice(0, 8)
  const winners = scored
    .filter((a) => a.verdict === "winner")
    .sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity))
    .slice(0, 5)
  const losers = scored
    .filter((a) => a.verdict === "loser")
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 5)

  const warnings: string[] = []
  if (stats.totalSpend < 100) {
    warnings.push("Window-spend is laag (<€100); inzichten zijn richtinggevend, niet conclusive.")
  }
  if (stats.totalLeads === 0) {
    warnings.push("Geen leads in dit window - alle CPL-vergelijkingen vervallen.")
  }
  if (priorStats.totalSpend === 0) {
    warnings.push("Geen prior-window data - trend-deltas zijn afwezig of onbetrouwbaar.")
  }
  warnings.push(
    "Lead-quality (Monday CRM updates per UTM) is nog niet meegerekend - winnaars zijn 'goedkoop', niet automatisch 'goed'. Verifieer feedback in Monday voor je itereert.",
  )

  return NextResponse.json(
    {
      clientId,
      clientName: client.name,
      adAccountId: client.meta_ad_account_id,
      window: { ...cur, days },
      priorWindow: prior,
      account: stats,
      priorAccount: priorStats,
      trend,
      ads: scored,
      topByspend,
      winners,
      losers,
      warnings,
    },
    { headers: { "Cache-Control": "private, s-maxage=120, stale-while-revalidate=300" } },
  )
}
