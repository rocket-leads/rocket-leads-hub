import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaInsights } from "@/lib/meta"
import { fetchClientBoardItems } from "@/lib/monday"
import { calculateKpis } from "@/lib/kpis"
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const { searchParams } = req.nextUrl
  const startDate = searchParams.get("startDate") ?? ""
  const endDate = searchParams.get("endDate") ?? ""
  const adAccountIdParam = searchParams.get("adAccountId") ?? ""
  const clientBoardIdParam = searchParams.get("clientBoardId") ?? ""

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  const [{ data: client }, { data: settingsRow }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, meta_ad_account_id, monday_client_board_id")
      .eq("monday_item_id", mondayItemId)
      .single(),
    supabase.from("settings").select("value").eq("key", "board_config").single(),
  ])

  // Fall back to query params if Supabase record not yet synced
  const adAccountId = client?.meta_ad_account_id ?? adAccountIdParam
  const clientBoardId = client?.monday_client_board_id ?? clientBoardIdParam

  const takenCallStatusValue =
    (settingsRow?.value as { client_board_columns?: { taken_call_status_value?: string } })
      ?.client_board_columns?.taken_call_status_value ?? "Afspraak"

  const selectedCampaignIds = new Set<string>()
  if (client?.id) {
    const { data: selectedRows } = await supabase
      .from("client_campaigns")
      .select("meta_campaign_id")
      .eq("client_id", client.id)
      .eq("is_selected", true)
    for (const r of selectedRows ?? []) selectedCampaignIds.add(r.meta_campaign_id)
  }

  const [insights, leadItems] = await Promise.all([
    adAccountId
      ? fetchMetaInsights(adAccountId, startDate, endDate).catch((e) => { console.error("Meta insights error:", e); return [] })
      : Promise.resolve([]),
    clientBoardId
      ? fetchClientBoardItems(clientBoardId).catch((e) => { console.error("Monday board error:", e); return [] })
      : Promise.resolve([]),
  ])

  const relevantInsights = selectedCampaignIds.size > 0
    ? insights.filter((i) => selectedCampaignIds.has(i.campaignId))
    : insights
  const adSpend = relevantInsights.reduce((sum, i) => sum + i.spend, 0)

  const kpis = calculateKpis(adSpend, leadItems, startDate, endDate, takenCallStatusValue)

  return NextResponse.json({
    ...kpis,
    _debug: {
      adAccountId: adAccountId || null,
      clientBoardId: clientBoardId || null,
      leadItemsCount: leadItems.length,
      insightsCount: insights.length,
    },
  })
}
