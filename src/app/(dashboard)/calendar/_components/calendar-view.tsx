"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { Check, ChevronLeft, ChevronDown, ChevronRight, MapPin, Plus, Video } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { CalendarEventsResponse } from "@/app/api/calendar/events/route"
import type { CalendarsResponse } from "@/app/api/calendar/calendars/route"
import { EventDialog, type EventDialogMode } from "./event-dialog"
import { TaskDialog } from "./task-dialog"

/**
 * Week-view calendar showing the user's Google Calendar events + Hub
 * tasks side-by-side. Brand purple = events (primary integration),
 * amber = tasks (Hub-native to-dos). The split is purely visual — both
 * streams are queried in one /api/calendar/events round-trip.
 *
 * Day grid is 7:00–22:00 (HOUR_START–HOUR_END). Events outside that
 * range get clipped to the visible window with their original time
 * still surfaced in the title tooltip. Tasks have no time, so they
 * render in the all-day row at the top of their due_date column.
 */

const HOUR_START = 7
const HOUR_END = 22
const HOUR_HEIGHT_PX = 80
const TOTAL_HOURS = HOUR_END - HOUR_START
const TIME_COL_WIDTH = "w-14"

const VISIBILITY_STORAGE_KEY = "rl-calendar-visibility"
const VIEW_STORAGE_KEY = "rl-calendar-view"

type Visibility = { meetings: boolean; tasks: boolean }
const DEFAULT_VISIBILITY: Visibility = { meetings: true, tasks: true }

