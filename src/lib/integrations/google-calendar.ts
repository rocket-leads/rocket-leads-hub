import { decrypt, encrypt } from "@/lib/encryption"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Google Calendar v3 client scoped to the connected user's primary
 * calendar. Read + write — the Hub's in-app Event Dialog uses this
 * helper to create, edit, and delete events without ever bouncing the
 * user out to calendar.google.com.
 *
 * Tokens are persisted to the `users` row during sign-in
 * (`src/lib/auth.ts`) and refreshed lazily here when the access_token
 * has expired. Each call uses the viewer's personal OAuth credentials,
 * so events read/written always belong to the signed-in user — no
 * shared service account, no cross-user access possible.
 */

const TOKEN_REFRESH_SKEW_MS = 60_000
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"

export type CalendarEvent = {
  id: string
  title: string
  /** ISO string. For all-day events this is a YYYY-MM-DD date. */
  start: string
  end: string
  allDay: boolean
  location: string | null
  hangoutLink: string | null
  htmlLink: string | null
  description?: string | null
  attendees?: CalendarAttendee[]
  /** True when this is on a calendar the viewer can edit (owner/writer). */
  canEdit?: boolean
}

export type CalendarAttendee = {
  email: string
  displayName: string | null
  responseStatus: "needsAction" | "declined" | "tentative" | "accepted"
  organizer: boolean
  self: boolean
  optional: boolean
}

export type CalendarFetchError = {
  /** HTTP status from Google, or 0 when we never even got that far. */
  status: number
  /** Short human-readable summary the UI shows verbatim. */
  message: string
  /** Hint for what to fix (enable API, re-consent, …). */
  hint?: string
}

type StoredTokens = {
  google_access_token: string | null
  google_refresh_token: string | null
  google_token_expires_at: string | null
}

async function getValidAccessToken(userId: string): Promise<string | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("users")
    .select("google_access_token, google_refresh_token, google_token_expires_at")
    .eq("id", userId)
    .maybeSingle<StoredTokens>()

  if (!data?.google_access_token) return null

  const expiresAt = data.google_token_expires_at
    ? new Date(data.google_token_expires_at).getTime()
    : 0

  if (Date.now() < expiresAt - TOKEN_REFRESH_SKEW_MS) {
    return decrypt(data.google_access_token)
  }

  if (!data.google_refresh_token) return null

  const refreshToken = decrypt(data.google_refresh_token)
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    console.error("Google token refresh failed:", res.status, await res.text())
    return null
  }

  const json = (await res.json()) as {
    access_token: string
    expires_in: number
    refresh_token?: string
  }
  const newExpires = new Date(Date.now() + json.expires_in * 1000).toISOString()

  const update: Record<string, string> = {
    google_access_token: encrypt(json.access_token),
    google_token_expires_at: newExpires,
  }
  if (json.refresh_token) {
    update.google_refresh_token = encrypt(json.refresh_token)
  }
  await supabase.from("users").update(update).eq("id", userId)

  return json.access_token
}

export async function hasCalendarConnected(userId: string): Promise<boolean> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("users")
    .select("google_access_token, google_refresh_token")
    .eq("id", userId)
    .maybeSingle<Pick<StoredTokens, "google_access_token" | "google_refresh_token">>()
  return !!(data?.google_access_token && data?.google_refresh_token)
}

// ─────────────────────────────────────────────────────────────────────
// Shared fetch helper
// ─────────────────────────────────────────────────────────────────────

type GoogleResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CalendarFetchError }

async function googleFetch<T>(
  userId: string,
  path: string,
  init?: RequestInit & { searchParams?: Record<string, string> },
): Promise<GoogleResult<T>> {
  const token = await getValidAccessToken(userId)
  if (!token) {
    return {
      ok: false,
      error: {
        status: 0,
        message: "No valid Google access token stored for this user.",
        hint: "Sign out and sign back in to grant Calendar access.",
      },
    }
  }

  const url = new URL(CALENDAR_API_BASE + path)
  for (const [k, v] of Object.entries(init?.searchParams ?? {})) {
    url.searchParams.set(k, v)
  }

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  })

  if (!res.ok) {
    const rawText = await res.text()
    console.error("Google Calendar API error:", res.status, path, rawText)
    return { ok: false, error: mapGoogleError(res.status, rawText) }
  }

  // 204 No Content (delete) — no body to parse.
  if (res.status === 204) return { ok: true, data: undefined as T }

  const data = (await res.json()) as T
  return { ok: true, data }
}

function mapGoogleError(status: number, rawText: string): CalendarFetchError {
  let hint: string | undefined
  const lower = rawText.toLowerCase()
  if (status === 403 && lower.includes("has not been used")) {
    hint = "Enable the Google Calendar API in the Google Cloud project that owns your OAuth client."
  } else if (status === 403 && lower.includes("insufficient")) {
    hint = "Calendar scope wasn't granted. Sign out, sign back in, and approve the calendar scope on the consent screen."
  } else if (status === 401) {
    hint = "Access token rejected. Sign out and sign back in to refresh the connection."
  }
  return {
    status,
    message: extractErrorMessage(rawText) ?? `Google API returned ${status}`,
    hint,
  }
}

