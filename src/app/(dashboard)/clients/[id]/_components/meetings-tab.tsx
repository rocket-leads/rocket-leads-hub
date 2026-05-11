"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { MeetingCard } from "@/app/(dashboard)/meetings/_components/meeting-card"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { MeetingRow } from "@/lib/meetings/types"

type Props = { mondayItemId: string }

export function MeetingsTab({ mondayItemId }: Props) {
  const locale = useLocale()
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
          {t("client.meetings.error", locale)}
        </CardContent>
      </Card>
    )
  }

  const meetings = data?.meetings ?? []

  if (meetings.length === 0) {
    // Render the helper text with the word "Meetings" emphasised inline so it
    // visually keys the global page reference without us needing a richer
    // tagging system in the dictionary.
    const helperText = t("client.meetings.empty.body", locale, { meetings: "__MEETINGS__" })
    const [before, after] = helperText.split("__MEETINGS__")
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-1">
          <p className="text-sm font-medium">{t("client.meetings.empty.title", locale)}</p>
          <p className="text-xs text-muted-foreground">
            {before}
            <span className="font-medium">{t("client.meetings.empty.body.meetings_word", locale)}</span>
            {after}
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