type CalendarViewMode = "day" | "week" | "month"
const DEFAULT_VIEW: CalendarViewMode = "week"

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

  // View mode (day/week/month) persisted in localStorage. Lazy initial
  // read — never write state from an effect.
  const [view, setView] = useState<CalendarViewMode>(() => {
    if (typeof window === "undefined") return DEFAULT_VIEW
    try {
      const raw = window.localStorage.getItem(VIEW_STORAGE_KEY)
      if (raw === "day" || raw === "week" || raw === "month") return raw
    } catch {
      // Ignore — defaults are fine.
    }
    return DEFAULT_VIEW
  })
  const updateView = (next: CalendarViewMode) => {
    setView(next)
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // Ignore.
    }
  }

  // Stream visibility toggles in the toolbar. Persisted in localStorage
  // so the AM's preferences ("show only tasks") survive page reloads.
  // Read lazily on first render so we never write state from an effect
  // (the project's set-state-in-effect lint rule). SSR has no window —
  // fall back to defaults; hydration then matches the localStorage value
  // on the client tick.
  const [visibility, setVisibility] = useState<Visibility>(() => {
    if (typeof window === "undefined") return DEFAULT_VISIBILITY
    try {
      const raw = window.localStorage.getItem(VISIBILITY_STORAGE_KEY)
      if (!raw) return DEFAULT_VISIBILITY
      const parsed = JSON.parse(raw) as Partial<Visibility>
      return {
        meetings: parsed.meetings ?? true,
        tasks: parsed.tasks ?? true,
      }
    } catch {
      return DEFAULT_VISIBILITY
    }
  })
  const toggleVisibility = (key: keyof Visibility) => {
    setVisibility((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      try {
        window.localStorage.setItem(
          VISIBILITY_STORAGE_KEY,
          JSON.stringify(next),
        )
      } catch {
        // Ignore — visibility just won't survive the next reload.
      }
      return next
    })
  }

  // Range derives from view:
  //   day   → one calendar day
  //   week  → Mon–Sun containing the anchor
  //   month → six-week grid that covers the anchor's month (the standard
  //           month-view layout — partial weeks at the start/end show as
  //           muted days from the prior/next month)
  const { rangeStart, rangeEnd, days, label } = useMemo(() => {
    if (view === "day") {
      const dayStart = startOfDay(anchor)
      const dayEnd = endOfDay(anchor)
      return {
        rangeStart: dayStart,
        rangeEnd: dayEnd,
        days: [dayStart],
        label: format(anchor, "EEEE, d MMM yyyy"),
      }
    }
    if (view === "month") {
      const monthStart = startOfMonth(anchor)
      const monthEnd = endOfMonth(anchor)
      const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 })
      const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
      const out: Date[] = []
      let cursor = gridStart
      while (cursor <= gridEnd) {
        out.push(cursor)
        cursor = addDays(cursor, 1)
      }
      return {
        rangeStart: gridStart,
        rangeEnd: gridEnd,
        days: out,
        label: format(anchor, "MMMM yyyy"),
      }
    }
    const weekStart = startOfWeek(anchor, { weekStartsOn: 1 })
    const weekEnd = endOfWeek(anchor, { weekStartsOn: 1 })
    return {
      rangeStart: weekStart,
      rangeEnd: weekEnd,
      days: Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
      label: `${format(weekStart, "d MMM")} – ${format(weekEnd, "d MMM yyyy")}`,
    }
  }, [anchor, view])

  const timeMinIso = rangeStart.toISOString()
  const timeMaxIso = rangeEnd.toISOString()

  const stepForward = () => {
    setAnchor((d) =>
      view === "day" ? addDays(d, 1) : view === "month" ? addMonths(d, 1) : addWeeks(d, 1),
    )
  }
  const stepBack = () => {
    setAnchor((d) =>
      view === "day" ? addDays(d, -1) : view === "month" ? addMonths(d, -1) : addWeeks(d, -1),
    )
  }

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

  // Split events + tasks into buckets per day. Visibility toggles are
  // applied here so a flipped-off stream contributes nothing — the
  // grid layout stays identical. Tasks split into two buckets:
  //   tasksAllDayByDay  — no scheduled_at; renders in all-day strip
  //   tasksTimedByDay   — has scheduled_at; renders as 30-min block
  //                       in the time grid at that time
  const { allDayByDay, timedByDay, tasksAllDayByDay, tasksTimedByDay } =
    useMemo(() => {
      const allDay: Record<string, CalendarEventsResponse["events"]> = {}
      const timed: Record<string, CalendarEventsResponse["events"]> = {}
      const tasksAllDay: Record<string, CalendarEventsResponse["tasks"]> = {}
      const tasksTimed: Record<string, CalendarEventsResponse["tasks"]> = {}
      for (const d of days) {
        const key = format(d, "yyyy-MM-dd")
        allDay[key] = []
        timed[key] = []
        tasksAllDay[key] = []
        tasksTimed[key] = []
      }
      if (visibility.meetings) {
        for (const ev of data?.events ?? []) {
          if (ev.allDay) {
            const key = ev.start.slice(0, 10)
            if (allDay[key]) allDay[key].push(ev)
          } else {
            const start = new Date(ev.start)
            const key = format(start, "yyyy-MM-dd")
            if (timed[key]) timed[key].push(ev)
          }
        }
      }
      if (visibility.tasks) {
        for (const tk of data?.tasks ?? []) {
          if (tk.scheduled_at) {
            const key = format(parseISO(tk.scheduled_at), "yyyy-MM-dd")
            if (tasksTimed[key]) tasksTimed[key].push(tk)
          } else if (tasksAllDay[tk.displayDate]) {
            tasksAllDay[tk.displayDate].push(tk)
          }
        }
      }
      return {
        allDayByDay: allDay,
        timedByDay: timed,
        tasksAllDayByDay: tasksAllDay,
        tasksTimedByDay: tasksTimed,
      }
    }, [data, days, visibility])

  const queryClient = useQueryClient()
  const rescheduleTaskMut = useMutation({
    mutationFn: async ({
      taskId,
      scheduledAt,
    }: {
      taskId: string
      scheduledAt: string | null
    }) => {
      const res = await fetch(
        `/api/inbox/${encodeURIComponent(taskId)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduledAt }),
        },
      )
      if (!res.ok) throw new Error("Failed to reschedule task")
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
    },
  })

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
              aria-label={`Previous ${view}`}
              onClick={stepBack}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Next ${view}`}
              onClick={stepForward}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="text-sm font-medium text-foreground">{label}</div>
        </div>

        <div className="flex items-center gap-2">
          <ViewModeSwitcher view={view} onChange={updateView} />
          <CalendarSelector
            disabled={!connected}
            on={visibility.meetings}
            onMeetingsToggle={() => toggleVisibility("meetings")}
          />
          <VisibilityToggle
            label="Tasks"
            color="#f59e0b"
            on={visibility.tasks}
            onClick={() => toggleVisibility("tasks")}
          />
          <Button
            size="sm"
            onClick={() => setDialog({ kind: "create" })}
            disabled={!connected}
            title={!connected ? "Connect Google Calendar to create events" : undefined}
            className="ml-2"
          >
            <Plus className="size-4" />
            New event
          </Button>
        </div>
      </div>

      {!connected && <ConnectPrompt />}

      {data?.error && <CalendarErrorBanner error={data.error} />}

      {visibility.tasks && (data?.undatedTaskCount ?? 0) > 0 && (
        <UndatedTasksBanner count={data!.undatedTaskCount} />
      )}

      {view === "month" ? (
        <MonthGrid
          days={days}
          anchor={anchor}
          eventsByDay={timedByDay}
          allDayByDay={allDayByDay}
          tasksByDay={tasksAllDayByDay}
          tasksTimedByDay={tasksTimedByDay}
          onOpenEvent={(id, calendarId) =>
            setDialog({ kind: "view", eventId: id, calendarId })
          }
          onOpenTask={(id) => setTaskDialogId(id)}
          onJumpToDay={(d) => {
            setAnchor(d)
            updateView("day")
          }}
        />
      ) : (
        <TimeGrid
          days={days}
          timedByDay={timedByDay}
          allDayByDay={allDayByDay}
          tasksAllDayByDay={tasksAllDayByDay}
          tasksTimedByDay={tasksTimedByDay}
          onOpenEvent={(id, calendarId) =>
            setDialog({ kind: "view", eventId: id, calendarId })
          }
          onOpenTask={(id) => setTaskDialogId(id)}
          onCreateAt={(when) => setDialog({ kind: "create", initialStart: when })}
          onRescheduleTask={(taskId, when) =>
            rescheduleTaskMut.mutate({
              taskId,
              scheduledAt: when ? when.toISOString() : null,
            })
          }
        />
      )}

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

function ViewModeSwitcher({
  view,
  onChange,
}: {
  view: CalendarViewMode
  onChange: (v: CalendarViewMode) => void
}) {
  const modes: { value: CalendarViewMode; label: string }[] = [
    { value: "day", label: "Day" },
    { value: "week", label: "Week" },
    { value: "month", label: "Month" },
  ]
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-muted/30 p-0.5">
      {modes.map((m) => (
        <button
          key={m.value}
          type="button"
          onClick={() => onChange(m.value)}
          className={cn(
            "px-2.5 py-1 text-xs font-medium rounded transition-colors",
            view === m.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

function TimeGrid({
  days,
  timedByDay,
  allDayByDay,
  tasksAllDayByDay,
  tasksTimedByDay,
  onOpenEvent,
  onOpenTask,
  onCreateAt,
  onRescheduleTask,
}: {
  days: Date[]
  timedByDay: Record<string, CalendarEventsResponse["events"]>
  allDayByDay: Record<string, CalendarEventsResponse["events"]>
  tasksAllDayByDay: Record<string, CalendarEventsResponse["tasks"]>
  tasksTimedByDay: Record<string, CalendarEventsResponse["tasks"]>
  onOpenEvent: (id: string, calendarId: string) => void
  onOpenTask: (id: string) => void
  onCreateAt: (when: Date) => void
  /** Drop handler. when=null clears the time (back to all-day strip). */
  onRescheduleTask: (taskId: string, when: Date | null) => void
}) {
  // grid-cols template = 56px gutter + N flexible columns. Built as an
  // inline style because Tailwind's JIT can't generate dynamic counts.
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))`,
  }
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header row */}
      <div
        className="grid border-b border-border bg-muted/30"
        style={gridStyle}
      >
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

      <AllDayRow
        days={days}
        allDayByDay={allDayByDay}
        tasksByDay={tasksAllDayByDay}
        onOpenEvent={onOpenEvent}
        onOpenTask={onOpenTask}
        onUnscheduleTask={(taskId) => onRescheduleTask(taskId, null)}
        gridStyle={gridStyle}
        hasAnyContent={
          Object.values(allDayByDay).some((arr) => arr.length > 0) ||
          Object.values(tasksAllDayByDay).some((arr) => arr.length > 0)
        }
      />

      {/* Hour grid */}
      <div className="relative grid" style={gridStyle}>
        <div className={cn(TIME_COL_WIDTH, "border-r border-border")}>
          {Array.from({ length: TOTAL_HOURS }, (_, i) => (
            <div
              key={i}
              className="px-2 pt-1 text-[10px] text-muted-foreground border-b border-border/60"
              style={{ height: HOUR_HEIGHT_PX }}
            >
              {String(HOUR_START + i).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {days.map((d) => {
          const key = format(d, "yyyy-MM-dd")
          return (
            <DayColumn
              key={key}
              day={d}
              events={timedByDay[key] ?? []}
              scheduledTasks={tasksTimedByDay[key] ?? []}
              onOpenEvent={onOpenEvent}
              onOpenTask={onOpenTask}
              onCreateAt={onCreateAt}
              onRescheduleTask={onRescheduleTask}
            />
          )
        })}
      </div>
    </div>
  )
}

function MonthGrid({
  days,
  anchor,
  eventsByDay,
  allDayByDay,
  tasksByDay,
  tasksTimedByDay,
  onOpenEvent,
  onOpenTask,
  onJumpToDay,
}: {
  days: Date[]
  anchor: Date
  eventsByDay: Record<string, CalendarEventsResponse["events"]>
  allDayByDay: Record<string, CalendarEventsResponse["events"]>
  tasksByDay: Record<string, CalendarEventsResponse["tasks"]>
  tasksTimedByDay: Record<string, CalendarEventsResponse["tasks"]>
  onOpenEvent: (id: string, calendarId: string) => void
  onOpenTask: (id: string) => void
  onJumpToDay: (day: Date) => void
}) {
  const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const MAX_CHIPS_PER_DAY = 3
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-border bg-muted/30">
        {WEEKDAY_LABELS.map((d) => (
          <div
            key={d}
            className="py-2 px-2 text-center text-[11px] uppercase tracking-wide text-muted-foreground border-r border-border last:border-r-0"
          >
            {d}
          </div>
        ))}
      </div>

      {/* 6-week grid */}
      <div className="grid grid-cols-7 grid-rows-6">
        {days.map((d) => {
          const key = format(d, "yyyy-MM-dd")
          const inMonth = isSameMonth(d, anchor)
          const today = isToday(d)
          const allDay = allDayByDay[key] ?? []
          const timed = eventsByDay[key] ?? []
          const tasks = [
            ...(tasksByDay[key] ?? []),
            ...(tasksTimedByDay[key] ?? []),
          ]
          const eventChips = [...allDay, ...timed].slice(0, MAX_CHIPS_PER_DAY)
          const overflowCount =
            allDay.length + timed.length - eventChips.length
          const taskChips = tasks.slice(0, MAX_CHIPS_PER_DAY)
          const taskOverflow = tasks.length - taskChips.length
          return (
            <button
              type="button"
              key={key}
              onClick={() => onJumpToDay(d)}
              className={cn(
                "relative min-h-[110px] border-r border-b border-border last:border-r-0 px-1.5 py-1 text-left",
                "hover:bg-muted/30 transition-colors",
                today && "bg-primary/5",
                !inMonth && "bg-muted/10",
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums",
                    today
                      ? "bg-primary text-primary-foreground"
                      : inMonth
                        ? "text-foreground"
                        : "text-muted-foreground/60",
                  )}
                >
                  {format(d, "d")}
                </span>
              </div>
              <div className="space-y-0.5">
                {eventChips.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenEvent(ev.id, ev.calendarId)
                    }}
                    className="block w-full truncate rounded px-1 py-0.5 text-[10px] text-left border-l-2 hover:brightness-110 transition-[filter]"
                    style={{
                      backgroundColor: `${ev.calendarColor}26`,
                      borderLeftColor: ev.calendarColor,
                    }}
                  >
                    {!ev.allDay && (
                      <span className="tabular-nums text-muted-foreground mr-1">
                        {format(parseISO(ev.start), "HH:mm")}
                      </span>
                    )}
                    {ev.title}
                  </button>
                ))}
                {taskChips.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenTask(t.id)
                    }}
                    className={cn(
                      "block w-full truncate rounded px-1 py-0.5 text-[10px] text-left border-l-2",
                      t.status === "done"
                        ? "bg-emerald-500/15 border-emerald-500 line-through decoration-emerald-500/60 text-foreground/70"
                        : t.bucket === "overdue"
                          ? "bg-red-500/15 border-red-500 hover:bg-red-500/25"
                          : "bg-amber-500/15 border-amber-500 hover:bg-amber-500/25",
                    )}
                  >
                    {t.title}
                  </button>
                ))}
                {(overflowCount > 0 || taskOverflow > 0) && (
                  <div className="text-[10px] text-muted-foreground pl-1">
                    + {overflowCount + taskOverflow} more
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Subcalendar picker in the toolbar. Replaces the old single
 * "Meetings on/off" chip with a popover listing every subcalendar from
 * the connected Google account, each with its own colour swatch + tick.
 *
 * Behaviour:
 *  - Trigger button doubles as the meetings on/off toggle. Click toggles
 *    the global meetings stream; the chevron opens the picker.
 *  - Picker checkboxes save instantly to the user row in Supabase so
 *    "I want only Roy + Roel" survives across devices.
 *  - Saving the selection invalidates the events query so the grid
 *    re-paints with only the chosen calendars.
 */
function CalendarSelector({
  disabled,
  on,
  onMeetingsToggle,
}: {
  disabled: boolean
  on: boolean
  onMeetingsToggle: () => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const q = useQuery<CalendarsResponse>({
    queryKey: ["calendar-list"],
    queryFn: async () => {
      const res = await fetch("/api/calendar/calendars", {
        credentials: "include",
      })
      if (!res.ok) throw new Error("Failed to load calendars")
      return (await res.json()) as CalendarsResponse
    },
    enabled: !disabled,
    staleTime: 5 * 60 * 1000,
  })

  // Effective selection — the list of IDs that are actually included
  // right now, accounting for the "null = follow Google's selected"
  // fallback. Used both to render the checkbox state and to compute
  // optimistic updates when the user toggles a row.
  const effectiveSelected = useMemo<Set<string>>(() => {
    if (!q.data) return new Set()
    if (q.data.selectedIds === null) {
      const ids = q.data.calendars
        .filter((c) => c.selectedByDefault || c.primary)
        .map((c) => c.id)
      return new Set(ids.length > 0 ? ids : q.data.calendars.map((c) => c.id))
    }
    return new Set(q.data.selectedIds)
  }, [q.data])

  const saveMut = useMutation({
    mutationFn: async (selectedIds: string[]) => {
      const res = await fetch("/api/calendar/calendars", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedIds }),
      })
      if (!res.ok) throw new Error("Failed to save selection")
    },
    onMutate: async (selectedIds) => {
      await queryClient.cancelQueries({ queryKey: ["calendar-list"] })
      const previous = queryClient.getQueryData<CalendarsResponse>([
        "calendar-list",
      ])
      if (previous) {
        queryClient.setQueryData<CalendarsResponse>(["calendar-list"], {
          ...previous,
          selectedIds,
        })
      }
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["calendar-list"], ctx.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-list"] })
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
    },
  })

  const toggleCalendar = (id: string) => {
    const next = new Set(effectiveSelected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    saveMut.mutate(Array.from(next))
  }

  const calendars = q.data?.calendars ?? []
  const visibleCount = effectiveSelected.size
  const totalCount = calendars.length

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border transition-colors",
        on
          ? "border-border bg-card text-foreground"
          : "border-border bg-transparent text-muted-foreground/70",
      )}
    >
      <button
        type="button"
        onClick={onMeetingsToggle}
        aria-pressed={on}
        title={`${on ? "Hide" : "Show"} meetings`}
        className="inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 text-xs font-medium hover:text-foreground"
      >
        <span
          className="inline-block size-2.5 rounded-sm shrink-0"
          style={{ backgroundColor: "#8967F3", opacity: on ? 1 : 0.3 }}
        />
        <span className={cn(!on && "line-through decoration-muted-foreground/40")}>
          Meetings
        </span>
        {on && totalCount > 0 && (
          <span className="tabular-nums text-[10px] text-muted-foreground">
            {visibleCount}/{totalCount}
          </span>
        )}
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={(props) => (
            <button
              {...props}
              type="button"
              disabled={disabled}
              title={disabled ? "Connect Google Calendar first" : "Pick which calendars to show"}
              className={cn(
                "inline-flex items-center justify-center px-1.5 py-1 border-l border-border/60",
                "hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              <ChevronDown className="size-3.5" />
            </button>
          )}
        />
        <PopoverContent align="end" className="w-72 p-0">
          <div className="px-3 py-2.5 border-b border-border/60">
            <div className="text-xs font-medium text-foreground">Calendars</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Pick which Google subcalendars feed the Hub view.
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {q.isLoading && (
              <div className="px-3 py-4 text-xs text-muted-foreground">
                Loading…
              </div>
            )}
            {q.data?.error && (
              <div className="px-3 py-2 text-xs text-destructive">
                {q.data.error.message}
                {q.data.error.hint && (
                  <div className="mt-1 text-foreground/80">→ {q.data.error.hint}</div>
                )}
              </div>
            )}
            {!q.isLoading && calendars.length === 0 && !q.data?.error && (
              <div className="px-3 py-4 text-xs text-muted-foreground">
                No calendars found on this account.
              </div>
            )}
            {calendars.map((cal) => {
              const checked = effectiveSelected.has(cal.id)
              return (
                <button
                  key={cal.id}
                  type="button"
                  onClick={() => toggleCalendar(cal.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      "inline-flex items-center justify-center size-4 rounded-sm border transition-colors shrink-0",
                      checked ? "border-transparent" : "border-border bg-transparent",
                    )}
                    style={checked ? { backgroundColor: cal.backgroundColor } : undefined}
                  >
                    {checked && (
                      <Check
                        className="size-3"
                        style={{ color: cal.foregroundColor }}
                      />
                    )}
                  </span>
                  <span className="flex-1 truncate text-foreground">
                    {cal.summary}
                  </span>
                  {cal.primary && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      Primary
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function VisibilityToggle({
  label,
  color,
  on,
  onClick,
}: {
  label: string
  color: string
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={`${on ? "Hide" : "Show"} ${label.toLowerCase()}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
        on
          ? "border-border bg-card text-foreground hover:bg-muted/40"
          : "border-border bg-transparent text-muted-foreground/70 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "inline-block size-2.5 rounded-sm transition-opacity",
          !on && "opacity-30",
        )}
        style={{ backgroundColor: color }}
      />
      <span className={cn(!on && "line-through decoration-muted-foreground/40")}>
        {label}
      </span>
    </button>
  )
}

function UndatedTasksBanner({ count }: { count: number }) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm flex items-center justify-between gap-3">
      <p className="text-foreground">
        You have{" "}
        <span className="font-medium">
          {count} task{count === 1 ? "" : "s"} without a due date
        </span>
        . Add a due date in the Inbox and they&apos;ll show up here.
      </p>
      <Link
        href="/inbox?tab=tasks"
        className="shrink-0 text-xs font-medium text-foreground underline underline-offset-2 hover:text-primary"
      >
        Open Inbox
      </Link>
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
  onUnscheduleTask,
  gridStyle,
  hasAnyContent,
}: {
  days: Date[]
  allDayByDay: Record<string, CalendarEventsResponse["events"]>
  tasksByDay: Record<string, CalendarEventsResponse["tasks"]>
  onOpenEvent: (id: string, calendarId: string) => void
  onOpenTask: (id: string) => void
  onUnscheduleTask: (taskId: string) => void
  gridStyle: React.CSSProperties
  /** When false, the row collapses to a slim divider — still present
   *  so unscheduled-task drops work, but it doesn't waste vertical
   *  space when there's nothing to show. */
  hasAnyContent: boolean
}) {
  // When the row has no content, collapse to a slim 16px strip — still
  // present as a drop target so users can drag tasks back to "unscheduled",
  // but doesn't steal vertical space above the time grid.
  return (
    <div
      className="grid border-b border-border bg-muted/10"
      style={gridStyle}
    >
      <div
        className={cn(
          TIME_COL_WIDTH,
          "border-r border-border text-[10px] text-muted-foreground",
          hasAnyContent ? "py-2 px-2" : "px-2",
        )}
      >
        {hasAnyContent ? "all-day" : ""}
      </div>
      {days.map((d) => {
        const key = format(d, "yyyy-MM-dd")
        const allDayEvents = allDayByDay[key] ?? []
        const tasks = tasksByDay[key] ?? []
        return (
          <AllDayCell
            key={key}
            isToday={isToday(d)}
            onUnscheduleTask={onUnscheduleTask}
            slim={!hasAnyContent}
          >
            {allDayEvents.map((ev) => (
              <EventChip
                key={ev.id}
                title={ev.title}
                color={ev.calendarColor}
                onClick={() => onOpenEvent(ev.id, ev.calendarId)}
              />
            ))}
            {tasks.map((t) => (
              <TaskChip
                key={t.id}
                taskId={t.id}
                title={t.title}
                clientName={t.clientName}
                overdue={t.bucket === "overdue" && t.status !== "done"}
                done={t.status === "done"}
                originalDueDate={t.due_date}
                onClick={() => onOpenTask(t.id)}
              />
            ))}
          </AllDayCell>
        )
      })}
    </div>
  )
}

function AllDayCell({
  children,
  isToday,
  onUnscheduleTask,
  slim,
}: {
  children: React.ReactNode
  isToday: boolean
  onUnscheduleTask: (taskId: string) => void
  /** Compact mode used when the all-day row has no content this week —
   *  shrinks to a slim divider that still accepts task drops. */
  slim?: boolean
}) {
  const [dragOver, setDragOver] = useState(false)
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (Array.from(e.dataTransfer.types).includes(TASK_DRAG_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      if (!dragOver) setDragOver(true)
    }
  }
  const onDragLeave = () => setDragOver(false)
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const taskId = e.dataTransfer.getData(TASK_DRAG_MIME)
    setDragOver(false)
    if (!taskId) return
    e.preventDefault()
    onUnscheduleTask(taskId)
  }
  return (
    <div
      className={cn(
        "border-r border-border last:border-r-0",
        slim ? "min-h-[14px]" : "p-1.5 space-y-1 min-h-[44px]",
        isToday && "bg-primary/5",
        dragOver && "bg-amber-500/10 ring-2 ring-inset ring-amber-500/40",
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
    </div>
  )
}

type GridItem =
  | { kind: "event"; event: CalendarEventsResponse["events"][number] }
  | { kind: "task"; task: CalendarEventsResponse["tasks"][number] }

type LaidOutItem = {
  item: GridItem
  top: number
  height: number
  leftPct: number
  widthPct: number
}

/**
 * Layout overlapping items as columns within their cluster. Standard
 * calendar algorithm:
 *
 *   1. Compute each item's pixel top/bottom in the visible window.
 *   2. Sort by start time, longer items first when starts tie.
 *   3. Sweep top→bottom collecting "clusters" — connected groups where
 *      each item overlaps with at least one other in the cluster.
 *   4. Within each cluster, greedily place items into columns: take
 *      the first column whose last item ends before this one starts.
 *   5. Each item gets `width = 1 / clusterCols`, `left = col * width`.
 *
 * Tasks and events share this packing so a 30-min task at 09:00 next
 * to a 15-min meeting at 09:00 split the column 50/50 instead of the
 * task being pinned to a separate strip. Heights are accurate to time
 * (no min-height clamp) so a 15-min meeting renders at exactly 1/4 of
 * the hour-row height.
 */
function layoutDayItems(
  items: GridItem[],
  dayStart: Date,
): LaidOutItem[] {
  const positioned = items.map((item) => {
    let start: Date
    let end: Date
    if (item.kind === "event") {
      start = new Date(item.event.start)
      end = new Date(item.event.end)
    } else {
      start = parseISO(item.task.scheduled_at!)
      // Default task duration = 30 min. Could become configurable per
      // task once Roy wants to drag-resize, but a uniform 30 keeps the
      // drop-snap UX predictable.
      end = new Date(start.getTime() + 30 * 60 * 1000)
    }
    const startHour = (start.getTime() - dayStart.getTime()) / 3_600_000
    const endHour = (end.getTime() - dayStart.getTime()) / 3_600_000
    const top = Math.max(0, startHour - HOUR_START) * HOUR_HEIGHT_PX
    const bottom =
      Math.min(TOTAL_HOURS, endHour - HOUR_START) * HOUR_HEIGHT_PX
    // Honest height — no clamp. With HOUR_HEIGHT_PX=80 the smallest
    // realistic event (15 min) renders at 20px which is enough for a
    // single line. Even shorter events keep their actual proportion
    // so the grid stays accurate rather than visually rounded up.
    const height = bottom - top
    return { item, top, height, endPx: top + height }
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
  const result: LaidOutItem[] = []
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
        item: p.item,
        top: p.top,
        height: p.height,
        leftPct: (col / totalCols) * 100,
        widthPct: 100 / totalCols,
      })
    }
  }
  return result
}

const TASK_DRAG_MIME = "application/x-rl-task-id"

/** Y-pixel of the half-hour slot the cursor is currently inside.
 *  Floor-based, matches the visible half-hour grid lines so the
 *  ghost preview lines up cell-by-cell as the user drags. */
function snapYToHalfHour(clientY: number, rect: DOMRect): number {
  const y = Math.max(0, Math.min(rect.height, clientY - rect.top))
  const halfHourPx = HOUR_HEIGHT_PX / 2
  return Math.floor(y / halfHourPx) * halfHourPx
}

/** Converts a snapped pixel-top back into a wall-clock Date on `day`. */
function topToTime(top: number, day: Date): Date {
  const minutesFromGridStart = (top / HOUR_HEIGHT_PX) * 60
  const totalMinutes = HOUR_START * 60 + Math.round(minutesFromGridStart)
  const when = new Date(day)
  when.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0)
  return when
}

