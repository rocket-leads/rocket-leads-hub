"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import Image from "next/image"
import { ExternalLink, Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import type { TimelineEntry } from "@/app/api/clients/[id]/timeline/route"

type Props = { mondayItemId: string }

function formatDateTime(iso: string, locale: Locale): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "-"
  return d.toLocaleString(locale === "nl" ? "nl-NL" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDay(iso: string, locale: Locale): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "-"
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  if (isSameDay(d, today)) return t("client.timeline.day.today", locale)
  if (isSameDay(d, yesterday)) return t("client.timeline.day.yesterday", locale)
  return d.toLocaleDateString(locale === "nl" ? "nl-NL" : "en-GB", { day: "numeric", month: "short", year: "numeric" })
}

export function TimelineTab({ mondayItemId }: Props) {
  const locale = useLocale()

  const { data, isLoading, error } = useQuery<{ entries: TimelineEntry[] }>({
    queryKey: ["timeline", mondayItemId],
    queryFn: () => fetch(`/api/clients/${mondayItemId}/timeline`).then((r) => r.json()),
    staleTime: 60 * 1000,
  })

  // Roy 2026-06-11 round 2: client timeline shows ONLY Monday updates.
  // Trengo conversations / Slack messages / meetings clutter the view -
  // those live in their own surfaces (Klanten Inbox / Meetings tab).
  const entries = useMemo(
    () => (data?.entries ?? []).filter((e) => e.source === "monday"),
    [data?.entries],
  )

  const grouped = useMemo(() => {
    const groups = new Map<string, TimelineEntry[]>()
    for (const e of entries) {
      const key = formatDay(e.occurred_at, locale)
      const arr = groups.get(key) ?? []
      arr.push(e)
      groups.set(key, arr)
    }
    return Array.from(groups.entries())
  }, [entries, locale])

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-destructive">
          {t("client.timeline.error", locale)}
        </CardContent>
      </Card>
    )
  }

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-1">
          <p className="text-sm font-medium">{t("client.timeline.empty.title", locale)}</p>
          <p className="text-xs text-muted-foreground">
            {t("client.timeline.empty.body", locale)}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Grouped timeline */}
      {grouped.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("client.timeline.empty.body", locale)}
          </CardContent>
        </Card>
      ) : (
        grouped.map(([day, dayEntries]) => (
          <div key={day} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80 px-1">
              {day}
            </p>
            <div className="space-y-1.5">
              {dayEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-border bg-card hover:border-border hover:bg-muted/40 hover:shadow-sm transition-all px-5 py-4"
                >
                  <div className="flex items-start gap-3">
                    {/* Monday brand mark - was a generic form icon. Roy
                        2026-06-11: "ik wil het Monday logo". */}
                    <div className="shrink-0 mt-0.5 h-9 w-9 rounded-md bg-muted/60 flex items-center justify-center">
                      <Image
                        src="/logos/brands/monday.svg"
                        alt=""
                        width={20}
                        height={20}
                        className="h-5 w-5 object-contain"
                        unoptimized
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {/* Time stamp only - source badge / scope / author
                          row removed 2026-06-11 (Roy: "die regel mag
                          helemaal weg, gewoon lekker simpel houden"). */}
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/80">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(entry.occurred_at, locale)}
                        </span>
                      </div>
                      <p className="text-[15px] font-medium leading-snug truncate">{entry.title}</p>
                      {entry.body && (
                        <p className="text-sm text-muted-foreground/90 leading-relaxed line-clamp-3">
                          {entry.body}
                        </p>
                      )}
                      {entry.link_url && (
                        <a
                          href={entry.link_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t("client.timeline.open_link", locale)}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
