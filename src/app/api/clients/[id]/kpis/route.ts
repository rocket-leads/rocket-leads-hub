import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaInsights } from "@/lib/integrations/meta"
import { fetchClientBoardItems } from "@/lib/integrations/monday"
import { calculateKpis } from "@/lib/clients/kpis"
import { detectMondayActivity } from "@/lib/clients/monday-activity"
import { cachedFetch } from "@/lib/cache"
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
  // Set by the page-level Refresh button to bypass the 10-minute cache_store
  // entries for Monday board items + Meta insights. Without this, clicking
  // Refresh only invalidates browser-side caches while the server keeps
  // returning whatever was cached on the first load.
  const forceRefresh = searchParams.get("forceRefresh") === "1"

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

  type MondayItems = Awaited<ReturnType<typeof fetchClientBoardItems>>
  type MondayResult = { ok: boolean; items: MondayItems }

  const [insights, monday] = await Promise.all([
    adAccountId
      ? cachedFetch(
          `meta_insights:${adAccountId}:${startDate}:${endDate}`,
          () => fetchMetaInsights(adAccountId, startDate, endDate, { bypassCache: forceRefresh }),
          undefined,
          { bypass: forceRefresh },
        ).catch((e) => { console.error("Meta insights error:", e); return [] as Awaited<ReturnType<typeof fetchMetaInsights>> })
      : Promise.resolve([]),
    clientBoardId
      ? cachedFetch(
          `monday_board_items:${clientBoardId}`,
          () => fetchClientBoardItems(clientBoardId, client?.column_mapping_override ?? undefined, { bypassCache: forceRefresh }),
          undefined,
          { bypass: forceRefresh },
        )
          .then((items): MondayResult => ({ ok: true, items }))
          .catch((e): MondayResult => {
            console.error("Monday board error:", e instanceof Error ? e.message : e)
            return { ok: false, items: [] }
          })
      : Promise.resolve<MondayResult>({ ok: false, items: [] }),
  ])
  const leadItems = monday.items

  const relevantInsights = selectedCampaignIds.size > 0
    ? insights.filter((i) => selectedCampaignIds.has(i.campaignId))
    : insights
  const adSpend = relevantInsights.reduce((sum, i) => sum + i.spend, 0)

  const kpis = calculateKpis(adSpend, leadItems, startDate, endDate, takenCallStatusValue)

  // Fall back to Meta-reported leads whenever Monday returns zero in this window but Meta
  // reports leads — covers no board, access denied, broken Zapier sync, wrong column mapping.
  // Booked/taken/deals stay as-is since Meta can't track those.
  const metaLeadsReported = relevantInsights.reduce((sum, i) => sum + i.leads, 0)
  if (kpis.leads === 0 && metaLeadsReported > 0) {
    kpis.leads = metaLeadsReported
    kpis.costPerLead = adSpend / metaLeadsReported
  }

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
    headers: {
      "Cache-Control": forceRefresh
        ? "no-store"
        : "private, s-maxage=60, stale-while-revalidate=300",
    },
  })
}