/** Used by the click-to-create-event flow (not drag). 15-minute snap
 *  feels natural for "I want to type out a 9:15 standup" — keeps the
 *  finer resolution for events, which are not constrained to 30 min. */
function pointerToTime(
  e: { clientY: number },
  rect: DOMRect,
  day: Date,
): Date {
  const y = e.clientY - rect.top
  const hourFloat = HOUR_START + y / HOUR_HEIGHT_PX
  const hour = Math.floor(hourFloat)
  const minute = Math.round(((hourFloat - hour) * 60) / 15) * 15
  const when = new Date(day)
  when.setHours(hour, Math.min(minute, 45), 0, 0)
  return when
}

function DayColumn({
  day,
  events,
  scheduledTasks,
  onOpenEvent,
  onOpenTask,
  onCreateAt,
  onRescheduleTask,
}: {
  day: Date
  events: CalendarEventsResponse["events"]
  scheduledTasks: CalendarEventsResponse["tasks"]
  onOpenEvent: (id: string, calendarId: string) => void
  onOpenTask: (id: string) => void
  onCreateAt: (when: Date) => void
  onRescheduleTask: (taskId: string, when: Date | null) => void
}) {
  const dayStart = startOfDay(day)
  const laidOut = useMemo(() => {
    const items: GridItem[] = [
      ...events.map((event) => ({ kind: "event" as const, event })),
      ...scheduledTasks.map((task) => ({ kind: "task" as const, task })),
    ]
    return layoutDayItems(items, dayStart)
  }, [events, scheduledTasks, dayStart])
  // previewTop = pixel-top of the half-hour cell the cursor is in,
  // or null when nothing is being dragged over this column. Updated
  // on every dragOver tick so the ghost block tracks the cursor.
  const [previewTop, setPreviewTop] = useState<number | null>(null)
  const halfHourPx = HOUR_HEIGHT_PX / 2

  // Click on an empty slot in the column → open the create dialog
  // pre-seeded to the slot the user clicked. The event blocks have
  // their own click handlers and stop propagation.
  const onColumnClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const when = pointerToTime(e, rect, day)
    onCreateAt(when)
  }

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes(TASK_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    const rect = e.currentTarget.getBoundingClientRect()
    const snapped = snapYToHalfHour(e.clientY, rect)
    if (snapped !== previewTop) setPreviewTop(snapped)
  }
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Only clear when the cursor truly leaves the column box —
    // dragleave also fires when crossing into a child element.
    const rect = e.currentTarget.getBoundingClientRect()
    if (
      e.clientX < rect.left ||
      e.clientX >= rect.right ||
      e.clientY < rect.top ||
      e.clientY >= rect.bottom
    ) {
      setPreviewTop(null)
    }
  }
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const taskId = e.dataTransfer.getData(TASK_DRAG_MIME)
    setPreviewTop(null)
    if (!taskId) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const snapped = snapYToHalfHour(e.clientY, rect)
    onRescheduleTask(taskId, topToTime(snapped, day))
  }

  return (
    <div
      className={cn(
        "relative border-r border-border last:border-r-0 cursor-pointer",
        isToday(day) && "bg-primary/5",
      )}
      style={{ height: TOTAL_HOURS * HOUR_HEIGHT_PX }}
      onClick={onColumnClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Hour grid lines (full) + half-hour grid lines (subtle dashed).
          The half-hour ticks make the 30-min snap target visible during
          drag so the user can see exactly where the ghost will land. */}
      {Array.from({ length: TOTAL_HOURS }, (_, i) => (
        <div
          key={`hr-${i}`}
          className="absolute left-0 right-0 border-b border-border/60 pointer-events-none"
          style={{ top: (i + 1) * HOUR_HEIGHT_PX }}
        />
      ))}
      {Array.from({ length: TOTAL_HOURS }, (_, i) => (
        <div
          key={`hh-${i}`}
          className="absolute left-0 right-0 border-b border-dashed border-border/35 pointer-events-none"
          style={{ top: i * HOUR_HEIGHT_PX + halfHourPx }}
        />
      ))}

      {/* Drag-snap ghost — the half-hour cell the cursor is currently in.
          Spans the full column width since tasks now share column packing
          with events. Updates live on every dragOver tick. */}
      {previewTop !== null && (
        <div
          className="absolute left-1 right-1 z-20 rounded-md border-l-2 border-amber-500 bg-amber-500/30 pointer-events-none"
          style={{ top: previewTop, height: halfHourPx }}
        >
          <div className="px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300 tabular-nums">
            {format(topToTime(previewTop, day), "HH:mm")}
          </div>
        </div>
      )}

      {/* Now-indicator (red line at current time, only on today's column) */}
      {isToday(day) && <NowIndicator />}

      {/* Unified column-packed render — events and tasks share the same
          layout so a meeting and a task at the same time go side-by-side
          at half width rather than stacking or claiming separate halves. */}
      {laidOut.map(({ item, top, height, leftPct, widthPct }) => {
        if (item.kind === "event") {
          const ev = item.event
          const start = new Date(ev.start)
          const end = new Date(ev.end)
          return (
            <EventBlock
              key={`ev-${ev.id}`}
              top={top}
              height={height}
              leftPct={leftPct}
              widthPct={widthPct}
              title={ev.title}
              color={ev.calendarColor}
              timeLabel={`${format(start, "HH:mm")} – ${format(end, "HH:mm")}`}
              location={ev.location}
              hangoutLink={ev.hangoutLink}
              onClick={(e) => {
                e.stopPropagation()
                onOpenEvent(ev.id, ev.calendarId)
              }}
            />
          )
        }
        const tk = item.task
        const start = parseISO(tk.scheduled_at!)
        return (
          <TaskBlock
            key={`tk-${tk.id}`}
            taskId={tk.id}
            top={top}
            height={height}
            leftPct={leftPct}
            widthPct={widthPct}
            title={tk.title}
            done={tk.status === "done"}
            overdue={tk.bucket === "overdue" && tk.status !== "done"}
            timeLabel={format(start, "HH:mm")}
            onClick={(e) => {
              e.stopPropagation()
              onOpenTask(tk.id)
            }}
          />
        )
      })}
    </div>
  )
}

