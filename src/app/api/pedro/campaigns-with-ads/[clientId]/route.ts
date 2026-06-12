import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaAdDetails } from "@/lib/integrations/meta"
import { cachedFetch } from "@/lib/cache"

/**
 * GET /api/pedro/campaigns-with-ads/[clientId]
 *
 * Roy 2026-06-10: replaces de window-based auto-winner detection in
 * creative-refresh met een Ads-Manager-achtige picker. De CM:
 *   1. ziet alleen de geselecteerde campagnes uit `client_campaigns`
 *   2. ziet per campagne een ads-lijst (thumbnail, naam, body excerpt,
 *      30d perf, status)
 *   3. klikt op één ad → Pedro genereert daar 3 iteraties op
 *
 * Geen window/winner-confusie meer. Geen "Geen winners in 30d" leeg-state.
 * De CM bepaalt zelf wat ze willen itereren.
 *
 * Performance: 30d hardcoded (Roy's keuze in plan), gecached via de
 * bestaande pedro_perf cache key zodat opeenvolgende picker-opens
 * dezelfde data binnen 10 min hergebruiken.
 */

export const dynamic = "force-dynamic"

type Ad = {
  adId: string
  adName: string
  adsetId: string
  adsetName: string
  campaignId: string
  campaignName: string
  thumbnailUrl: string
  body: string
  title: string
  description: string
  callToActionType: string
  linkUrl: string
  creativeType: string
  spend30d: number
  leads30d: number
  cpl30d: number | null
  ctr30d: number
  impressions30d: number
  /** Direct deeplink naar deze specifieke ad in Meta Ads Manager.
   *  Roy 2026-06-10: voor de "Open in Ads Manager" knop bij elke ad -
   *  CM kan een screenshot maken / detail-info checken zonder uit de
   *  Hub te hoeven. */
  adsManagerUrl: string
}

type Campaign = {
  id: string
  name: string
  adCount: number
  totalSpend30d: number
  totalLeads30d: number
  avgCpl30d: number | null
  ads: Ad[]
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { clientId } = await params
  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id")
    .eq("monday_item_id", clientId)
    .maybeSingle()

  if (!client) {
    return NextResponse.json({ error: "Klant niet gevonden" }, { status: 404 })
  }
  if (!client.meta_ad_account_id) {
    return NextResponse.json(
      { error: "Geen Meta ad account gekoppeld aan deze klant." },
      { status: 400 },
    )
  }

  // Selected campaign filter (same as creative-refresh route).
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
  if (selectedCampaignIds.size === 0) {
    return NextResponse.json({
      campaigns: [],
      warning:
        "Geen campagnes geselecteerd voor deze klant. Open Beheer → Campagne selectie om campagnes mee te laten tellen.",
    })
  }

  // Fetch all ads in the last 90 days for the selected campaigns.
  // Roy 2026-06-11: bumped from 30 → 90 days. 30d is too narrow when a
  // CM wants to iterate op een bewezen winner uit afgelopen kwartaal -
  // de ad scoorde drie weken geleden goed, draait nu paused of laag.
  // 90d window vangt die af zonder een uitgebreide history-lookup.
  const end = new Date().toISOString().slice(0, 10)
  const startD = new Date()
  startD.setDate(startD.getDate() - 90)
  const start = startD.toISOString().slice(0, 10)

  // Roy 2026-06-10 SPEED: gebruik dezelfde cache-key als creative-refresh
  // zodat zodra een CM de AdPicker opent én daarna Generate klikt, de
  // creative-refresh route de Meta call uit de cache haalt (~5-10s
  // bespaard wanneer de cache warm is).
  const filterTag = `:cf:${[...selectedCampaignIds].sort().join(",")}`
  const cacheKey = `pedro_perf_v2_creative_fix:${client.meta_ad_account_id}:${start}:${end}${filterTag}`
  let ads: Awaited<ReturnType<typeof fetchMetaAdDetails>> = []
  try {
    ads = await cachedFetch(cacheKey, () =>
      fetchMetaAdDetails(
        client.meta_ad_account_id,
        start,
        end,
        selectedCampaignIds,
      ),
    )
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Meta fetch failed" },
      { status: 502 },
    )
  }

  // Group by campaignId.
  const accountId = client.meta_ad_account_id.replace(/^act_/, "")
  const byCampaign = new Map<string, Campaign>()
  for (const a of ads) {
    if (!byCampaign.has(a.campaignId)) {
      byCampaign.set(a.campaignId, {
        id: a.campaignId,
        name: a.campaignName,
        adCount: 0,
        totalSpend30d: 0,
        totalLeads30d: 0,
        avgCpl30d: null,
        ads: [],
      })
    }
    const c = byCampaign.get(a.campaignId)!
    const cpl = a.leads > 0 ? a.spend / a.leads : null
    c.ads.push({
      adId: a.adId,
      adName: a.adName,
      adsetId: a.adsetId,
      adsetName: a.adsetName,
      campaignId: a.campaignId,
      campaignName: a.campaignName,
      thumbnailUrl: a.thumbnailUrl,
      body: a.body,
      title: a.title,
      description: a.description,
      callToActionType: a.callToActionType,
      linkUrl: a.linkUrl,
      creativeType: a.creativeType,
      spend30d: a.spend,
      leads30d: a.leads,
      cpl30d: cpl,
      ctr30d: a.ctr,
      impressions30d: a.impressions,
      adsManagerUrl: `https://www.facebook.com/adsmanager/manage/ads?act=${accountId}&selected_ad_ids=${a.adId}`,
    })
    c.adCount = c.ads.length
    c.totalSpend30d += a.spend
    c.totalLeads30d += a.leads
  }

  // Compute avg CPL per campaign + sort ads by spend desc within each.
  const campaigns: Campaign[] = Array.from(byCampaign.values()).map((c) => {
    c.avgCpl30d = c.totalLeads30d > 0 ? c.totalSpend30d / c.totalLeads30d : null
    c.ads.sort((a, b) => b.spend30d - a.spend30d)
    return c
  })
  // Sort campaigns by total spend desc - most-active campaign first.
  campaigns.sort((a, b) => b.totalSpend30d - a.totalSpend30d)

  return NextResponse.json({
    clientId,
    clientName: client.name,
    windowDays: 90,
    windowStart: start,
    windowEnd: end,
    campaigns,
  })
}
