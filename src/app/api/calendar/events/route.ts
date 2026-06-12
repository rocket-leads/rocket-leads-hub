import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import {
  createEvent,
  hasCalendarConnected,
  listCalendarEvents,
  type CalendarEvent,
  type CalendarFetchError,
  type EventCreate,
} from "@/lib/integrations/google-calendar"
import { NextRequest, NextResponse } from "next/server"

/**
 * Calendar page data source. Returns the user's own Google Calendar
 * events plus their open/in-progress Hub tasks with a due_date in the
 * requested window, in one round-trip.
 *
 * Calendar events come from the user's primary Google Calendar via the
 * stored OAuth token. Tasks come from `inbox_events` (kind='task').
 * Display layer color-codes the two so the AM sees both streams in one
 * grid.
 */

export const dynamic = "force-dynamic"

type TaskRow = {
  id: string
  title: string
  due_date: string | null
  client_id: string | null
  status: string
  priority: string | null
}

export type CalendarTask = TaskRow & {
  clientName: string | null
  /** Server-side classification so the client doesn't need to re-derive it. */
  bucket: "in_window" | "overdue"
  /**
   * Effective day to render this task on (YYYY-MM-DD). For `in_window`
   * this equals `due_date`. For `overdue` it's the earliest visible
   * day in the requested window so the user always sees the overdue
   * pile, even if `due_date` was weeks ago.
   */
  displayDate: string
}

export type CalendarEventsResponse = {
  connected: boolean
  events: CalendarEvent[]
  tasks: CalendarTask[]
  /** Open tasks the user owns that have no due_date at all (won't
   *  render on the grid but worth surfacing as a banner → Inbox link). */
  undatedTaskCount: number
  /** Non-null when we tried to talk to Google Calendar and it failed. */
  error: CalendarFetchError | null
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const timeMinParam = req.nextUrl.searchParams.get("timeMin")
  const timeMaxParam = req.nextUrl.searchParams.get("timeMax")
  if (!timeMinParam || !timeMaxParam) {
    return NextResponse.json(
      { error: "timeMin and timeMax are required (ISO strings)" },
      { status: 400 },
    )
  }
  const timeMin = new Date(timeMinParam)
  const timeMax = new Date(timeMaxParam)
  if (Number.isNaN(timeMin.getTime()) || Number.isNaN(timeMax.getTime())) {
    return NextResponse.json({ error: "invalid date range" }, { status: 400 })
  }

  const connected = await hasCalendarConnected(session.user.id)

  // Pull every open task the user owns plus any task that was completed
  // with a due_date inside the visible window — done tasks still render
  // (in green) so an AM can scan what they shipped this week. We classify
  // afterwards so a task with due_date last month still surfaces (as
  // "overdue" on the earliest visible day) and we can count undated
  // tasks for the banner. Caps at 200 to bound the payload — anyone with
  // that many open tasks has bigger problems than the calendar paint cost.
  const supabase = await createAdminClient()
  const windowStart = timeMin.toISOString().slice(0, 10)
  const windowEnd = timeMax.toISOString().slice(0, 10)
  const { data: openRows } = await supabase
    .from("inbox_events")
    .select("id, title, due_date, client_id, status, priority")
    .eq("assignee_id", session.user.id)
    .eq("kind", "task")
    .in("status", ["open", "in_progress"])
    .lte("due_date", windowEnd)
    .order("due_date", { ascending: true })
    .limit(200)
  const { data: doneRows } = await supabase
    .from("inbox_events")
    .select("id, title, due_date, client_id, status, priority")
    .eq("assignee_id", session.user.id)
    .eq("kind", "task")
    .eq("status", "done")
    .not("due_date", "is", null)
    .gte("due_date", windowStart)
    .lte("due_date", windowEnd)
    .order("due_date", { ascending: true })
    .limit(200)
  const taskRows = [...(openRows ?? []), ...(doneRows ?? [])]

  const allOpenTasks = taskRows as TaskRow[]

  // Resolve client names for the tasks (display-only — keeps a calendar
  // entry like "Send invoice — Acme Corp" instead of a bare title).
  let clientNameById: Record<string, string> = {}
  const clientIds = Array.from(
    new Set(
      allOpenTasks
        .map((t) => t.client_id)
        .filter((id): id is string => !!id),
    ),
  )
  if (clientIds.length > 0) {
    const { data: clientRows } = await supabase
      .from("clients")
      .select("monday_item_id, name")
      .in("monday_item_id", clientIds)
    clientNameById = Object.fromEntries(
      (clientRows ?? []).map((c) => [c.monday_item_id, c.name]),
    )
  }

  // Classify into buckets the client can render directly.
  const renderedTasks: CalendarTask[] = []
  let undatedTaskCount = 0
  for (const t of allOpenTasks) {
    const clientName = t.client_id
      ? clientNameById[t.client_id] ?? null
      : null
    if (!t.due_date) {
      undatedTaskCount++
      continue
    }
    if (t.due_date < windowStart) {
      // Overdue — collapse onto the earliest visible day so it stays
      // on the user's radar instead of vanishing into an off-screen week.
      renderedTasks.push({
        ...t,
        clientName,
        bucket: "overdue",
        displayDate: windowStart,
      })
    } else {
      renderedTasks.push({
        ...t,
        clientName,
        bucket: "in_window",
        displayDate: t.due_date,
      })
    }
  }

  const result = connected
    ? await listCalendarEvents(session.user.id, { timeMin, timeMax })
    : { events: [], error: null }

  const body: CalendarEventsResponse = {
    connected,
    events: result.events,
    tasks: renderedTasks,
    undatedTaskCount,
    error: result.error,
  }
  return NextResponse.json(body)
}

/**
 * Create a new event on the user's primary calendar. Body matches
 * EventCreate. When `addMeetLink: true`, Google provisions a Meet link
 * (visible afterwards as `hangoutLink` on the returned event).
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const input = (await req.json()) as EventCreate
  if (!input.title || !input.start || !input.end) {
    return NextResponse.json(
      { error: "title, start, and end are required" },
      { status: 400 },
    )
  }
  const result = await createEvent(session.user.id, input)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error.status || 500 },
    )
  }
  return NextResponse.json({ event: result.data })
}
