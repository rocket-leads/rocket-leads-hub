import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { readCache } from "@/lib/cache"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { filterClientsByUser } from "@/lib/clients/filter"
import { createAdminClient } from "@/lib/supabase/server"
import type { MondayClient } from "@/lib/integrations/monday"
import { PedroApp } from "./_components/pedro-app"

export const dynamic = "force-dynamic"
export const metadata = { title: "Pedro — Rocket Leads Hub" }

export type PedroClient = {
  id: string // monday_item_id
  name: string
  status: string // "live" | "onboarding" | etc — Monday's raw label
  boardType: "onboarding" | "current"
  /** Hub data signals so the AM picks the right variant when there are
   *  duplicates (e.g. two "Financieel Verder" rows). Pedro auto-brief
   *  pulls richer context from clients with more of these. */
  meetingCount: number
  hasKickoff: boolean
  hasEval: boolean
  hasSavedCampaign: boolean
}

export default async function PedroPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")

  // Load the client list the same way the sidebar / clients page does:
  // Monday cache first (refreshed by cron at 5:00/5:30), live API fallback.
  let clients: PedroClient[] = []
  try {
    const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
      "monday_boards",
      60 * 60 * 1000,
    )
    const data = cached ?? (await fetchBothBoards())
    const accessible = session.user.role
      ? [
          ...(await filterClientsByUser(data.onboarding, session.user.id, session.user.role)),
          ...(await filterClientsByUser(data.current, session.user.id, session.user.role)),
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

    // Enrich every client with hub-data signals so the picker can show why a
    // given variant is the right one (especially when names are duplicated).
    // One round-trip each, in parallel — meetings + saved Pedro state.
    const ids = baseClients.map((c) => c.id)
    const supabase = await createAdminClient()
    const [meetingsRes, stateRes] = await Promise.all([
      supabase
        .from("meetings")
        .select("client_id, meeting_type")
        .in("client_id", ids),
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

    clients = baseClients
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
    // Silent — Pedro still works without the picker, you can fill the brief manually.
    clients = []
  }

  return <PedroApp clients={clients} />
}
