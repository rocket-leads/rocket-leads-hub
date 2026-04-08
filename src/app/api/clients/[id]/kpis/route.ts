import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaInsights } from "@/lib/integrations/meta"
import { fetchClientBoardItems } from "@/lib/integrations/monday"
import { calculateKpis } from "@/lib/clients/kpis"
import { detectMondayActivity } from "@/lib/clients/monday-activity"
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
  const selectedCampaignIdsParam = searchParams.get("selectedCampaignIds") ?? ""

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  const [clientResult, { data: settingsRow }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, meta_ad_account_id, monday_client_board_id, column_mapping_override")
      .eq("monday_item_id", mondayItemId)
      .single()
      .then((res) => {
        if (res.error && (res.error.code === "PGRST204" || res.error.message?.includes("monday_client_board_id"))) {
          console.warn("[kpis] monday_client_board_id column missing — querying without it")
          return supabase.from("clients").select("id, meta_ad_account_id, column_mapping_override").eq("monday_item_id", mondayItemId).single()
        }
        return res
      }),
    supabase.from("settings").select("value").eq("key", "board_config").single(),
  ])
  const client = clientResult.data as { id: string; meta_ad_account_id: string | null; monday_client_board_id?: string | null; column_mapping_override?: Record<string, string> | null } | null

  // Fall back to query params if Supabase record not yet synced
  const adAccountId = client?.meta_ad_account_id ?? adAccountIdParam
  const clientBoardId = client?.monday_client_board_id ?? clientBoardIdParam

  const takenCallStatusValue =
    (settingsRow?.value as { client_board_columns?: { taken_call_status_value?: string } })
      ?.client_board_columns?.taken_call_status_value ?? "Afspraak"

  // Prefer campaign IDs passed directly from the client (avoids race conditions with Supabase sync)
  // Fall back to querying Supabase if not provided
  let selectedCampaignIds = new Set<string>()
  if (selectedCampaignIdsParam) {
    for (const id of selectedCampaignIdsParam.split(",").filter(Boolean)) {
      selectedCampaignIds.add(id)
    }
  } else if (client?.id) {
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
      ? fetchClientBoardItems(clientBoardId, client?.column_mapping_override ?? undefined).catch((e) => { console.error("Monday board error:", e); return [] })
      : Promise.resolve([]),
  ])

  const relevantInsights = selectedCampaignIds.size > 0
    ? insights.filter((i) => selectedCampaignIds.has(i.campaignId))
    : insights
  const adSpend = relevantInsights.reduce((sum, i) => sum + i.spend, 0)

  const kpis = calculateKpis(adSpend, leadItems, startDate, endDate, takenCallStatusValue)

  // Auto-detect Monday activity and update Supabase (fire-and-forget)
  if (leadItems.length > 0 && client?.id) {
    const isActive = detectMondayActivity(leadItems)
    void supabase
      .from("clients")
      .update({ monday_active: isActive })
      .eq("monday_item_id", mondayItemId)
  }

  return NextResponse.json({
    ...kpis,
    _debug: {
      adAccountId: adAccountId || null,
      clientBoardId: clientBoardId || null,
      leadItemsCount: leadItems.length,
      insightsCount: insights.length,
      takenCallStatusValue,
      columnOverrides: client?.column_mapping_override ?? null,
      leadStatus2Sample: leadItems.slice(0, 10).map((i) => ({
        name: i.name,
        leadStatus: i.leadStatus,
        leadStatus2: i.leadStatus2,
        dateAppointment: i.dateAppointment,
      })),
    },
  }, {
    headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
  })
}
