import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { readCache } from "@/lib/cache"
import { safeFetch } from "@/lib/safe-fetch"

/**
 * Monday client list for Settings → Clients tab + the `mondayPeople`
 * dropdown in Settings → Users. Lifted out of `settings/page.tsx` SSR
 * so the Settings page paints instantly. Cached server-side for 1h via
 * `cache_store` (cron-warmed) — sub-second 99% of the time, only the
 * once-an-hour cache-miss path touches Monday's GraphQL.
 *
 * `mondayPeople` is the sorted distinct list of AM/CM names taken from
 * clients whose campaign_status is in the "active" set. Used as the
 * options list for the per-user Monday-person dropdown.
 */
const ACTIVE_STATUSES = new Set(["Kick off", "In development", "Live"])

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const boards = await safeFetch(
    "api:monday_boards",
    async () => {
      const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
        "monday_boards",
        60 * 60 * 1000,
      )
      return cached ?? (await fetchBothBoards())
    },
    { onboarding: [] as MondayClient[], current: [] as MondayClient[] },
  )

  const clients = [...boards.onboarding, ...boards.current]

  const names = new Set<string>()
  for (const c of clients) {
    if (!ACTIVE_STATUSES.has(c.campaignStatus)) continue
    if (c.accountManager) names.add(c.accountManager)
    if (c.campaignManager) names.add(c.campaignManager)
  }
  const mondayPeople = Array.from(names).sort()

  return NextResponse.json({ clients, mondayPeople })
}
