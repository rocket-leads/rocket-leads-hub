"use client"

import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { InboxShell } from "@/app/(dashboard)/inbox/_components/shell/inbox-shell"
import type { CurrentUser, InboxUser } from "@/app/(dashboard)/inbox/_components/shell/types"

type Props = {
  mondayItemId: string
  clientName: string
  currentUser: CurrentUser
  trengoContactId: string | null
  canViewCommunication: boolean
}

export function InboxTab({
  mondayItemId,
  clientName,
  currentUser,
  trengoContactId,
  canViewCommunication,
}: Props) {
  const usersQuery = useQuery<{ users: InboxUser[] }>({
    queryKey: ["inbox-users"],
    queryFn: () => fetch("/api/inbox/users").then((r) => r.json()),
    staleTime: 10 * 60 * 1000,
  })

  if (usersQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-48" />
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
      </div>
    )
  }

  return (
    <InboxShell
      currentUser={currentUser}
      initialUpdates={[]}
      initialTasks={[]}
      users={usersQuery.data?.users ?? []}
      clients={[{ id: mondayItemId, name: clientName }]}
      lockedClient={{
        id: mondayItemId,
        name: clientName,
        trengoContactId,
        canViewCommunication,
      }}
    />
  )
}
