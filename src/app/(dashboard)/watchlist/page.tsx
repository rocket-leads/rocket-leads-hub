import { Suspense } from "react"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { readCache } from "@/lib/cache"
import { WatchListDashboard } from "./_components/watchlist-dashboard"
import { filterClientsByUser } from "@/lib/clients/filter"
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

  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>("monday_boards")
  const data = cached ?? await fetchBothBoards()

  let current = data.current
  if (session?.user?.id && session.user.role) {
    current = await filterClientsByUser(data.current, session.user.id, session.user.role)
  }

  // Only Live clients are relevant for the watch list
  const active = current.filter((c) => c.campaignStatus === "Live")

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
