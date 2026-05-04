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
import type { TimelineEntry } from "@/app/api/clients/[id]/timeline/route"

type Props = { mondayItemId: string }

type SourceFilter = "all" | "monday" | "trengo" | "slack" | "meeting" | "manual"

const SOURCE_LABEL: Record<TimelineEntry["source"], string> = {
  monday: "Monday",
  trengo: "Trengo",
  slack: "Slack",
  meeting: "Fathom",
  manual: "Manual",
  watchlist: "Watch List",
  automation: "Automation",
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

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  if (isSameDay(d, today)) return "Today"
  if (isSameDay(d, yesterday)) return "Yesterday"
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

export function TimelineTab({ mondayItemId }: Props) {
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
      const key = formatDay(e.occurred_at)
      const arr = groups.get(key) ?? []
      arr.push(e)
      groups.set(key, arr)
    }
    return Array.from(groups.entries())
  }, [filtered])

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
          Failed to load timeline.
        </CardContent>
      </Card>
    )
  }

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-1">
          <p className="text-sm font-medium">Nothing has happened with this client yet.</p>
          <p className="text-xs text-muted-foreground">
            Trengo messages, Monday updates, Slack mentions and Fathom meetings show up here.
          </p>
        </CardContent>
      </Card>
    )
  }

  const filterChips: { id: SourceFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "monday", label: SOURCE_LABEL.monday },
    { id: "trengo", label: SOURCE_LABEL.trengo },
    { id: "slack", label: SOURCE_LABEL.slack },
    { id: "meeting", label: SOURCE_LABEL.meeting },
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
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ring-1 ring-inset ${
                active
                  ? "bg-primary/10 text-primary ring-primary/20"
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
            No {SOURCE_LABEL[sourceFilter as TimelineEntry["source"]]?.toLowerCase() ?? sourceFilter} entries.
          </CardContent>
        </Card>
      ) : (
        grouped.map(([day, dayEntries]) => (
          <div key={day} className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70 px-1">
              {day}
            </p>
            <div className="space-y-2">
              {dayEntries.map((entry) => {
                const Icon = iconFor(entry)
                return (
                  <Card key={entry.id} className="transition-colors hover:bg-muted/30">
                    <CardContent className="flex items-start gap-3 p-3">
                      <div className="shrink-0 mt-0.5 h-7 w-7 rounded-full bg-muted/60 flex items-center justify-center">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset ${SOURCE_BADGE_CLASS[entry.source]}`}
                          >
                            {SOURCE_LABEL[entry.source]}
                          </span>
                          {entry.scope === "internal" && (
                            <span className="text-[10px] text-muted-foreground/70">internal</span>
                          )}
                          {entry.author && (
                            <span className="text-[11px] text-muted-foreground truncate">{entry.author}</span>
                          )}
                          <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-muted-foreground/70 shrink-0">
                            <Clock className="h-3 w-3" />
                            {formatDateTime(entry.occurred_at)}
                          </span>
                        </div>
                        <p className="text-sm font-medium leading-snug truncate">{entry.title}</p>
                        {entry.body && (
                          <p className="text-[12.5px] text-muted-foreground/90 leading-relaxed line-clamp-3">
                            {entry.body}
                          </p>
                        )}
                        {entry.link_url && (
                          <a
                            href={entry.link_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open
                          </a>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
