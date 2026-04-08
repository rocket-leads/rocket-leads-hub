import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

const META_API_BASE = "https://graph.facebook.com/v20.0"

async function getToken(): Promise<string> {
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
