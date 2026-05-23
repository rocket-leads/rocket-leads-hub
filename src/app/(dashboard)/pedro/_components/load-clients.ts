import { readCache } from "@/lib/cache"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { filterClientsByUser } from "@/lib/clients/filter"
import { createAdminClient } from "@/lib/supabase/server"
import type { MondayClient } from "@/lib/integrations/monday"
import type { PedroClient } from "./types"

/**
 * Shared loader used by every Pedro sub-route (onboard, optimize,
 * insights uses its own data shape, meetings too). Same path as the
 * sidebar / clients page: Monday cache first (refreshed by cron at
 * 5:00/5:30), live API fallback. Silent on failure so the page still
 * renders with an empty picker.
 */
export async function loadPedroClients(opts: {
  userId: string
  role: string | null | undefined
}): Promise<PedroClient[]> {
  try {
    const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
      "monday_boards",
      60 * 60 * 1000,
    )
    const data = cached ?? (await fetchBothBoards())
    const accessible = opts.role
      ? [
          ...(await filterClientsByUser(data.onboarding, opts.userId, opts.role)),
          ...(await filterClientsByUser(data.current, opts.userId, opts.role)),
        ]
      : [...data.onboarding, ...data.current]

    const baseClients = accessible
      .map((c) => ({
        id: c.mondayItemId,
        name: c.companyName || c.name,
        status: c.campaignStatus || "",
        boardType: c.boardType,
      }))
      .filter((c) => c.id && c.name)

    // Enrich every client with hub-data signals so the picker can show why
    // a given variant is the right one (especially when names are
    // duplicated). One round-trip each, in parallel — meetings + saved
    // Pedro state.
    const ids = baseClients.map((c) => c.id)
    const supabase = await createAdminClient()
    const [meetingsRes, stateRes] = await Promise.all([
      supabase
        .from("meetings")
        .select("client_id, meeting_type")
        .in("client_id", ids)
        // Pedro picker only cares about kick-offs / evals signalling client
        // engagement. Sales calls (historical, matched post-deal) would
        // inflate the meetings count without indicating client engagement.
        .neq("meeting_type", "sales"),
      supabase
        .from("pedro_client_state")
        .select("client_id")
        .in("client_id", ids),
    ])

    const meetingsByClient = new Map<string, { count: number; ko: boolean; ev: boolean }>()
    for (const m of meetingsRes.data ?? []) {
      const slot = meetingsByClient.get(m.client_id) ?? { count: 0, ko: false, ev: false }
      slot.count += 1
      if (m.meeting_type === "kick_off") slot.ko = true
      if (m.meeting_type === "evaluation") slot.ev = true
      meetingsByClient.set(m.client_id, slot)
    }
    const savedSet = new Set((stateRes.data ?? []).map((r) => r.client_id))

    return baseClients
      .map((c) => {
        const sig = meetingsByClient.get(c.id)
        return {
          ...c,
          meetingCount: sig?.count ?? 0,
          hasKickoff: sig?.ko ?? false,
          hasEval: sig?.ev ?? false,
          hasSavedCampaign: savedSet.has(c.id),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}
