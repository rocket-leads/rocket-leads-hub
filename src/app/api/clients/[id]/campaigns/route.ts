import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaCampaigns } from "@/lib/integrations/meta"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  // adAccountId can be passed as query param to avoid Supabase race condition
  const adAccountIdParam = req.nextUrl.searchParams.get("adAccountId")

  const supabase = await createAdminClient()

  const { data: client } = await supabase
    .from("clients")
    .select("id, meta_ad_account_id")
    .eq("monday_item_id", mondayItemId)
    .single()

  const adAccountId = client?.meta_ad_account_id ?? adAccountIdParam
  if (!adAccountId) {
    return NextResponse.json({ campaigns: [], error: "No Meta Ad Account ID found" })
  }

  // Upsert client if not yet in Supabase (handles race condition)
  let clientId = client?.id
  if (!clientId && adAccountIdParam) {
    const { data: upserted } = await supabase
      .from("clients")
      .upsert({ monday_item_id: mondayItemId, monday_board_type: "current", name: mondayItemId, meta_ad_account_id: adAccountIdParam }, { onConflict: "monday_item_id" })
      .select("id")
      .single()
    clientId = upserted?.id
  }

  const [campaigns, selectedRows] = await Promise.all([
    fetchMetaCampaigns(adAccountId),
    clientId
      ? supabase.from("client_campaigns").select("meta_campaign_id, is_selected").eq("client_id", clientId).then(({ data }) => data ?? [])
      : Promise.resolve([]),
  ])

  // Auto-select new ACTIVE campaigns — but never for the Rocket Leads ad account, where
  // multiple unrelated clients share the same ad account and "all active" would pull in
  // every other client's spend. For RL accounts, the user must explicitly select campaigns.
  // Otherwise: any active campaign without a `client_campaigns` row is treated as "track
  // this by default" — covers brand-new clients and freshly-launched campaigns on existing
  // ones. User-deselected campaigns already have a DB row with is_selected=false, so their
  // choice persists across status changes.
  const skipAutoSelect = isRocketLeadsAdAccount(adAccountId)
  const knownIds = new Set(selectedRows.map((r) => r.meta_campaign_id))
  const newActive = skipAutoSelect
    ? []
    : campaigns.filter((c) => c.status === "ACTIVE" && !knownIds.has(c.id))

  if (newActive.length > 0 && clientId) {
    void supabase.from("client_campaigns").upsert(
      newActive.map((c) => ({
        client_id: clientId,
        meta_campaign_id: c.id,
        campaign_name: c.name,
        is_selected: true,
      })),
      { onConflict: "client_id,meta_campaign_id" }
    )
  }

  const selectedSet = new Set<string>([
    ...selectedRows.filter((r) => r.is_selected).map((r) => r.meta_campaign_id),
    ...newActive.map((c) => c.id),
  ])

  return NextResponse.json({
    campaigns: campaigns.map((c) => ({ ...c, isSelected: selectedSet.has(c.id) })),
  }, {
    headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const body = await req.json()

  const items: Array<{ campaignId: string; campaignName: string; isSelected: boolean }> =
    Array.isArray(body.campaigns)
      ? body.campaigns
      : [{ campaignId: body.campaignId, campaignName: body.campaignName, isSelected: body.isSelected }]

  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", mondayItemId)
    .single()

  if (!client) return NextResponse.json({ error: "Client not found in Supabase — visit the client page first to sync" }, { status: 404 })

  await supabase.from("client_campaigns").upsert(
    items.map((it) => ({
      client_id: client.id,
      meta_campaign_id: it.campaignId,
      campaign_name: it.campaignName,
      is_selected: it.isSelected,
    })),
    { onConflict: "client_id,meta_campaign_id" }
  )

  return NextResponse.json({ ok: true })
}
