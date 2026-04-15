import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards, fetchClientBoardItems, fetchClientBoardItemsWithUpdates } from "@/lib/integrations/monday"
import { fetchMetaInsights, fetchMetaAdDetails } from "@/lib/integrations/meta"
import { calculateKpis } from "@/lib/clients/kpis"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import { generateProposalForClient, type LeadFeedbackEntry, type AdDetailEntry } from "@/lib/proposals/generate"
import type { MondayClient } from "@/lib/integrations/monday"
import type { UtmFeedback } from "@/app/api/clients/[id]/lead-feedback/route"

// Daily eager regeneration of per-client AI proposals so the team finds
// fresh analyses ready when they start the day. Triggered by Vercel cron.
export const maxDuration = 300 // 5 minutes (Vercel Pro)

const BATCH_SIZE = 3 // concurrent Anthropic calls — keep modest to avoid rate + timeout limits

function fmt(d: Date) {
  return d.toISOString().slice(0, 10)
}

function getDateRange(days: number) {
  // Exclude today — use yesterday as end date (data won't be complete until day ends)
  const end = new Date()
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(start.getDate() - (days - 1))
  return { startDate: fmt(start), endDate: fmt(end) }
}

type SelectedCampaignsByClient = Record<string, Set<string>>

async function loadSelectedCampaigns(
  clients: MondayClient[],
): Promise<{ map: SelectedCampaignsByClient; itemToClientId: Record<string, string> }> {
  const supabase = await createAdminClient()
  const ids = clients.map((c) => c.mondayItemId)
  const { data: rows } = await supabase.from("clients").select("id, monday_item_id").in("monday_item_id", ids)

  const itemToClientId: Record<string, string> = {}
  for (const r of rows ?? []) itemToClientId[r.monday_item_id] = r.id

  const clientIds = Object.values(itemToClientId)
  const map: SelectedCampaignsByClient = {}
  if (clientIds.length === 0) return { map, itemToClientId }

  const { data: campRows } = await supabase
    .from("client_campaigns")
    .select("client_id, meta_campaign_id")
    .in("client_id", clientIds)
    .eq("is_selected", true)

  for (const r of campRows ?? []) {
    const itemId = Object.keys(itemToClientId).find((k) => itemToClientId[k] === r.client_id)
    if (!itemId) continue
    if (!map[itemId]) map[itemId] = new Set()
    map[itemId].add(r.meta_campaign_id)
  }
  return { map, itemToClientId }
}

async function buildKpiInputs(
  client: MondayClient,
  selectedCampaignIds: Set<string>,
  takenCallStatus: string,
) {
  const ranges = [getDateRange(7), getDateRange(14), getDateRange(30)]

  const isRlNoCampaign = isRocketLeadsAdAccount(client.metaAdAccountId) && selectedCampaignIds.size === 0
  const shouldFetchMeta = !!client.metaAdAccountId && !isRlNoCampaign

  // Pull lead items once at the widest range; calculateKpis filters per range.
  const [items30, insightsByRange] = await Promise.all([
    client.clientBoardId
      ? fetchClientBoardItems(client.clientBoardId).catch(() => [])
      : Promise.resolve([]),
    Promise.all(
      ranges.map((r) =>
        shouldFetchMeta
          ? fetchMetaInsights(client.metaAdAccountId, r.startDate, r.endDate).catch(() => [])
          : Promise.resolve([]),
      ),
    ),
  ])

  const kpis = ranges.map((r, idx) => {
    const filtered =
      selectedCampaignIds.size > 0
        ? insightsByRange[idx].filter((i) => selectedCampaignIds.has(i.campaignId))
        : insightsByRange[idx]
    const adSpend = filtered.reduce((sum, i) => sum + i.spend, 0)
    return calculateKpis(adSpend, items30, r.startDate, r.endDate, takenCallStatus)
  })

  return { kpis7d: kpis[0], kpis14d: kpis[1], kpis30d: kpis[2] }
}

