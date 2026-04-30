import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { filterClientsByUser } from "@/lib/clients/filter"
import { listInboxItems } from "@/lib/inbox/fetchers"
import { Skeleton } from "@/components/ui/skeleton"
import { InboxView } from "./_components/inbox-view"

function InboxLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-64" />
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
      </div>
    </div>
  )
}

async function InboxData() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")

  const userId = session.user.id
  const role = session.user.role

  // Initial item lists default to "Assigned to me" — same as the UI default.
  const [updates, tasks, usersRes, mondayBoards] = await Promise.all([
    listInboxItems(userId, role, { kind: "update", assignedToMe: true }),
    listInboxItems(userId, role, { kind: "task", assignedToMe: true }),
    createAdminClient().then((s) =>
      s
        .from("users")
        .select("id, name, email, role")
        .order("name", { ascending: true, nullsFirst: false }),
    ),
    readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>("monday_boards").then(
      (cached) =>
        cached ?? fetchBothBoards().catch(() => ({ onboarding: [], current: [] })),
    ),
  ])

  const allClients = [...mondayBoards.onboarding, ...mondayBoards.current]
  const visibleClients = await filterClientsByUser(allClients, userId, role)

  const users = (usersRes.data ?? []) as Array<{
    id: string
    name: string | null
    email: string
    role: string
  }>

  return (
    <InboxView
      currentUser={{
        id: userId,
        name: session.user.name ?? session.user.email,
        role,
      }}
      initialUpdates={updates}
      initialTasks={tasks}
      users={users}
      clients={visibleClients.map((c) => ({ id: c.mondayItemId, name: c.name }))}
    />
  )
}

export default function InboxPage() {
  return (
    <div>
      <Suspense fallback={<InboxLoading />}>
        <InboxData />
      </Suspense>
    </div>
  )
}
