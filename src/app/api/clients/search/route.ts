import { auth } from "@/lib/auth"
import { readCache } from "@/lib/cache"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { loadUserMappingsContext, filterClientsByContext } from "@/lib/clients/filter"
import { mondayStatusToHub, type ClientStatus } from "@/lib/clients/status"
import type { MondayClient } from "@/lib/integrations/monday"
import { NextResponse } from "next/server"

export type ClientSearchResult = {
  mondayItemId: string
  name: string
  boardType: "onboarding" | "current"
  /** Hub-canonical status (null when unmapped on the current board). Lets the
   *  search dropdown render a status hint next to each row without an extra
   *  per-result API call. */
  status: ClientStatus | null
}

/**
 * Backs the global ⌘K client search. Reads the cron-warmed `monday_boards`
 * cache so it inherits the AM/CM/setter columns needed for access filtering
 * (the Supabase `clients` table doesn't carry those). Falls through to a live
 * Monday fetch when the cache is missing, same safety net as the /clients
 * page itself.
 *
 * Filtered against the user's column mappings so a member with restricted
 * scope only sees their own clients — admins, finance, and members with no
 * mappings see everything.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id || !session.user.role) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
    60 * 60 * 1000,
  )
  const data = cached ?? (await fetchBothBoards())

  const mappingsContext = await loadUserMappingsContext(session.user.id, session.user.role)
  const onboarding = filterClientsByContext(data.onboarding, mappingsContext)
  const current = filterClientsByContext(data.current, mappingsContext)

  const results: ClientSearchResult[] = [
    ...onboarding.map<ClientSearchResult>((c) => ({
      mondayItemId: c.mondayItemId,
      name: c.name,
      boardType: "onboarding",
      status: "onboarding",
    })),
    ...current.map<ClientSearchResult>((c) => ({
      mondayItemId: c.mondayItemId,
      name: c.name,
      boardType: "current",
      status: mondayStatusToHub(c.campaignStatus, "current"),
    })),
  ].sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json(results, {
    headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
  })
}