function TaskBlock({
  taskId,
  top,
  height,
  leftPct,
  widthPct,
  title,
  done,
  overdue,
  timeLabel,
  onClick,
}: {
  taskId: string
  top: number
  height: number
  leftPct: number
  widthPct: number
  title: string
  done: boolean
  overdue: boolean
  timeLabel: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const onDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.setData(TASK_DRAG_MIME, taskId)
    e.dataTransfer.setData("text/plain", taskId)
    e.dataTransfer.effectAllowed = "move"
  }
  const palette = done
    ? "bg-emerald-500/15 border-emerald-500 line-through decoration-emerald-500/60 text-foreground/70"
    : overdue
      ? "bg-red-500/15 border-red-500 hover:bg-red-500/25"
      : "bg-amber-500/15 border-amber-500 hover:bg-amber-500/25"
  const style: React.CSSProperties = {
    top,
    height,
    left: `calc(${leftPct}% + 2px)`,
    width: `calc(${widthPct}% - 4px)`,
  }
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={cn(
        "absolute rounded-md border-l-2 px-1.5 py-0.5 overflow-hidden text-left",
        "cursor-grab active:cursor-grabbing hover:z-10",
        palette,
      )}
      style={style}
      title={`${timeLabel} — ${title}`}
    >
      <div className="text-[11px] font-medium leading-tight truncate">
        {done && (
          <span className="text-emerald-600 dark:text-emerald-400 mr-0.5">✓</span>
        )}
        {!done && overdue && (
          <span className="font-semibold text-red-600 dark:text-red-400">⚠ </span>
        )}
        <span className="tabular-nums text-muted-foreground mr-1">
          {timeLabel}
        </span>
        {title}
      </div>
    </button>
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
  color,
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
  /** Hex colour from the source calendar — drives bg tint + left border. */
  color: string
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
    backgroundColor: `${color}26`, // ~15% alpha (0x26/0xFF)
    borderLeftColor: color,
  }
  // Adapt content density to the block's vertical real estate so a
  // 30-minute meeting never spills its time label into the next row.
  //   < 32px → single line, time + title inline
  //   < 52px → title (clamped to 1 line) + time on its own line
  //   ≥ 52px → title (2 lines) + time + optional location/Meet icons
  const tightLayout = height < 32
  const mediumLayout = height < 52
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute rounded-md border-l-2 overflow-hidden text-left cursor-pointer text-foreground",
        tightLayout ? "px-1.5 py-0.5" : "px-1.5 py-1",
        "hover:brightness-110 hover:z-10 transition-[filter]",
      )}
      style={style}
      title={`${timeLabel} — ${title}${location ? ` @ ${location}` : ""}`}
    >
      {tightLayout ? (
        <div className="text-[10px] font-medium leading-tight truncate">
          <span className="text-muted-foreground tabular-nums mr-1">
            {timeLabel.split(" – ")[0]}
          </span>
          {title}
        </div>
      ) : (
        <>
          <div
            className={cn(
              "text-[11px] font-medium leading-tight",
              mediumLayout ? "truncate" : "line-clamp-2",
            )}
          >
            {title}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums truncate">
            {timeLabel}
          </div>
          {(location || hangoutLink) && !mediumLayout && height >= 70 && (
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
        </>
      )}
    </button>
  )
}

