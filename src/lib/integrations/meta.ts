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
  /** Canonical lead count — prefers `lead`, falls back to max of per-source aliases */
  leads: number
}

/**
 * Count leads from a Meta `actions` array. Meta returns the same conversion
 * under multiple aliases (`lead`, `onsite_conversion.lead_grouped`,
 * `leadgen_grouped`, `offsite_conversion.fb_pixel_lead`, ...) — summing all of
 * them double-counts. Prefer the canonical `lead` total; fall back to the max
 * of the per-source counts when `lead` isn't reported.
 */
function countLeads(actions: Array<{ action_type: string; value: string }> | undefined): number {
  if (!actions?.length) return 0
  const lookup = (type: string) =>
    parseInt(actions.find((a) => a.action_type === type)?.value ?? "0", 10) || 0

  const unified = lookup("lead")
  if (unified > 0) return unified

  return Math.max(
    lookup("onsite_conversion.lead_grouped"),
    lookup("offsite_conversion.fb_pixel_lead"),
    lookup("leadgen_grouped"),
  )
}

async function fetchAllPages<T>(
  url: string,
  options: { bypassCache?: boolean } = {},
): Promise<T[]> {
  const results: T[] = []
  let nextUrl: string | null = url

  while (nextUrl) {
    // Same reasoning as the Monday `gql` helper: when the user explicitly
    // clicked Refresh, Next.js' 5-minute fetch cache must not silently
    // re-serve a stale Meta response.
    const fetchOpts = options.bypassCache
      ? ({ cache: "no-store" } as const)
      : ({ next: { revalidate: 300 } } as const)
    const res: Response = await fetch(nextUrl, fetchOpts)
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
  endDate: string,
  options: { bypassCache?: boolean } = {},
): Promise<MetaInsight[]> {
  const token = await getToken()
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const timeRange = encodeURIComponent(JSON.stringify({ since: startDate, until: endDate }))
  const url = `${META_API_BASE}/${accountId}/insights?fields=campaign_id,campaign_name,spend,actions&level=campaign&time_range=${timeRange}&limit=100&access_token=${token}`

  const data = await fetchAllPages<{
    campaign_id: string
    campaign_name: string
    spend: string
    actions?: Array<{ action_type: string; value: string }>
  }>(url, { bypassCache: options.bypassCache })
  return data.map((d) => ({
    campaignId: d.campaign_id,
    campaignName: d.campaign_name,
    spend: parseFloat(d.spend ?? "0"),
    leads: countLeads(d.actions),
  }))
}

export type MetaDailyInsight = {
  campaignId: string
  campaignName: string
  /** YYYY-MM-DD */
  date: string
  spend: number
  leads: number
}

/**
 * Per-day, per-campaign breakdown via Meta's `time_increment=1`. Use this when you need
 * a daily trend (sparklines, time-series charts). Aggregate with `aggregateMetaDailyToTotals`
 * or `aggregateMetaDailyByDate` to recover totals — saves a separate roundtrip.
 *
 * Note: Meta omits days with zero activity, so the returned array may be sparser than
 * the requested range. Callers rendering a continuous timeline should fill missing dates.
 */
export async function fetchMetaInsightsDaily(
  adAccountId: string,
  startDate: string,
  endDate: string
): Promise<MetaDailyInsight[]> {
  const token = await getToken()
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const timeRange = encodeURIComponent(JSON.stringify({ since: startDate, until: endDate }))
  const url = `${META_API_BASE}/${accountId}/insights?fields=campaign_id,campaign_name,date_start,spend,actions&level=campaign&time_range=${timeRange}&time_increment=1&limit=1000&access_token=${token}`

  const data = await fetchAllPages<{
    campaign_id: string
    campaign_name: string
    date_start: string
    spend: string
    actions?: Array<{ action_type: string; value: string }>
  }>(url)
  return data.map((d) => ({
    campaignId: d.campaign_id,
    campaignName: d.campaign_name,
    date: d.date_start,
    spend: parseFloat(d.spend ?? "0"),
    leads: countLeads(d.actions),
  }))
}

/** Sum daily rows back to per-campaign totals (drop-in replacement for fetchMetaInsights output). */
export function aggregateMetaDailyToTotals(daily: MetaDailyInsight[]): MetaInsight[] {
  const map = new Map<string, MetaInsight>()
  for (const d of daily) {
    const cur = map.get(d.campaignId)
    if (cur) {
      cur.spend += d.spend
      cur.leads += d.leads
    } else {
      map.set(d.campaignId, { campaignId: d.campaignId, campaignName: d.campaignName, spend: d.spend, leads: d.leads })
    }
  }
  return Array.from(map.values())
}

/** Sum daily rows by date (across campaigns), sorted ascending. Missing dates are NOT filled. */
export function aggregateMetaDailyByDate(daily: MetaDailyInsight[]): Array<{ date: string; spend: number; leads: number }> {
  const map = new Map<string, { date: string; spend: number; leads: number }>()
  for (const d of daily) {
    const cur = map.get(d.date)
    if (cur) {
      cur.spend += d.spend
      cur.leads += d.leads
    } else {
      map.set(d.date, { date: d.date, spend: d.spend, leads: d.leads })
    }
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
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
  leads: number
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

  const url = `${META_API_BASE}/${accountId}/insights?fields=ad_id,ad_name,adset_name,campaign_id,spend,impressions,clicks,ctr,cpc,actions&level=ad&time_range=${timeRange}&limit=200&access_token=${token}`
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
    actions?: Array<{ action_type: string; value: string }>
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
    const leads = countLeads(d.actions)
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
      leads,
      body: creative?.body ?? "",
      creativeType: creative?.creativeType ?? "unknown",
      thumbnailUrl: creative?.thumbnailUrl ?? "",
    }
  })
}
