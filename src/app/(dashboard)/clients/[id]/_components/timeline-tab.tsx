"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ThumbsUp, Reply as ReplyIcon, Plus } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { UserAvatar } from "@/components/ui/user-avatar"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import type { TimelineEntry } from "@/app/api/clients/[id]/timeline/route"

type Props = { mondayItemId: string }

/** The reaction set shown when you click "Like" - mirrors Monday's picker. */
const REACTIONS = ["👍", "👏", "🙏", "❤️", "😀", "✅"] as const

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

  // Client timeline shows ONLY Monday updates - the canonical per-client
  // conversation. Trengo / Slack / meetings live in their own surfaces.
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
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
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
          <p className="text-xs text-muted-foreground">{t("client.timeline.empty.body", locale)}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {grouped.map(([day, dayEntries]) => (
        <div key={day} className="space-y-2">
          <p className="px-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            {day}
          </p>
          <div className="space-y-2">
            {dayEntries.map((entry) => (
              <TimelineEntryCard key={entry.id} entry={entry} locale={locale} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * A single Monday-style update card: author photo + name + timestamp, a bold
 * title, the description (collapsed with a "See more" toggle like Monday), and
 * a Like / Reply bar. "Like" opens the emoji reaction picker. Roy 2026-07-27.
 */
function TimelineEntryCard({ entry, locale }: { entry: TimelineEntry; locale: Locale }) {
  const [expanded, setExpanded] = useState(false)
  const [reaction, setReaction] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [repliesOpen, setRepliesOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const replies = entry.replies ?? []

  useEffect(() => {
    if (!pickerOpen) return
    function onDoc(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [pickerOpen])

  const body = entry.body?.trim() ?? ""
  const needsMore = body.length > 240 || (body.match(/\n/g)?.length ?? 0) >= 3

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm transition-colors hover:border-foreground/15">
      {/* Author row - real Hub photo (matched to the Monday creator), name, time. */}
      <div className="flex items-center gap-3">
        <UserAvatar name={entry.author} avatarUrl={entry.author_avatar} autoColor className="size-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{entry.author ?? "Onbekend"}</p>
          <p className="font-mono text-[11px] tabular-nums text-muted-foreground/60">
            {formatDateTime(entry.occurred_at, locale)}
          </p>
        </div>
      </div>

      {/* Title + description (See more) */}
      <div className="mt-3 space-y-1.5">
        {entry.title && (
          <p className="text-[15px] font-semibold leading-snug text-foreground">{entry.title}</p>
        )}
        {body && (
          <div>
            <p
              className={cn(
                "whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground/90",
                !expanded && needsMore && "line-clamp-3",
              )}
            >
              {body}
            </p>
            {needsMore && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 text-xs font-semibold text-foreground/70 transition-colors hover:text-foreground"
              >
                {expanded ? "See less" : "… See more"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Reaction chip (once picked) */}
      {reaction && (
        <div className="mt-2.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/[0.07] px-2 py-0.5 text-xs">
            <span>{reaction}</span>
            <span className="font-mono tabular-nums text-muted-foreground/70">1</span>
          </span>
        </div>
      )}

      {/* Like / Reply bar */}
      <div className="relative mt-3 flex items-center gap-1 border-t border-border/50 pt-2">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ThumbsUp className="h-4 w-4" />
          Like
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ReplyIcon className="h-4 w-4" />
          Reply
        </button>

        {/* Emoji reaction picker - opens on Like, mirrors Monday's row. */}
        {pickerOpen && (
          <div
            ref={pickerRef}
            className="absolute bottom-full left-0 z-20 mb-1 flex items-center gap-1 rounded-full border border-border bg-popover px-2 py-1.5 shadow-lg"
          >
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  setReaction(emoji)
                  setPickerOpen(false)
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition-transform hover:scale-125"
              >
                {emoji}
              </button>
            ))}
            <span className="mx-0.5 h-5 w-px bg-border" />
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Threaded replies (Monday nests these under the main update). Collapsed
          behind a "N replies" toggle, like Monday's "Previous N replies". */}
      {replies.length > 0 && (
        <div className="mt-2 border-t border-border/50 pt-2">
          <button
            type="button"
            onClick={() => setRepliesOpen((v) => !v)}
            className="text-xs font-semibold text-foreground/70 transition-colors hover:text-foreground"
          >
            {repliesOpen
              ? "Hide replies"
              : `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
          </button>
          {repliesOpen && (
            <div className="mt-2 space-y-3 border-l-2 border-border/60 pl-3">
              {replies.map((r, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <UserAvatar name={r.author} avatarUrl={r.author_avatar} autoColor className="size-7 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[13px] font-semibold text-foreground">
                        {r.author ?? "Onbekend"}
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">
                        {formatDateTime(r.occurred_at, locale)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground/90">
                      {r.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