function EventChip({
  title,
  color,
  onClick,
}: {
  title: string
  color: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "block w-full truncate rounded px-1.5 py-0.5 text-[11px] text-left cursor-pointer",
        "border-l-2 text-foreground hover:brightness-110 transition-[filter]",
      )}
      style={{ backgroundColor: `${color}26`, borderLeftColor: color }}
      title={title}
    >
      {title}
    </button>
  )
}

function TaskChip({
  title,
  taskId,
  clientName,
  overdue,
  done,
  originalDueDate,
  onClick,
}: {
  title: string
  taskId: string
  clientName: string | null
  overdue: boolean
  done: boolean
  originalDueDate: string | null
  onClick: () => void
}) {
  const onDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.setData(TASK_DRAG_MIME, taskId)
    e.dataTransfer.setData("text/plain", taskId)
    e.dataTransfer.effectAllowed = "move"
  }
  // Three colour states:
  //   done    — emerald, line-through. Shows "you shipped this".
  //   overdue — red + ⚠. Shows "you missed this".
  //   open    — amber. Default state.
  const tooltipParts = [
    title,
    clientName && `— ${clientName}`,
    overdue && originalDueDate && `(overdue since ${originalDueDate})`,
    done && "(done)",
  ].filter(Boolean) as string[]
  const palette = done
    ? "bg-emerald-500/15 border-l-2 border-emerald-500 text-foreground hover:bg-emerald-500/25"
    : overdue
      ? "bg-red-500/15 border-l-2 border-red-500 text-foreground hover:bg-red-500/25"
      : "bg-amber-500/15 border-l-2 border-amber-500 text-foreground hover:bg-amber-500/25"
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={cn(
        "block w-full truncate rounded px-1.5 py-0.5 text-[11px] text-left",
        "cursor-grab active:cursor-grabbing",
        palette,
        done && "line-through decoration-emerald-500/60 text-foreground/70",
      )}
      title={tooltipParts.join(" ")}
    >
      {!done && overdue && (
        <span className="font-semibold text-red-600 dark:text-red-400">⚠ </span>
      )}
      {done && (
        <span className="text-emerald-600 dark:text-emerald-400 mr-0.5">✓</span>
      )}
      {title}
      {clientName && (
        <span className="text-muted-foreground"> · {clientName}</span>
      )}
    </button>
  )
}
