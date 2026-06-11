"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ExternalLink,
  Mail,
  MessageSquare,
  Hash,
  Video,
  CheckSquare,
  FileText,
  Clock,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { DictionaryKey } from "@/lib/i18n/dictionary"
import type { Locale } from "@/lib/i18n/types"
import type { TimelineEntry } from "@/app/api/clients/[id]/timeline/route"

type Props = { mondayItemId: string }

type SourceFilter = "all" | "monday" | "trengo" | "slack" | "meeting" | "manual"

/** Dictionary key per source. Brand names (Monday/Trengo/Slack/Fathom)
 *  resolve to the same string in NL + EN; only "Manual", "Watch List",
 *  "Automation" actually translate. */
const SOURCE_LABEL_KEY: Record<TimelineEntry["source"], DictionaryKey> = {
  monday: "client.timeline.source.monday",
  trengo: "client.timeline.source.trengo",
  slack: "client.timeline.source.slack",
  meeting: "client.timeline.source.meeting",
  manual: "client.timeline.source.manual",
  watchlist: "client.timeline.source.watchlist",
  automation: "client.timeline.source.automation",
}

const SOURCE_BADGE_CLASS: Record<TimelineEntry["source"], string> = {
  monday: "bg-orange-500/10 text-orange-500 ring-orange-500/20",
  trengo: "bg-violet-500/10 text-violet-500 ring-violet-500/20",
  slack: "bg-indigo-500/10 text-indigo-500 ring-indigo-500/20",
  meeting: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20",
  manual: "bg-muted text-muted-foreground ring-border",
  watchlist: "bg-amber-500/10 text-amber-500 ring-amber-500/20",
  automation: "bg-blue-500/10 text-blue-500 ring-blue-500/20",
}

function iconFor(entry: TimelineEntry) {
  if (entry.kind === "meeting") return Video
  if (entry.kind === "task") return CheckSquare
  switch (entry.source) {
    case "monday":
      return FileText
    case "trengo":
      return Mail
    case "slack":
      return Hash
    default:
      return MessageSquare
  }
}

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
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all")

  const { data, isLoading, error } = useQuery<{ entries: TimelineEntry[] }>({
    queryKey: ["timeline", mondayItemId],
    queryFn: () => fetch(`/api/clients/${mondayItemId}/timeline`).then((r) => r.json()),
    staleTime: 60 * 1000,
  })

  const entries = data?.entries ?? []

  const filtered = useMemo(() => {
    if (sourceFilter === "all") return entries
    return entries.filter((e) => e.source === sourceFilter)
  }, [entries, sourceFilter])

  // Group entries by day for visual scannability.
  const grouped = useMemo(() => {
    const groups = new Map<string, TimelineEntry[]>()
    for (const e of filtered) {
      const key = formatDay(e.occurred_at, locale)
      const arr = groups.get(key) ?? []
      arr.push(e)
      groups.set(key, arr)
    }
    return Array.from(groups.entries())
  }, [filtered, locale])

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entries.length }
    for (const e of entries) counts[e.source] = (counts[e.source] ?? 0) + 1
    return counts
  }, [entries])

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

  const filterChips: { id: SourceFilter; label: string }[] = [
    { id: "all", label: t("client.timeline.filter.all", locale) },
    { id: "monday", label: t(SOURCE_LABEL_KEY.monday, locale) },
    { id: "trengo", label: t(SOURCE_LABEL_KEY.trengo, locale) },
    { id: "slack", label: t(SOURCE_LABEL_KEY.slack, locale) },
    { id: "meeting", label: t(SOURCE_LABEL_KEY.meeting, locale) },
  ]

  return (
    <div className="space-y-4">
      {/* Source filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {filterChips.map((chip) => {
          const count = sourceCounts[chip.id] ?? 0
          if (chip.id !== "all" && count === 0) return null
          const active = sourceFilter === chip.id
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setSourceFilter(chip.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ring-1 ring-inset ${
                active
                  ? "bg-primary/10 text-primary ring-primary/30"
                  : "bg-muted/50 text-muted-foreground ring-border hover:bg-muted"
              }`}
            >
              {chip.label}
              <span className={`tabular-nums ${active ? "text-primary/70" : "text-muted-foreground/70"}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Grouped timeline */}
      {grouped.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("client.timeline.empty.filtered", locale, {
              source: SOURCE_LABEL_KEY[sourceFilter as TimelineEntry["source"]]
                ? t(SOURCE_LABEL_KEY[sourceFilter as TimelineEntry["source"]], locale).toLowerCase()
                : sourceFilter,
            })}
          </CardContent>
        </Card>
      ) : (
        grouped.map(([day, dayEntries]) => (
          <div key={day} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80 px-1">
              {day}
            </p>
            <div className="space-y-1.5">
              {dayEntries.map((entry) => {
                const Icon = iconFor(entry)
                return (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-border bg-card hover:border-border hover:bg-muted/40 hover:shadow-sm transition-all px-5 py-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 mt-0.5 h-9 w-9 rounded-full bg-muted/60 flex items-center justify-center">
                        <Icon className="h-[18px] w-[18px] text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide ring-1 ring-inset ${SOURCE_BADGE_CLASS[entry.source]}`}
                          >
                            {t(SOURCE_LABEL_KEY[entry.source], locale)}
                          </span>
                          {entry.scope === "internal" && (
                            <span className="text-xs text-muted-foreground/80">{t("client.timeline.scope.internal", locale)}</span>
                          )}
                          {entry.author && (
                            <span className="text-xs text-muted-foreground truncate">{entry.author}</span>
                          )}
                          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground/80 shrink-0">
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
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
