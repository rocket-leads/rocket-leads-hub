import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaCampaigns } from "@/lib/meta"
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const supabase = await createAdminClient()

  const { data: client } = await supabase
    .from("clients")
    .select("id, meta_ad_account_id")
    .eq("monday_item_id", mondayItemId)
    .single()

  if (!client?.meta_ad_account_id) {
    return NextResponse.json({ campaigns: [], selected: [] })
  }

  const [campaigns, { data: selectedRows }] = await Promise.all([
    fetchMetaCampaigns(client.meta_ad_account_id).catch(() => []),
    supabase
      .from("client_campaigns")
      .select("meta_campaign_id, is_selected")
      .eq("client_id", client.id),
  ])

  const selectedSet = new Set(
    (selectedRows ?? []).filter((r) => r.is_selected).map((r) => r.meta_campaign_id)
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

  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 })

  await supabase.from("client_campaigns").upsert(
    { client_id: client.id, meta_campaign_id: campaignId, campaign_name: campaignName, is_selected: isSelected },
    { onConflict: "client_id,meta_campaign_id" }
  )

  return NextResponse.json({ ok: true })
}
