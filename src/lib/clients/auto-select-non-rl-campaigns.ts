import { fetchMetaCampaigns } from "@/lib/integrations/meta"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import { hasRlPrefix } from "@/lib/clients/campaign-matcher"

type Supabase = Awaited<ReturnType<typeof import("@/lib/supabase/server").createAdminClient>>

export type NonRlAutoSelectInput = {
  /** Supabase clients.id */
  clientId: string
  /** Monday item id — returned in `affectedMondayItemIds` so callers can invalidate caches */
  mondayItemId: string
  /** Meta ad account ID, with or without the `act_` prefix */
  metaAdAccountId: string
}

export type NonRlAutoSelectResult = {
  assignedCount: number
  affectedMondayItemIds: string[]
}

/**
 * Auto-assign new ACTIVE Meta campaigns to non-RL clients, mirroring the live behaviour of
 * `/api/clients/[id]/campaigns` GET. Without this, the cron and the watchlist's live-fetch
 * keep filtering by stale `client_campaigns` selections — a client whose only selected row
 * points at an old paused campaign will appear with €0 / 0 leads even though Meta has fresh
 * spend on a new ACTIVE campaign that nobody picked up yet (because nobody opened the client
 * page since it launched).
 *
 * Skips RL accounts entirely — those are handled by `runRocketLeadsCampaignMatcher`, which
 * uses name-confidence matching since one ad account is shared across many clients.
 *
 * Idempotent: only campaigns with no row at all (neither selected nor deselected) are added.
 * User deselections persist through ACTIVE → PAUSED → ACTIVE cycles.
 *
 * Batches Meta calls per unique ad account, so two clients sharing the same account share
 * one fetch.
 */
export async function autoSelectActiveCampaignsForNonRlClients(
  supabase: Supabase,
  clients: NonRlAutoSelectInput[],
  options: { skipMetaFetch?: boolean } = {},
): Promise<NonRlAutoSelectResult> {
  if (options.skipMetaFetch) return { assignedCount: 0, affectedMondayItemIds: [] }
  const nonRl = clients.filter((c) => c.metaAdAccountId && !isRocketLeadsAdAccount(c.metaAdAccountId))
  if (nonRl.length === 0) return { assignedCount: 0, affectedMondayItemIds: [] }

  // Group by stripped ad account ID so two clients on the same account share one Meta call.
  const byAccount = new Map<string, NonRlAutoSelectInput[]>()
  for (const c of nonRl) {
    const clean = c.metaAdAccountId.replace(/^act_/, "")
    if (!byAccount.has(clean)) byAccount.set(clean, [])
    byAccount.get(clean)!.push(c)
  }

  const allClientIds = nonRl.map((c) => c.clientId)
  // Paginated — Supabase's default 1000-row cap was silently
  // truncating the existingRows on accounts with thousands of
  // client_campaigns rows, causing the matcher to re-assign
  // campaigns the user had already deselected. Roy 2026-05-22.
  const knownByClient = new Map<string, Set<string>>()
  {
    const PAGE = 1000
    const MAX = 100_000
    let offset = 0
    while (offset < MAX) {
      const { data: existingRows, error } = await supabase
        .from("client_campaigns")
        .select("client_id, meta_campaign_id")
        .in("client_id", allClientIds)
        .range(offset, offset + PAGE - 1)
      if (error) {
        console.error("[auto-select-non-rl] existing fetch failed:", error.message)
        break
      }
      for (const row of existingRows ?? []) {
        if (!knownByClient.has(row.client_id)) knownByClient.set(row.client_id, new Set())
        knownByClient.get(row.client_id)!.add(row.meta_campaign_id)
      }
      if (!existingRows || existingRows.length < PAGE) break
      offset += PAGE
    }
  }

  const newRows: Array<{
    client_id: string
    meta_campaign_id: string
    campaign_name: string
    is_selected: boolean
  }> = []
  const affected = new Set<string>()

  for (const [accountId, clientsOnAccount] of byAccount) {
    let campaigns: Awaited<ReturnType<typeof fetchMetaCampaigns>>
    try {
      campaigns = await fetchMetaCampaigns(accountId)
    } catch (e) {
      console.error(
        `[auto-select-non-rl] fetchMetaCampaigns failed for ${accountId}:`,
        e instanceof Error ? e.message : e,
      )
      continue
    }

    for (const c of clientsOnAccount) {
      const known = knownByClient.get(c.clientId) ?? new Set<string>()
      for (const camp of campaigns) {
        if (camp.status !== "ACTIVE") continue
        if (known.has(camp.id)) continue
        // RL-only filter: don't auto-track campaigns the client built themselves.
        // We only ever auto-track our own ads (the "RL | ..." convention).
        if (!hasRlPrefix(camp.name)) continue
        newRows.push({
          client_id: c.clientId,
          meta_campaign_id: camp.id,
          campaign_name: camp.name,
          is_selected: true,
        })
        known.add(camp.id)
        affected.add(c.mondayItemId)
      }
    }
  }

  if (newRows.length === 0) return { assignedCount: 0, affectedMondayItemIds: [] }

  const { error } = await supabase
    .from("client_campaigns")
    .upsert(newRows, { onConflict: "client_id,meta_campaign_id" })
  if (error) {
    console.error("[auto-select-non-rl] upsert failed:", error.message)
    return { assignedCount: 0, affectedMondayItemIds: [] }
  }
  return { assignedCount: newRows.length, affectedMondayItemIds: Array.from(affected) }
}
