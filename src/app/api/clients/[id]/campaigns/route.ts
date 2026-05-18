import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaCampaigns } from "@/lib/integrations/meta"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import { matchRocketLeadsCampaign, hasRlPrefix } from "@/lib/clients/campaign-matcher"
import { invalidateKpiCachesForClients } from "@/lib/clients/run-campaign-matcher"
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

  // Auto-assign new ACTIVE campaigns. Two paths, but BOTH gated by the same
  // explicit "RL" name filter — campaigns the Rocket Leads team built always
  // start with `RL` in the name. Anything else on the account belongs to the
  // client (their own ads / agency leftovers) and shouldn't get auto-tracked.
  //
  //   - Single-tenant ad account: any RL-prefixed active campaign without a row
  //     for this client gets auto-tracked (brand-new clients, freshly-launched
  //     campaigns).
  //
  //   - Rocket Leads shared ad account: many unrelated clients share one
  //     account, so we additionally name-match the company part of the
  //     campaign name to a known RL client and only assign at ≥0.95 confidence.
  //
  // User-deselected campaigns already have a DB row with is_selected=false, so
  // their choice persists across status changes either way.
  const isRl = isRocketLeadsAdAccount(adAccountId)
  const knownIdsForCurrentClient = new Set(selectedRows.map((r) => r.meta_campaign_id))
  let newCampaignIdsForCurrentClient: string[] = []
  // Campaign IDs the matcher thinks belong to the CURRENT client at sub-auto
  // confidence (0.7-0.94). Surfaced as one-click "Suggested" pills in the
  // selector — auto-assign still requires ≥0.95.
  const suggestedIdsForCurrentClient = new Set<string>()

  if (isRl) {
    const { data: rlClients } = await supabase
      .from("clients")
      .select("id, name")
      .eq("meta_ad_account_id", adAccountId)
    const candidates = (rlClients ?? []).filter((c): c is { id: string; name: string } => Boolean(c.id && c.name))
    const candidateIds = candidates.map((c) => c.id)

    let globallyAssigned = new Set<string>()
    if (candidateIds.length > 0) {
      const { data: existing } = await supabase
        .from("client_campaigns")
        .select("meta_campaign_id")
        .in("client_id", candidateIds)
      globallyAssigned = new Set((existing ?? []).map((r) => r.meta_campaign_id))
    }

    const newRows: Array<{
      client_id: string
      meta_campaign_id: string
      campaign_name: string
      is_selected: boolean
    }> = []
    for (const c of campaigns) {
      if (c.status !== "ACTIVE") continue
      if (globallyAssigned.has(c.id)) continue
      // RL-only filter: campaigns we built always carry "RL" in the name (the
      // `RL | NL | ...` convention). Skip everything else — client-built ads
      // shouldn't get auto-tracked.
      if (!hasRlPrefix(c.name)) continue
      const match = matchRocketLeadsCampaign(c.name, candidates)
      if (!match) continue
      if (match.confidence >= 0.95) {
        newRows.push({
          client_id: match.clientId,
          meta_campaign_id: c.id,
          campaign_name: c.name,
          is_selected: true,
        })
        if (match.clientId === clientId) newCampaignIdsForCurrentClient.push(c.id)
      } else if (match.confidence >= 0.7 && match.clientId === clientId) {
        suggestedIdsForCurrentClient.add(c.id)
      }
    }

    if (newRows.length > 0) {
      // Awaited so the response reflects the new assignments for the current client.
      await supabase.from("client_campaigns").upsert(newRows, {
        onConflict: "client_id,meta_campaign_id",
      })
      // Clear the stale `rlAccountNoCampaign` flag for the clients that just
      // got campaigns assigned — without this, their KPI rows in the overview
      // keep showing "No Campaign selected" until the next 30-min cron rewrites
      // `kpi_daily`.
      const assignedClientIds = Array.from(new Set(newRows.map((r) => r.client_id)))
      const { data: assignedRows } = await supabase
        .from("clients")
        .select("monday_item_id")
        .in("id", assignedClientIds)
      const affectedItemIds = (assignedRows ?? [])
        .map((r) => r.monday_item_id as string | null)
        .filter((s): s is string => Boolean(s))
      void invalidateKpiCachesForClients(affectedItemIds)
    }
  } else if (clientId) {
    // Same RL-only filter as the shared-account path above — RL-built campaigns
    // get tracked, client's own ads don't (they'd just pollute KPI averages).
    const newActive = campaigns.filter(
      (c) => c.status === "ACTIVE" && !knownIdsForCurrentClient.has(c.id) && hasRlPrefix(c.name),
    )
    if (newActive.length > 0) {
      void supabase.from("client_campaigns").upsert(
        newActive.map((c) => ({
          client_id: clientId,
          meta_campaign_id: c.id,
          campaign_name: c.name,
          is_selected: true,
        })),
        { onConflict: "client_id,meta_campaign_id" }
      )
      newCampaignIdsForCurrentClient = newActive.map((c) => c.id)
    }
  }

  const selectedSet = new Set<string>([
    ...selectedRows.filter((r) => r.is_selected).map((r) => r.meta_campaign_id),
    ...newCampaignIdsForCurrentClient,
  ])

  return NextResponse.json({
    campaigns: campaigns.map((c) => ({
      ...c,
      isSelected: selectedSet.has(c.id),
      isSuggested: suggestedIdsForCurrentClient.has(c.id),
    })),
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

  // Clear the stale `rlAccountNoCampaign` flag for this client so the overview
  // updates without waiting for the next cron tick. Cheap no-op for non-RL
  // accounts since their kpi_daily entries never carry the flag.
  void invalidateKpiCachesForClients([mondayItemId])

  return NextResponse.json({ ok: true })
}
