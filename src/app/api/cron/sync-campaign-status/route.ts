import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { fetchMetaCampaigns } from "@/lib/integrations/meta"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import {
  mondayStatusToHub,
  hubStatusToMondayLabel,
  mondayLabelToOnboardingPhase,
  PHASE_LABELS,
  type ClientStatus,
} from "@/lib/clients/status"
import { updateClientField } from "@/lib/clients/edit"
import { startCronRun } from "@/lib/observability/cron-runs"

// Onboarding phases that should auto-advance to "LAUNCH 🚀" once an active
// Meta campaign appears. Off-track phases (`on_hold`, `debt_collection`) are
// intentionally excluded — those are explicit human decisions and stay put.
const ADVANCEABLE_PHASES = new Set([
  "kickoff_scheduled",
  "waiting_on_client",
  "create_campaign",
  "waiting_for_feedback",
])

export const maxDuration = 300

type SyncResult = {
  mondayItemId: string
  name: string
  /** Raw Monday label before the flip (e.g. "Live", "Waiting for feedback"). */
  before: string
  /** Raw Monday label written (e.g. "On hold", "LAUNCH 🚀"). */
  after: string
  reason: string
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tracker = startCronRun("sync-campaign-status")
  const startTime = Date.now()

  try {
    const { onboarding, current } = await fetchBothBoards()

    // Two passes share the same Meta + selection lookups:
    //   - current-board pass: auto-flip Live ↔ On Hold based on active campaigns
    //   - onboarding-board pass: auto-advance to "LAUNCH 🚀" once any selected
    //     active campaign appears, but only from the in-progress phases
    //     (Kickoff scheduled / Waiting on client / Create campaign / Waiting
    //     for feedback). Off-track phases (On hold, Debt collection agency)
    //     are explicit human decisions and stay put.
    const currentCandidates = current.filter((c) => {
      if (!c.metaAdAccountId) return false
      const hub = mondayStatusToHub(c.campaignStatus, "current")
      return hub === "live" || hub === "on_hold"
    })
    const onboardingCandidates = onboarding.filter((c) => {
      if (!c.metaAdAccountId) return false
      const phase = mondayLabelToOnboardingPhase(c.campaignStatus)
      return phase !== null && ADVANCEABLE_PHASES.has(phase)
    })
    const candidates = [...currentCandidates, ...onboardingCandidates]

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

        if (client.boardType === "onboarding") {
          // Onboarding pass: forward-only flip to "LAUNCH 🚀" once any active
          // campaign appears. Never auto-flip backward — going from LAUNCH back
          // to "Waiting for feedback" would be confusing; an AM should make
          // that call explicitly via the phase dropdown.
          if (activeCount === 0) {
            unchanged.push(client.mondayItemId)
            continue
          }
          const launchLabel = PHASE_LABELS.launch
          if (client.campaignStatus === launchLabel) {
            unchanged.push(client.mondayItemId)
            continue
          }
          await updateClientField(client.mondayItemId, {
            fieldKey: "campaign_status",
            label: launchLabel,
          })
          flipped.push({
            mondayItemId: client.mondayItemId,
            name: client.name,
            before: client.campaignStatus || "—",
            after: launchLabel,
            reason: `${activeCount} active Meta campaign${activeCount === 1 ? "" : "s"} — auto-advanced to LAUNCH`,
          })
          continue
        }

        // Current-board pass: Live ↔ On Hold flip based on active count.
        const desired: ClientStatus = activeCount > 0 ? "live" : "on_hold"
        const currentHub = mondayStatusToHub(client.campaignStatus, "current")

        // Skip clients whose Monday status is empty / unmapped — auto-flipping
        // them would silently set a status finance hasn't reviewed yet. They
        // surface as "—" in the Hub; admin should explicitly pick a status
        // before the cron starts toggling.
        if (currentHub === null) {
          unchanged.push(client.mondayItemId)
          continue
        }

        if (currentHub === desired) {
          unchanged.push(client.mondayItemId)
          continue
        }

        const desiredLabel = hubStatusToMondayLabel(desired)
        await updateClientField(client.mondayItemId, {
          fieldKey: "campaign_status",
          label: desiredLabel,
        })

        flipped.push({
          mondayItemId: client.mondayItemId,
          name: client.name,
          before: client.campaignStatus || "—",
          after: desiredLabel,
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
    const metrics = {
      durationSec: Number(duration),
      checked: candidates.length,
      flipped: flipped.length,
      unchangedCount: unchanged.length,
      errorCount: errors.length,
    }
    if (errors.length > 0) {
      await tracker.partial(`${errors.length} flips failed`, metrics)
    } else {
      await tracker.ok(metrics)
    }
    return NextResponse.json({
      ok: true,
      duration: `${duration}s`,
      ...metrics,
      flipped,
      errors: errors.slice(0, 10),
    })
  } catch (error) {
    await tracker.fail(error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
