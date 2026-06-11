import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaAdDetails } from "@/lib/integrations/meta"
import { cachedFetch } from "@/lib/cache"

/**
 * GET /api/pedro/template-candidates/[clientId]?windowDays=90
 *
 * Manual fallback voor Push-to-Meta wanneer het snapshot-path géén
 * bruikbare template heeft (winner ad verwijderd én ad set verdwenen
 * uit Ads Manager). De CM krijgt een lijst van alle ad sets in het
 * account met 90d performance + representative-ad metadata (pageId,
 * IG actor, lead form, link, CTA). Eén ad set picken = die kloont
 * push-to-meta dan als template ipv de stuck snapshot.
 *
 * Niet gefilterd op `client_campaigns.is_selected`: de fallback moet
 * ook werken wanneer de geselecteerde campagnes leeg zijn. Wel geeft
 * de response per candidate aan of de campagne is geselecteerd, zodat
 * de UI dat kan tonen.
 *
 * Roy 2026-06-11.
 */

export const dynamic = "force-dynamic"

type TemplateCandidate = {
  adsetId: string
  adsetName: string
  campaignId: string
  campaignName: string
  campaignIsSelected: boolean
  spend: number
  leads: number
  cpl: number | null
  adCount: number
  /** Most-recent ad in this adset that has all the fields Push-to-Meta
   *  needs to clone a creative. Empty/undefined when no ad in the
   *  90d window has page_id + (link_url || lead_form). */
  representativeAd?: {
    adId: string
    adName: string
    pageId: string
    instagramActorId: string
    leadGenFormId: string
    linkUrl: string
    callToActionType: string
  }
  /** Direct deeplink to the ad set in Ads Manager so the CM can verify
   *  it's the right one before picking. */
  adsManagerUrl: string
}

export async function GET(
  req: NextRequest,
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

  const windowDaysRaw = req.nextUrl.searchParams.get("windowDays")
  const windowDays = Math.max(
    7,
    Math.min(180, parseInt(windowDaysRaw ?? "90", 10) || 90),
  )

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

  const end = new Date().toISOString().slice(0, 10)
  const startD = new Date()
  startD.setDate(startD.getDate() - windowDays)
  const start = startD.toISOString().slice(0, 10)

  const cacheKey = `pedro_template_candidates:${client.meta_ad_account_id}:${start}:${end}`
  let ads: Awaited<ReturnType<typeof fetchMetaAdDetails>> = []
  try {
    ads = await cachedFetch(cacheKey, () =>
      fetchMetaAdDetails(client.meta_ad_account_id, start, end),
    )
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Meta fetch failed" },
      { status: 502 },
    )
  }

  // Group by adsetId. Pick the most-usable ad per adset as the
  // representative (has pageId + (linkUrl || leadGenFormId), prefers
  // higher spend so the rep is the most-mature creative).
  type Bucket = {
    adsetId: string
    adsetName: string
    campaignId: string
    campaignName: string
    spend: number
    leads: number
    adCount: number
    rep?: (typeof ads)[number]
  }
  const buckets = new Map<string, Bucket>()
  for (const a of ads) {
    if (!a.adsetId) continue
    let b = buckets.get(a.adsetId)
    if (!b) {
      b = {
        adsetId: a.adsetId,
        adsetName: a.adsetName,
        campaignId: a.campaignId,
        campaignName: a.campaignName,
        spend: 0,
        leads: 0,
        adCount: 0,
      }
      buckets.set(a.adsetId, b)
    }
    b.spend += a.spend
    b.leads += a.leads
    b.adCount += 1
    const usable = !!a.pageId && (!!a.linkUrl || !!a.leadGenFormId)
    if (usable) {
      if (!b.rep || a.spend > b.rep.spend) b.rep = a
    }
  }

  const accountId = client.meta_ad_account_id.replace(/^act_/, "")
  const candidates: TemplateCandidate[] = Array.from(buckets.values())
    .map<TemplateCandidate>((b) => ({
      adsetId: b.adsetId,
      adsetName: b.adsetName,
      campaignId: b.campaignId,
      campaignName: b.campaignName,
      campaignIsSelected: selectedCampaignIds.has(b.campaignId),
      spend: Math.round(b.spend * 100) / 100,
      leads: b.leads,
      cpl: b.leads > 0 ? Math.round((b.spend / b.leads) * 100) / 100 : null,
      adCount: b.adCount,
      representativeAd: b.rep
        ? {
            adId: b.rep.adId,
            adName: b.rep.adName,
            pageId: b.rep.pageId,
            instagramActorId: b.rep.instagramActorId,
            leadGenFormId: b.rep.leadGenFormId,
            linkUrl: b.rep.linkUrl,
            callToActionType: b.rep.callToActionType,
          }
        : undefined,
      adsManagerUrl: `https://www.facebook.com/adsmanager/manage/adsets?act=${accountId}&selected_adset_ids=${b.adsetId}`,
    }))
    // Sort: usable first, then by spend desc.
    .sort((a, b) => {
      const aUsable = a.representativeAd ? 1 : 0
      const bUsable = b.representativeAd ? 1 : 0
      if (aUsable !== bUsable) return bUsable - aUsable
      return b.spend - a.spend
    })

  return NextResponse.json({
    clientId,
    clientName: client.name,
    adAccountId: client.meta_ad_account_id,
    windowDays,
    windowStart: start,
    windowEnd: end,
    candidates,
  })
}