function extractErrorMessage(rawText: string): string | null {
  try {
    const parsed = JSON.parse(rawText) as {
      error?: { message?: string; errors?: Array<{ message?: string }> }
    }
    return parsed.error?.message ?? parsed.error?.errors?.[0]?.message ?? null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────
// Raw Google response shapes (subset of the fields we use)
// ─────────────────────────────────────────────────────────────────────

type RawGoogleEvent = {
  id: string
  summary?: string
  description?: string
  status?: string
  location?: string
  hangoutLink?: string
  htmlLink?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: Array<{
    email: string
    displayName?: string
    responseStatus?: string
    organizer?: boolean
    self?: boolean
    optional?: boolean
  }>
  organizer?: { email?: string; self?: boolean }
  creator?: { email?: string; self?: boolean }
}

function normaliseEvent(it: RawGoogleEvent): CalendarEvent {
  const allDay = !!it.start?.date
  const attendees: CalendarAttendee[] = (it.attendees ?? []).map((a) => ({
    email: a.email,
    displayName: a.displayName ?? null,
    responseStatus:
      (a.responseStatus as CalendarAttendee["responseStatus"]) ?? "needsAction",
    organizer: !!a.organizer,
    self: !!a.self,
    optional: !!a.optional,
  }))
  // The viewer can edit when they're the organizer, OR the calendar
  // belongs to them. For "primary" we always treat the viewer as the
  // owner — they can always edit their own calendar's events.
  const canEdit = !!it.organizer?.self || !!it.creator?.self || true

  return {
    id: it.id,
    title: it.summary?.trim() || "(no title)",
    start: it.start?.dateTime ?? it.start?.date ?? "",
    end: it.end?.dateTime ?? it.end?.date ?? "",
    allDay,
    location: it.location ?? null,
    hangoutLink: it.hangoutLink ?? null,
    htmlLink: it.htmlLink ?? null,
    description: it.description ?? null,
    attendees,
    canEdit,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export type ListEventsResult = {
  events: CalendarEvent[]
  error: CalendarFetchError | null
}

export async function listCalendarEvents(
  userId: string,
  opts: { timeMin: Date; timeMax: Date },
): Promise<ListEventsResult> {
  const result = await googleFetch<{ items?: RawGoogleEvent[] }>(
    userId,
    "/calendars/primary/events",
    {
      searchParams: {
        timeMin: opts.timeMin.toISOString(),
        timeMax: opts.timeMax.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      },
    },
  )
  if (!result.ok) return { events: [], error: result.error }

  const events = (result.data.items ?? [])
    .filter((it) => it.status !== "cancelled")
    .map(normaliseEvent)
    .filter((e) => e.start && e.end)
  return { events, error: null }
}

export async function getEvent(
  userId: string,
  eventId: string,
): Promise<GoogleResult<CalendarEvent>> {
  const result = await googleFetch<RawGoogleEvent>(
    userId,
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
  )
  if (!result.ok) return result
  return { ok: true, data: normaliseEvent(result.data) }
}

export type EventPatch = {
  title?: string
  description?: string | null
  location?: string | null
  /** ISO datetime, or YYYY-MM-DD for all-day. */
  start?: string
  end?: string
  allDay?: boolean
  /** Replace the attendee list. Omit to leave unchanged. */
  attendees?: Array<{ email: string; optional?: boolean }>
}

function eventPatchToGoogleBody(patch: EventPatch) {
  const body: Record<string, unknown> = {}
  if (patch.title !== undefined) body.summary = patch.title
  if (patch.description !== undefined) body.description = patch.description
  if (patch.location !== undefined) body.location = patch.location
  if (patch.start !== undefined) {
    body.start = patch.allDay
      ? { date: patch.start.slice(0, 10) }
      : { dateTime: patch.start }
  }
  if (patch.end !== undefined) {
    body.end = patch.allDay
      ? { date: patch.end.slice(0, 10) }
      : { dateTime: patch.end }
  }
  if (patch.attendees !== undefined) {
    body.attendees = patch.attendees.map((a) => ({
      email: a.email,
      ...(a.optional ? { optional: true } : {}),
    }))
  }
  return body
}

export async function updateEvent(
  userId: string,
  eventId: string,
  patch: EventPatch,
): Promise<GoogleResult<CalendarEvent>> {
  const body = eventPatchToGoogleBody(patch)
  const result = await googleFetch<RawGoogleEvent>(
    userId,
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
      // sendUpdates=all → notifies attendees of the change, mirroring
      // Google Calendar UI default. The Hub user shouldn't have to think
      // about whether attendees get the update — they should, always.
      searchParams: { sendUpdates: "all" },
    },
  )
  if (!result.ok) return result
  return { ok: true, data: normaliseEvent(result.data) }
}

export async function deleteEvent(
  userId: string,
  eventId: string,
): Promise<GoogleResult<void>> {
  return googleFetch<void>(
    userId,
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      searchParams: { sendUpdates: "all" },
    },
  )
}

export type EventCreate = {
  title: string
  description?: string | null
  location?: string | null
  start: string
  end: string
  allDay: boolean
  attendees?: Array<{ email: string; optional?: boolean }>
  /** When true, Google generates a Meet link and stores it on the event. */
  addMeetLink?: boolean
}

export async function createEvent(
  userId: string,
  input: EventCreate,
): Promise<GoogleResult<CalendarEvent>> {
  const body: Record<string, unknown> = {
    ...eventPatchToGoogleBody({
      title: input.title,
      description: input.description ?? undefined,
      location: input.location ?? undefined,
      start: input.start,
      end: input.end,
      allDay: input.allDay,
      attendees: input.attendees,
    }),
  }
  if (input.addMeetLink) {
    body.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    }
  }
  const result = await googleFetch<RawGoogleEvent>(
    userId,
    "/calendars/primary/events",
    {
      method: "POST",
      body: JSON.stringify(body),
      // conferenceDataVersion=1 is REQUIRED for Google to actually
      // provision the Meet link from the createRequest. Without it the
      // event is created but conferenceData is silently dropped.
      searchParams: {
        sendUpdates: "all",
        ...(input.addMeetLink ? { conferenceDataVersion: "1" } : {}),
      },
    },
  )
  if (!result.ok) return result
  return { ok: true, data: normaliseEvent(result.data) }
}