async function buildLeadFeedback(client: MondayClient): Promise<LeadFeedbackEntry[]> {
  if (!client.clientBoardId) return []
  try {
    const items = await fetchClientBoardItemsWithUpdates(client.clientBoardId)
    const utmMap = new Map<string, UtmFeedback>()
    for (const item of items) {
      const utm = item.utm || "(no UTM)"
      if (!utmMap.has(utm)) {
        utmMap.set(utm, { utm, totalLeads: 0, leadsWithUpdates: 0, updates: [] })
      }
      const row = utmMap.get(utm)!
      row.totalLeads++
      if (item.updates.length > 0) {
        row.leadsWithUpdates++
        for (const update of item.updates) {
          if (update.text.trim()) {
            row.updates.push({
              itemName: item.itemName,
              text: update.text,
              createdAt: update.createdAt,
              leadStatus: item.leadStatus,
            })
          }
        }
      }
    }
    return Array.from(utmMap.values())
      .filter((r) => r.updates.length > 0)
      .sort((a, b) => b.totalLeads - a.totalLeads)
      .map((r) => ({
        utm: r.utm,
        totalLeads: r.totalLeads,
        updates: r.updates.map((u) => ({ text: u.text, leadStatus: u.leadStatus })),
      }))
  } catch (e) {
    console.error("[refresh-proposals] lead feedback failed:", e)
    return []
  }
}

async function buildAdDetails(
  client: MondayClient,
  selectedCampaignIds: Set<string>,
): Promise<AdDetailEntry[]> {
  if (!client.metaAdAccountId) return []
  if (isRocketLeadsAdAccount(client.metaAdAccountId) && selectedCampaignIds.size === 0) return []
  const { startDate, endDate } = getDateRange(30)
  try {
    return await fetchMetaAdDetails(client.metaAdAccountId, startDate, endDate, selectedCampaignIds)
  } catch (e) {
    console.error("[refresh-proposals] ad details failed:", e)
    return []
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startTime = Date.now()
  const supabase = await createAdminClient()

  // Pull settings (taken-call status value used in KPI calc) up front
  const { data: settingsRow } = await supabase.from("settings").select("value").eq("key", "board_config").single()
  const takenCallStatus =
    (settingsRow?.value as { client_board_columns?: { taken_call_status_value?: string } })?.client_board_columns?.taken_call_status_value ??
    "Afspraak"

  let totalClients = 0
  let processed = 0
  let succeeded = 0
  let failed = 0
  const errors: Array<{ client: string; error: string }> = []

  try {
    const { current } = await fetchBothBoards()
    // Only refresh proposals for Live clients with Meta or Monday data
    const eligible = current.filter((c) => c.campaignStatus === "Live" && (c.metaAdAccountId || c.clientBoardId))
    totalClients = eligible.length

    const { map: selectedByClient } = await loadSelectedCampaigns(eligible)

    const TIME_BUDGET_MS = 270_000 // stop at 4.5 min to leave room for final response

    for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
      // Time budget check — stop before we hit the Vercel 5 min limit
      if (Date.now() - startTime > TIME_BUDGET_MS) break

      const batch = eligible.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(async (client) => {
          const selectedCampaignIds = selectedByClient[client.mondayItemId] ?? new Set<string>()

          const [{ kpis7d, kpis14d, kpis30d }, leadFeedback, adDetails] = await Promise.all([
            buildKpiInputs(client, selectedCampaignIds, takenCallStatus),
            buildLeadFeedback(client),
            buildAdDetails(client, selectedCampaignIds),
          ])

          // Skip clients with no signal at all — no spend AND no leads.
          // Avoids burning Anthropic calls on dormant clients.
          const hasSignal = (kpis7d.adSpend ?? 0) > 0 || (kpis7d.leads ?? 0) > 0
          if (!hasSignal) {
            return { mondayItemId: client.mondayItemId, skipped: true as const }
          }

          await generateProposalForClient(
            {
              mondayItemId: client.mondayItemId,
              clientName: client.name,
              boardType: client.boardType,
              kpis7d: kpis7d as unknown as Record<string, unknown>,
              kpis14d: kpis14d as unknown as Record<string, unknown>,
              kpis30d: kpis30d as unknown as Record<string, unknown>,
              hasCrm: !!client.clientBoardId,
              leadFeedback,
              adDetails,
            },
            { force: true },
          )

          return { mondayItemId: client.mondayItemId, skipped: false as const }
        }),
      )

      for (let j = 0; j < results.length; j++) {
        const r = results[j]
        const client = batch[j]
        processed++
        if (r.status === "fulfilled") {
          if (!r.value.skipped) succeeded++
        } else {
          failed++
          errors.push({
            client: `${client.name} (${client.mondayItemId})`,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          })
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    return NextResponse.json({
      ok: true,
      duration: `${duration}s`,
      totalClients,
      processed,
      succeeded,
      skipped: processed - succeeded - failed,
      failed,
      errors: errors.slice(0, 20),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[refresh-proposals] fatal:", message)
    return NextResponse.json({ ok: false, error: message, processed, succeeded, failed }, { status: 500 })
  }
}
