"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  addDays,
  addWeeks,
  endOfWeek,
  format,
  isToday,
  startOfDay,
  startOfWeek,
} from "date-fns"
import { ChevronLeft, ChevronRight, MapPin, Plus, Video } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { CalendarEventsResponse } from "@/app/api/calendar/events/route"
import { EventDialog, type EventDialogMode } from "./event-dialog"
import { TaskDialog } from "./task-dialog"

/**
 * Week-view calendar showing the user's Google Calendar events + Hub
 * tasks side-by-side. Brand purple = events (primary integration),
 * amber = tasks (Hub-native to-dos). The split is purely visual — both
 * streams are queried in one /api/calendar/events round-trip.
 *
 * Day grid is 6:00–22:00 (HOUR_START–HOUR_END). Events outside that
 * range get clipped to the visible window with their original time
 * still surfaced in the title tooltip. Tasks have no time, so they
 * render in the all-day row at the top of their due_date column.
 */

const HOUR_START = 6
const HOUR_END = 22
const HOUR_HEIGHT_PX = 56
const TOTAL_HOURS = HOUR_END - HOUR_START
const TIME_COL_WIDTH = "w-14"

type Props = {
  initialConnected: boolean
}

export function CalendarView({ initialConnected }: Props) {
  // Anchor is "any day in the week we're viewing". The week range is
  // derived (Mon-Sun) so users always see a full work-week regardless
  // of which day they click into.
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  const [dialog, setDialog] = useState<EventDialogMode | null>(null)
  const [taskDialogId, setTaskDialogId] = useState<string | null>(null)

  const weekStart = useMemo(
    () => startOfWeek(anchor, { weekStartsOn: 1 }),
    [anchor],
  )
  const weekEnd = useMemo(
    () => endOfWeek(anchor, { weekStartsOn: 1 }),
    [anchor],
  )
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )

  const timeMinIso = weekStart.toISOString()
  const timeMaxIso = endOfWeek(anchor, { weekStartsOn: 1 }).toISOString()

  const query = useQuery<CalendarEventsResponse>({
    queryKey: ["calendar-events", timeMinIso, timeMaxIso],
    queryFn: async () => {
      const url = new URL("/api/calendar/events", window.location.origin)
      url.searchParams.set("timeMin", timeMinIso)
      url.searchParams.set("timeMax", timeMaxIso)
      const res = await fetch(url, { credentials: "include" })
      if (!res.ok) throw new Error("Failed to load calendar")
      return (await res.json()) as CalendarEventsResponse
    },
  })

  const data = query.data
  const connected = data?.connected ?? initialConnected

  // Split events into all-day vs timed for layout.
  const { allDayByDay, timedByDay, tasksByDay } = useMemo(() => {
    const allDay: Record<string, CalendarEventsResponse["events"]> = {}
    const timed: Record<string, CalendarEventsResponse["events"]> = {}
    const tasks: Record<string, CalendarEventsResponse["tasks"]> = {}
    for (const d of days) {
      const key = format(d, "yyyy-MM-dd")
      allDay[key] = []
      timed[key] = []
      tasks[key] = []
    }
    for (const ev of data?.events ?? []) {
      // All-day events come back as YYYY-MM-DD; render them on that date.
      // Timed events come back as ISO datetimes.
      if (ev.allDay) {
        const key = ev.start.slice(0, 10)
        if (allDay[key]) allDay[key].push(ev)
      } else {
        const start = new Date(ev.start)
        const key = format(start, "yyyy-MM-dd")
        if (timed[key]) timed[key].push(ev)
      }
    }
    for (const tk of data?.tasks ?? []) {
      if (tasks[tk.due_date]) tasks[tk.due_date].push(tk)
    }
    return { allDayByDay: allDay, timedByDay: timed, tasksByDay: tasks }
  }, [data, days])

  return (
    <div className="space-y-4">
      {/* Toolbar — week navigator + today button + range label */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAnchor(new Date())}
          >
            Today
          </Button>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous week"
              onClick={() => setAnchor((d) => addWeeks(d, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next week"
              onClick={() => setAnchor((d) => addWeeks(d, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="text-sm font-medium text-foreground">
            {format(weekStart, "d MMM")} – {format(weekEnd, "d MMM yyyy")}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm bg-[#8967F3]" />
              Meetings
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm bg-amber-500" />
              Tasks
            </span>
          </div>
          <Button
            size="sm"
            onClick={() => setDialog({ kind: "create" })}
            disabled={!connected}
            title={!connected ? "Connect Google Calendar to create events" : undefined}
          >
            <Plus className="size-4" />
            New event
          </Button>
        </div>
      </div>

      {!connected && <ConnectPrompt />}

      {data?.error && <CalendarErrorBanner error={data.error} />}

      {/* Grid container */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-border bg-muted/30">
          <div className={cn(TIME_COL_WIDTH, "border-r border-border")} />
          {days.map((d) => (
            <div
              key={d.toISOString()}
              className={cn(
                "py-2 px-2 text-center border-r border-border last:border-r-0",
                isToday(d) && "bg-primary/5",
              )}
            >
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {format(d, "EEE")}
              </div>
              <div
                className={cn(
                  "text-sm font-medium tabular-nums",
                  isToday(d) ? "text-primary" : "text-foreground",
                )}
              >
                {format(d, "d MMM")}
              </div>
            </div>
          ))}
        </div>

        {/* All-day / tasks row */}
        <AllDayRow
          days={days}
          allDayByDay={allDayByDay}
          tasksByDay={tasksByDay}
          onOpenEvent={(id) => setDialog({ kind: "view", eventId: id })}
          onOpenTask={(id) => setTaskDialogId(id)}
        />

        {/* Hour grid */}
        <div className="relative grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
          {/* Time column */}
          <div className={cn(TIME_COL_WIDTH, "border-r border-border")}>
            {Array.from({ length: TOTAL_HOURS }, (_, i) => (
              <div
                key={i}
                className="h-14 px-2 pt-1 text-[10px] text-muted-foreground border-b border-border/60"
              >
                {String(HOUR_START + i).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d) => {
            const key = format(d, "yyyy-MM-dd")
            return (
              <DayColumn
                key={key}
                day={d}
                events={timedByDay[key] ?? []}
                onOpenEvent={(id) => setDialog({ kind: "view", eventId: id })}
                onCreateAt={(when) =>
                  setDialog({ kind: "create", initialStart: when })
                }
              />
            )
          })}
        </div>
      </div>

      {query.isError && (
        <p className="text-sm text-destructive">
          Couldn&apos;t load calendar. Try refreshing.
        </p>
      )}

      {dialog && (
        <EventDialog
          open={true}
          onOpenChange={(o) => !o && setDialog(null)}
          mode={dialog}
        />
      )}

      {taskDialogId && (
        <TaskDialog
          taskId={taskDialogId}
          open={true}
          onOpenChange={(o) => !o && setTaskDialogId(null)}
        />
      )}
    </div>
  )
}

function CalendarErrorBanner({
  error,
}: {
  error: NonNullable<CalendarEventsResponse["error"]>
}) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
      <p className="font-medium text-foreground">
        Google Calendar fout
        {error.status > 0 ? ` (HTTP ${error.status})` : ""}
      </p>
      <p className="mt-1 text-muted-foreground break-words">{error.message}</p>
      {error.hint && (
        <p className="mt-2 text-foreground">→ {error.hint}</p>
      )}
    </div>
  )
}

function ConnectPrompt() {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <p className="font-medium text-foreground">
        Google Calendar is not connected
      </p>
      <p className="mt-1 text-muted-foreground">
        Sign out and sign back in to grant calendar access. Hub tasks below
        will still show.{" "}
        <Link href="/auth/signin" className="underline underline-offset-2">
          Re-sign-in
        </Link>
      </p>
    </div>
  )
}

function AllDayRow({
  days,
  allDayByDay,
  tasksByDay,
  onOpenEvent,
  onOpenTask,
}: {
  days: Date[]
  allDayByDay: Record<string, CalendarEventsResponse["events"]>
  tasksByDay: Record<string, CalendarEventsResponse["tasks"]>
  onOpenEvent: (id: string) => void
  onOpenTask: (id: string) => void
}) {
  // Reserve some minimum height even when empty so the row doesn't collapse
  // into an invisible 0px strip on slow weeks.
  return (
    <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-border bg-muted/10">
      <div
        className={cn(
          TIME_COL_WIDTH,
          "border-r border-border py-2 px-2 text-[10px] text-muted-foreground",
        )}
      >
        all-day
      </div>
      {days.map((d) => {
        const key = format(d, "yyyy-MM-dd")
        const allDayEvents = allDayByDay[key] ?? []
        const tasks = tasksByDay[key] ?? []
        return (
          <div
            key={key}
            className={cn(
              "border-r border-border last:border-r-0 p-1.5 space-y-1 min-h-[44px]",
              isToday(d) && "bg-primary/5",
            )}
          >
            {allDayEvents.map((ev) => (
              <EventChip
                key={ev.id}
                title={ev.title}
                onClick={() => onOpenEvent(ev.id)}
              />
            ))}
            {tasks.map((t) => (
              <TaskChip
                key={t.id}
                title={t.title}
                clientName={t.clientName}
                onClick={() => onOpenTask(t.id)}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

type LaidOutEvent = {
  event: CalendarEventsResponse["events"][number]
  top: number
  height: number
  leftPct: number
  widthPct: number
}

/**
 * Layout overlapping events as columns within their cluster. Standard
 * calendar algorithm:
 *
 *   1. Compute each event's pixel top/bottom in the visible window.
 *   2. Sort by start time, longer events first when starts tie.
 *   3. Sweep top→bottom collecting "clusters" — connected groups where
 *      each event overlaps with at least one other in the cluster.
 *   4. Within each cluster, greedily place events into columns: take
 *      the first column whose last event ends before this one starts.
 *   5. Each event gets `width = 1 / clusterCols`, `left = col * width`.
 *
 * The result is the same packing Google Calendar uses, so two events
 * at the same time become side-by-side half-width blocks instead of
 * stacking on top of each other.
 */
function layoutDayEvents(
  events: CalendarEventsResponse["events"],
  dayStart: Date,
): LaidOutEvent[] {
  const positioned = events.map((event) => {
    const start = new Date(event.start)
    const end = new Date(event.end)
    const startHour = (start.getTime() - dayStart.getTime()) / 3_600_000
    const endHour = (end.getTime() - dayStart.getTime()) / 3_600_000
    const top = Math.max(0, startHour - HOUR_START) * HOUR_HEIGHT_PX
    const bottom =
      Math.min(TOTAL_HOURS, endHour - HOUR_START) * HOUR_HEIGHT_PX
    const height = Math.max(20, bottom - top)
    return { event, top, height, endPx: top + height }
  })

  // Sort by top asc, then longer events first when starts tie.
  const indices = positioned.map((_, i) => i)
  indices.sort((a, b) => {
    if (positioned[a].top !== positioned[b].top) {
      return positioned[a].top - positioned[b].top
    }
    return positioned[b].endPx - positioned[a].endPx
  })

  // Sweep into clusters of transitively-overlapping events.
  const clusters: number[][] = []
  let currentCluster: number[] = []
  let clusterMaxEnd = -Infinity
  for (const idx of indices) {
    const p = positioned[idx]
    if (p.top >= clusterMaxEnd && currentCluster.length > 0) {
      clusters.push(currentCluster)
      currentCluster = []
      clusterMaxEnd = -Infinity
    }
    currentCluster.push(idx)
    clusterMaxEnd = Math.max(clusterMaxEnd, p.endPx)
  }
  if (currentCluster.length > 0) clusters.push(currentCluster)

  // Assign columns within each cluster.
  const result: LaidOutEvent[] = []
  for (const cluster of clusters) {
    const colEnds: number[] = []
    const colByIdx = new Map<number, number>()
    for (const idx of cluster) {
      const p = positioned[idx]
      let col = colEnds.findIndex((endPx) => endPx <= p.top)
      if (col === -1) {
        col = colEnds.length
        colEnds.push(p.endPx)
      } else {
        colEnds[col] = p.endPx
      }
      colByIdx.set(idx, col)
    }
    const totalCols = colEnds.length
    for (const idx of cluster) {
      const p = positioned[idx]
      const col = colByIdx.get(idx) ?? 0
      result.push({
        event: p.event,
        top: p.top,
        height: p.height,
        leftPct: (col / totalCols) * 100,
        widthPct: 100 / totalCols,
      })
    }
  }
  return result
}

function DayColumn({
  day,
  events,
  onOpenEvent,
  onCreateAt,
}: {
  day: Date
  events: CalendarEventsResponse["events"]
  onOpenEvent: (id: string) => void
  onCreateAt: (when: Date) => void
}) {
  const dayStart = startOfDay(day)
  const laidOut = useMemo(
    () => layoutDayEvents(events, dayStart),
    [events, dayStart],
  )

  // Click on an empty slot in the column → open the create dialog
  // pre-seeded to the slot the user clicked. The event blocks have
  // their own click handlers and stop propagation.
  const onColumnClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const hourFloat = HOUR_START + y / HOUR_HEIGHT_PX
    const hour = Math.floor(hourFloat)
    const minute = Math.round(((hourFloat - hour) * 60) / 15) * 15
    const when = new Date(day)
    when.setHours(hour, Math.min(minute, 45), 0, 0)
    onCreateAt(when)
  }

  return (
    <div
      className={cn(
        "relative border-r border-border last:border-r-0 cursor-pointer",
        isToday(day) && "bg-primary/5",
      )}
      style={{ height: TOTAL_HOURS * HOUR_HEIGHT_PX }}
      onClick={onColumnClick}
    >
      {/* Hour grid lines */}
      {Array.from({ length: TOTAL_HOURS }, (_, i) => (
        <div
          key={i}
          className="absolute left-0 right-0 border-b border-border/60 pointer-events-none"
          style={{ top: (i + 1) * HOUR_HEIGHT_PX }}
        />
      ))}

      {/* Now-indicator (red line at current time, only on today's column) */}
      {isToday(day) && <NowIndicator />}

      {/* Timed events laid out in columns to avoid stacking */}
      {laidOut.map(({ event: ev, top, height, leftPct, widthPct }) => {
        const start = new Date(ev.start)
        const end = new Date(ev.end)
        return (
          <EventBlock
            key={ev.id}
            top={top}
            height={height}
            leftPct={leftPct}
            widthPct={widthPct}
            title={ev.title}
            timeLabel={`${format(start, "HH:mm")} – ${format(end, "HH:mm")}`}
            location={ev.location}
            hangoutLink={ev.hangoutLink}
            onClick={(e) => {
              e.stopPropagation()
              onOpenEvent(ev.id)
            }}
          />
        )
      })}
    </div>
  )
}

function NowIndicator() {
  // Cheap re-render hack: rerender every minute by re-reading Date.now().
  // Avoids pulling in a timer for a single red line.
  const now = new Date()
  const hours = now.getHours() + now.getMinutes() / 60
  if (hours < HOUR_START || hours > HOUR_END) return null
  const top = (hours - HOUR_START) * HOUR_HEIGHT_PX
  return (
    <div
      className="absolute left-0 right-0 z-10 pointer-events-none"
      style={{ top }}
    >
      <div className="h-px bg-red-500" />
      <div className="absolute -left-1 -top-1 size-2 rounded-full bg-red-500" />
    </div>
  )
}

function EventBlock({
  top,
  height,
  leftPct,
  widthPct,
  title,
  timeLabel,
  location,
  hangoutLink,
  onClick,
}: {
  top: number
  height: number
  leftPct: number
  widthPct: number
  title: string
  timeLabel: string
  location: string | null
  hangoutLink: string | null
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  // Compress the right edge slightly so adjacent columns inside a
  // cluster have a 2px gutter between them. The first column starts
  // at the left padding (4px in CSS), the last column reaches almost
  // to the right edge minus that padding.
  const style: React.CSSProperties = {
    top,
    height,
    left: `calc(${leftPct}% + 2px)`,
    width: `calc(${widthPct}% - 4px)`,
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute rounded-md border-l-2 px-1.5 py-1 overflow-hidden text-left cursor-pointer",
        "bg-[#8967F3]/15 border-[#8967F3] text-foreground",
        "hover:bg-[#8967F3]/25 hover:z-10 transition-colors",
      )}
      style={style}
      title={`${timeLabel} — ${title}${location ? ` @ ${location}` : ""}`}
    >
      <div className="text-[11px] font-medium leading-tight line-clamp-2">
        {title}
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
        {timeLabel}
      </div>
      {(location || hangoutLink) && height >= 50 && (
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          {hangoutLink && <Video className="size-3 shrink-0" />}
          {location && (
            <span className="inline-flex items-center gap-0.5 truncate">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{location}</span>
            </span>
          )}
        </div>
      )}
    </button>
  )
}

function EventChip({
  title,
  onClick,
}: {
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "block w-full truncate rounded px-1.5 py-0.5 text-[11px] text-left cursor-pointer",
        "bg-[#8967F3]/15 border-l-2 border-[#8967F3] text-foreground",
        "hover:bg-[#8967F3]/25",
      )}
      title={title}
    >
      {title}
    </button>
  )
}

function TaskChip({
  title,
  clientName,
  onClick,
}: {
  title: string
  clientName: string | null
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "block w-full truncate rounded px-1.5 py-0.5 text-[11px] text-left cursor-pointer",
        "bg-amber-500/15 border-l-2 border-amber-500 text-foreground",
        "hover:bg-amber-500/25",
      )}
      title={clientName ? `${title} — ${clientName}` : title}
    >
      {title}
      {clientName && (
        <span className="text-muted-foreground"> · {clientName}</span>
      )}
    </button>
  )
}
