import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaAdDetails, type MetaAdDetail } from "@/lib/integrations/meta"
import { NextRequest, NextResponse } from "next/server"

export type { MetaAdDetail }

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const { searchParams } = req.nextUrl
  const startDate = searchParams.get("startDate") ?? ""
  const endDate = searchParams.get("endDate") ?? ""
  const adAccountIdParam = searchParams.get("adAccountId") ?? ""
  const selectedCampaignIdsParam = searchParams.get("selectedCampaignIds") ?? ""

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("meta_ad_account_id")
    .eq("monday_item_id", mondayItemId)
    .single()

  const adAccountId = client?.meta_ad_account_id ?? adAccountIdParam
  if (!adAccountId) {
    return NextResponse.json({ ads: [] })
  }

  let selectedCampaignIds: Set<string> | undefined
  if (selectedCampaignIdsParam) {
    selectedCampaignIds = new Set(selectedCampaignIdsParam.split(",").filter(Boolean))
  }

  const ads = await fetchMetaAdDetails(adAccountId, startDate, endDate, selectedCampaignIds).catch((e) => {
    console.error("Meta ad details error:", e)
    return []
  })

  return NextResponse.json(
    { ads },
    { headers: { "Cache-Control": "private, s-maxage=120, stale-while-revalidate=300" } },
  )
}
