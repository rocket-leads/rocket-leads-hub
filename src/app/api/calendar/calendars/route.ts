import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import {
  hasCalendarConnected,
  listMyCalendars,
  type CalendarFetchError,
  type CalendarListEntry,
} from "@/lib/integrations/google-calendar"
import { NextRequest, NextResponse } from "next/server"

/**
 * Per-user list of Google subcalendars + which ones the Hub should
 * actually pull events from. Powers the "Calendars" popover in the
 * calendar toolbar so AMs on shared accounts (contact@rocket-leads.nl)
 * can hide the noise from other team members' subcalendars without
 * touching the upstream Google Calendar settings.
 *
 * GET   → { connected, calendars: CalendarListEntry[], selectedIds: string[] | null, error }
 * PATCH → { selectedIds: string[] | null } — null = follow Google defaults,
 *         empty array = explicitly nothing, populated = allow-list.
 */

export const dynamic = "force-dynamic"

export type CalendarsResponse = {
  connected: boolean
  calendars: CalendarListEntry[]
  /** null = Hub uses Google's own `selected` flag as default. */
  selectedIds: string[] | null
  error: CalendarFetchError | null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const connected = await hasCalendarConnected(session.user.id)
  if (!connected) {
    const body: CalendarsResponse = {
      connected: false,
      calendars: [],
      selectedIds: null,
      error: null,
    }
    return NextResponse.json(body)
  }

  const supabase = await createAdminClient()
  const [calendarsRes, userRow] = await Promise.all([
    listMyCalendars(session.user.id),
    supabase
      .from("users")
      .select("google_calendar_ids")
      .eq("id", session.user.id)
      .maybeSingle<{ google_calendar_ids: string[] | null }>(),
  ])

  if (!calendarsRes.ok) {
    const body: CalendarsResponse = {
      connected: true,
      calendars: [],
      selectedIds: userRow.data?.google_calendar_ids ?? null,
      error: calendarsRes.error,
    }
    return NextResponse.json(body)
  }

  const body: CalendarsResponse = {
    connected: true,
    calendars: calendarsRes.data,
    selectedIds: userRow.data?.google_calendar_ids ?? null,
    error: null,
  }
  return NextResponse.json(body)
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Body shape:
  //   { selectedIds: string[] }  → explicit allow-list
  //   { selectedIds: null }      → reset to Google's own "selected" flag
  //   { selectedIds: [] }        → explicitly hide everything
  let body: { selectedIds: string[] | null }
  try {
    body = (await req.json()) as { selectedIds: string[] | null }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (
    body.selectedIds !== null &&
    (!Array.isArray(body.selectedIds) ||
      body.selectedIds.some((id) => typeof id !== "string"))
  ) {
    return NextResponse.json(
      { error: "selectedIds must be null or an array of calendar IDs" },
      { status: 400 },
    )
  }

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("users")
    .update({ google_calendar_ids: body.selectedIds })
    .eq("id", session.user.id)
  if (error) {
    console.error("[calendar/calendars] update failed:", error)
    return NextResponse.json({ error: "Failed to save selection" }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
