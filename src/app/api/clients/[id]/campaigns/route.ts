import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaCampaigns } from "@/lib/meta"
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

  const selectedSet = new Set(
    selectedRows.filter((r) => r.is_selected).map((r) => r.meta_campaign_id)
  )

  return NextResponse.json({
    campaigns: campaigns.map((c) => ({ ...c, isSelected: selectedSet.has(c.id) })),
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const { campaignId, campaignName, isSelected } = await req.json()

  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", mondayItemId)
    .single()

  if (!client) return NextResponse.json({ error: "Client not found in Supabase — visit the client page first to sync" }, { status: 404 })

  await supabase.from("client_campaigns").upsert(
    { client_id: client.id, meta_campaign_id: campaignId, campaign_name: campaignName, is_selected: isSelected },
    { onConflict: "client_id,meta_campaign_id" }
  )

  return NextResponse.json({ ok: true })
}
