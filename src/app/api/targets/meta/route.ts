import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getToken } from "@/lib/integrations/meta"
import type { MetaTargetsData } from "@/types/targets"

const AD_ACCOUNT_ID = "act_701293097368776"
const GRAPH_API_VERSION = "v20.0"

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get("startDate")
  const endDate = searchParams.get("endDate")

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 })
  }

  try {
    const token = await getToken()
    const timeRange = JSON.stringify({ since: startDate, until: endDate })
    const fields = "spend,impressions,clicks,cpc,cpm,ctr"
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${AD_ACCOUNT_ID}/insights?time_range=${encodeURIComponent(timeRange)}&fields=${fields}&level=account&access_token=${token}`

    const resp = await fetch(url, { next: { revalidate: 300 } })
    const data = await resp.json()

    if (data.error) {
      throw new Error(data.error.message || "Meta API error")
    }

    const insights = data.data?.[0]
    const result: MetaTargetsData = insights
      ? {
          spend: parseFloat(insights.spend || "0"),
          impressions: parseInt(insights.impressions || "0", 10),
          clicks: parseInt(insights.clicks || "0", 10),
          cpc: parseFloat(insights.cpc || "0"),
          cpm: parseFloat(insights.cpm || "0"),
          ctr: parseFloat(insights.ctr || "0"),
        }
      : { spend: 0, impressions: 0, clicks: 0, cpc: 0, cpm: 0, ctr: 0 }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" },
    })
  } catch (error) {
    console.error("[targets/meta]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
