import { auth } from "@/lib/auth"
import {
  deleteEvent,
  getEvent,
  updateEvent,
  type EventPatch,
} from "@/lib/integrations/google-calendar"
import { NextRequest, NextResponse } from "next/server"

/**
 * Per-event CRUD on the signed-in user's primary Google Calendar.
 *
 * GET    /api/calendar/events/[id] — full detail for the dialog
 * PATCH  /api/calendar/events/[id] — partial update (title, time, attendees…)
 * DELETE /api/calendar/events/[id] — remove and notify attendees
 *
 * Errors from Google bubble through with their original status so the
 * UI can show a useful banner (e.g. 403 with "insufficient permission"
 * means the user needs to re-consent to the new scope).
 */

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  // ?calendarId lets the dialog open events that live on subcalendars
  // (e.g. "Roel" on the contact@rocket-leads.nl account). Falls back to
  // primary for the existing single-calendar flow.
  const calendarId =
    req.nextUrl.searchParams.get("calendarId") || "primary"
  const result = await getEvent(session.user.id, id, calendarId)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error.status || 500 },
    )
  }
  return NextResponse.json({ event: result.data })
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  const patch = (await req.json()) as EventPatch
  const result = await updateEvent(session.user.id, id, patch)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error.status || 500 },
    )
  }
  return NextResponse.json({ event: result.data })
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  const result = await deleteEvent(session.user.id, id)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error.status || 500 },
    )
  }
  return NextResponse.json({ ok: true })
}
