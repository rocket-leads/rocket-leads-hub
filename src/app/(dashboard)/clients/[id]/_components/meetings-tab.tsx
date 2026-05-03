"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { MeetingCard } from "@/app/(dashboard)/meetings/_components/meeting-card"
import type { MeetingRow } from "@/lib/meetings/types"

type Props = { mondayItemId: string }

export function MeetingsTab({ mondayItemId }: Props) {
  const { data, isLoading, error } = useQuery<{ meetings: MeetingRow[] }>({
    queryKey: ["meetings", mondayItemId],
    queryFn: () => fetch(`/api/clients/${mondayItemId}/meetings`).then((r) => r.json()),
    staleTime: 60 * 1000,
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-destructive">
          Failed to load meetings.
        </CardContent>
      </Card>
    )
  }

  const meetings = data?.meetings ?? []

  if (meetings.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-1">
          <p className="text-sm font-medium">No meetings linked to this client yet.</p>
          <p className="text-xs text-muted-foreground">
            Fathom recordings auto-link via attendee email. Until the matcher ships
            (C.5.b), check the global <span className="font-medium">Meetings</span> page
            to link manually.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {meetings.map((m) => (
        <MeetingCard key={m.id} meeting={m} showClientLink={false} />
      ))}
    </div>
  )
}
