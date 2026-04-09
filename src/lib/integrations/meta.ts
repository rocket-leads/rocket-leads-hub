import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

const META_API_BASE = "https://graph.facebook.com/v20.0"

export async function getToken(): Promise<string> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "meta")
    .single()
  if (!data) throw new Error("Meta token not configured. Go to Settings → API Tokens.")
  return decrypt(data.token_encrypted)
}

export type MetaCampaign = {
  id: string
  name: string
  status: string
}

export type MetaInsight = {
  campaignId: string
  campaignName: string
  spend: number
}

async function fetchAllPages<T>(url: string): Promise<T[]> {
  const results: T[] = []
  let nextUrl: string | null = url

  while (nextUrl) {
    const res: Response = await fetch(nextUrl, { next: { revalidate: 300 } })
    if (!res.ok) {
      const status = res.status
      const err = await res.json()
      throw new Error(err.error?.message ?? `Meta API error ${status}`)
    }
    const json = await res.json()
    if (json.error) throw new Error(json.error.message)
    results.push(...(json.data ?? []))
    nextUrl = json.paging?.next ?? null
  }

  return results
}

export async function fetchMetaCampaigns(adAccountId: string): Promise<MetaCampaign[]> {
  const token = await getToken()
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const url = `${META_API_BASE}/${accountId}/campaigns?fields=id,name,status&limit=100&access_token=${token}`
  return fetchAllPages<MetaCampaign>(url)
}

export async function fetchMetaInsights(
  adAccountId: string,
  startDate: string,
  endDate: string
): Promise<MetaInsight[]> {
  const token = await getToken()
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const timeRange = encodeURIComponent(JSON.stringify({ since: startDate, until: endDate }))
  const url = `${META_API_BASE}/${accountId}/insights?fields=campaign_id,campaign_name,spend&level=campaign&time_range=${timeRange}&limit=100&access_token=${token}`

  const data = await fetchAllPages<{ campaign_id: string; campaign_name: string; spend: string }>(url)
  return data.map((d) => ({
    campaignId: d.campaign_id,
    campaignName: d.campaign_name,
    spend: parseFloat(d.spend ?? "0"),
  }))
}

export type MetaAdDetail = {
  adId: string
  adName: string
  adsetName: string
  status: string
  spend: number
  impressions: number
  clicks: number
  ctr: number
  cpc: number
  body: string
  creativeType: "video" | "image" | "dynamic" | "unknown"
  thumbnailUrl: string
}

export async function fetchMetaAdDetails(
  adAccountId: string,
  startDate: string,
  endDate: string,
  campaignIds?: Set<string>,
): Promise<MetaAdDetail[]> {
  const token = await getToken()
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const timeRange = encodeURIComponent(JSON.stringify({ since: startDate, until: endDate }))

  const url = `${META_API_BASE}/${accountId}/insights?fields=ad_id,ad_name,adset_name,campaign_id,spend,impressions,clicks,ctr,cpc&level=ad&time_range=${timeRange}&limit=200&access_token=${token}`
  const insightsData = await fetchAllPages<{
    ad_id: string
    ad_name: string
    adset_name: string
    campaign_id: string
    spend: string
    impressions: string
    clicks: string
    ctr: string
    cpc: string
  }>(url)

  const filtered = campaignIds && campaignIds.size > 0
    ? insightsData.filter((d) => campaignIds.has(d.campaign_id))
    : insightsData

  const adIds = filtered.map((d) => d.ad_id).filter(Boolean)
  const creativeMap = new Map<string, { body: string; creativeType: MetaAdDetail["creativeType"]; thumbnailUrl: string }>()

  if (adIds.length > 0) {
    for (let i = 0; i < adIds.length; i += 50) {
      const batch = adIds.slice(i, i + 50)
      const adsUrl = `${META_API_BASE}/?ids=${batch.join(",")}&fields=creative{body,object_type,thumbnail_url}&access_token=${token}`
      try {
        const res: Response = await fetch(adsUrl, { next: { revalidate: 300 } })
        if (res.ok) {
          const json = await res.json()
          for (const [adId, adData] of Object.entries(json)) {
            const creative = (adData as { creative?: { data?: { body?: string; object_type?: string; thumbnail_url?: string } } }).creative?.data
            let creativeType: MetaAdDetail["creativeType"] = "unknown"
            const objectType = (creative?.object_type ?? "").toUpperCase()
            if (objectType.includes("VIDEO")) creativeType = "video"
            else if (objectType.includes("PHOTO") || objectType.includes("IMAGE") || objectType.includes("LINK")) creativeType = "image"

            const adName = filtered.find((d) => d.ad_id === adId)?.ad_name ?? ""
            if (/dynamic|dyn\b|flexible/i.test(adName) || objectType.includes("DYNAMIC")) {
              creativeType = "dynamic"
            }

            creativeMap.set(adId, {
              body: creative?.body ?? "",
              creativeType,
              thumbnailUrl: creative?.thumbnail_url ?? "",
            })
          }
        }
      } catch {
        // Continue without creative details
      }
    }
  }

  return filtered.map((d) => {
    const creative = creativeMap.get(d.ad_id)
    return {
      adId: d.ad_id,
      adName: d.ad_name,
      adsetName: d.adset_name,
      status: "ACTIVE",
      spend: parseFloat(d.spend ?? "0"),
      impressions: parseInt(d.impressions ?? "0", 10),
      clicks: parseInt(d.clicks ?? "0", 10),
      ctr: parseFloat(d.ctr ?? "0"),
      cpc: parseFloat(d.cpc ?? "0"),
      body: creative?.body ?? "",
      creativeType: creative?.creativeType ?? "unknown",
      thumbnailUrl: creative?.thumbnailUrl ?? "",
    }
  })
}
