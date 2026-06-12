import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import {
  hasCalendarConnected,
  listCalendarEvents,
  type CalendarEvent,
  type CalendarFetchError,
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
  due_date: string
  client_id: string | null
  status: string
  priority: string | null
}

export type CalendarEventsResponse = {
  connected: boolean
  events: CalendarEvent[]
  tasks: Array<TaskRow & { clientName: string | null }>
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

  // Tasks come from inbox_events. due_date is a DATE column, so compare on
  // YYYY-MM-DD strings. Status filter mirrors the Tasks tab in /inbox.
  const supabase = await createAdminClient()
  const { data: taskRows } = await supabase
    .from("inbox_events")
    .select("id, title, due_date, client_id, status, priority")
    .eq("assignee_id", session.user.id)
    .eq("kind", "task")
    .in("status", ["open", "in_progress"])
    .not("due_date", "is", null)
    .gte("due_date", timeMin.toISOString().slice(0, 10))
    .lte("due_date", timeMax.toISOString().slice(0, 10))

  const tasks = (taskRows ?? []) as TaskRow[]

  // Resolve client names for the tasks (display-only — keeps a calendar
  // entry like "Send invoice — Acme Corp" instead of a bare title).
  let clientNameById: Record<string, string> = {}
  const clientIds = Array.from(
    new Set(tasks.map((t) => t.client_id).filter((id): id is string => !!id)),
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

  const result = connected
    ? await listCalendarEvents(session.user.id, { timeMin, timeMax })
    : { events: [], error: null }

  const body: CalendarEventsResponse = {
    connected,
    events: result.events,
    tasks: tasks.map((t) => ({
      ...t,
      clientName: t.client_id ? clientNameById[t.client_id] ?? null : null,
    })),
    error: result.error,
  }
  return NextResponse.json(body)
}
