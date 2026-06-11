import { Suspense } from "react"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { readCache } from "@/lib/cache"
import { WatchListDashboard } from "./_components/watchlist-dashboard"
import { filterClientsByUser } from "@/lib/clients/filter"
import { mondayStatusToHub } from "@/lib/clients/status"
import { auth } from "@/lib/auth"
import { Skeleton } from "@/components/ui/skeleton"
import type { MondayClient } from "@/lib/integrations/monday"

function WatchListLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-64" />
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
      </div>
    </div>
  )
}

async function WatchListData() {
  const session = await auth()

  // 1h TTL on the cache read - without it the watch list would happily serve
  // 24h-old data because the refresh-cache cron only writes `monday_boards`
  // once per day. A client moved to "On hold" in Monday at 10:00 would keep
  // showing on the watch list until the next morning's tick. Mirrors the
  // /clients page's safety net.
  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
    60 * 60 * 1000,
  )
  const data = cached ?? (await fetchBothBoards())

  let current = data.current
  if (session?.user?.id && session.user.role) {
    current = await filterClientsByUser(data.current, session.user.id, session.user.role)
  }

  // Use the Hub-canonical mapping instead of a strict `=== "Live"` literal so
  // status variants like "live", "Live " (trailing space), or a renamed Monday
  // option still collapse to the right bucket. Also explicitly excludes the
  // entire on-hold / churned family (any "Paused..." or "Stopt..." variant)
  // even if the cache momentarily has the old "Live" string - once the
  // mapping returns anything other than "live", the row is dropped.
  const active = current.filter((c) => mondayStatusToHub(c.campaignStatus, c.boardType) === "live")

  const currentUser = session?.user?.id
    ? {
        id: session.user.id,
        name: session.user.name ?? session.user.email,
        role: session.user.role ?? "member",
      }
    : null

  return (
    <WatchListDashboard
      clients={active}
      userName={session?.user?.name ?? "there"}
      currentUser={currentUser}
    />
  )
}

export default function WatchListPage() {
  return (
    <div>
      <Suspense fallback={<WatchListLoading />}>
        <WatchListData />
      </Suspense>
    </div>
  )
}
