import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { fetchMetaCampaigns } from "@/lib/integrations/meta"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import { mondayStatusToHub, hubStatusToMondayLabel, type ClientStatus } from "@/lib/clients/status"
import { updateClientField } from "@/lib/clients/edit"

export const maxDuration = 300

type SyncResult = {
  mondayItemId: string
  name: string
  before: ClientStatus
  after: ClientStatus
  reason: string
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startTime = Date.now()

  try {
    const { current } = await fetchBothBoards()

    // Only auto-flip Live ↔ On Hold. Onboarding (manual setup) and Churned
    // (manual termination) are explicitly out of scope — those are human
    // decisions and should never be overwritten by Meta state.
    const candidates = current.filter((c) => {
      if (!c.metaAdAccountId) return false
      const hub = mondayStatusToHub(c.campaignStatus, "current")
      return hub === "live" || hub === "on_hold"
    })

    // Resolve selected campaigns per client so that for shared RL ad accounts
    // we only count the campaigns this client is responsible for. For a
    // client-owned ad account with no selection, treat all campaigns as theirs.
    const supabase = await createAdminClient()
    const { data: clientRows } = await supabase
      .from("clients")
      .select("id, monday_item_id")
      .in(
        "monday_item_id",
        candidates.map((c) => c.mondayItemId),
      )

    const itemToClientId = new Map<string, string>()
    for (const row of clientRows ?? []) itemToClientId.set(row.monday_item_id, row.id)

    const clientIds = Array.from(itemToClientId.values())
    const selectedByItem = new Map<string, Set<string>>()
    if (clientIds.length > 0) {
      const { data: campaignRows } = await supabase
        .from("client_campaigns")
        .select("client_id, meta_campaign_id, is_selected")
        .in("client_id", clientIds)
        .eq("is_selected", true)

      const clientIdToItem = new Map<string, string>()
      for (const [item, id] of itemToClientId.entries()) clientIdToItem.set(id, item)

      for (const row of campaignRows ?? []) {
        const item = clientIdToItem.get(row.client_id)
        if (!item) continue
        if (!selectedByItem.has(item)) selectedByItem.set(item, new Set())
        selectedByItem.get(item)!.add(row.meta_campaign_id)
      }
    }

    const flipped: SyncResult[] = []
    const unchanged: string[] = []
    const errors: Array<{ mondayItemId: string; error: string }> = []

    // Sequential to avoid hammering Monday + Meta. With ~50 clients this still
    // completes in well under the 5-minute Vercel limit.
    for (const client of candidates) {
      try {
        const campaigns = await fetchMetaCampaigns(client.metaAdAccountId)
        const selected = selectedByItem.get(client.mondayItemId)

        // RL ad accounts: must have explicit selections — otherwise we can't tell
        // which campaigns belong to this client. Skip if no selection is set.
        if (isRocketLeadsAdAccount(client.metaAdAccountId)) {
          if (!selected || selected.size === 0) continue
        }

        const relevant = selected && selected.size > 0
          ? campaigns.filter((c) => selected.has(c.id))
          : campaigns

        const activeCount = relevant.filter((c) => c.status === "ACTIVE").length
        const desired: ClientStatus = activeCount > 0 ? "live" : "on_hold"
        const currentHub = mondayStatusToHub(client.campaignStatus, "current")

        if (currentHub === desired) {
          unchanged.push(client.mondayItemId)
          continue
        }

        await updateClientField(client.mondayItemId, {
          fieldKey: "campaign_status",
          label: hubStatusToMondayLabel(desired),
        })

        flipped.push({
          mondayItemId: client.mondayItemId,
          name: client.name,
          before: currentHub,
          after: desired,
          reason: activeCount > 0
            ? `${activeCount} active Meta campaign${activeCount === 1 ? "" : "s"}`
            : "No active Meta campaigns",
        })
      } catch (e) {
        errors.push({
          mondayItemId: client.mondayItemId,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    return NextResponse.json({
      ok: true,
      duration: `${duration}s`,
      checked: candidates.length,
      flipped,
      unchangedCount: unchanged.length,
      errorCount: errors.length,
      errors: errors.slice(0, 10),
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
