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
  /** ID of the source calendar this event lives on. */
  calendarId: string
  /** Display colour from the calendar's CalendarList entry (hex). */
  calendarColor: string
  /** Human label for the source calendar (used in tooltips). */
  calendarName: string
}

export type CalendarListEntry = {
  id: string
  summary: string
  /** Hex colour like "#7BD148" — pulled from Google's CalendarList. */
  backgroundColor: string
  foregroundColor: string
  /** Google's own "show on web" flag — useful default for new Hub users. */
  selectedByDefault: boolean
  /** True for the account owner's primary calendar. */
  primary: boolean
  /** "owner" | "writer" | "reader" | "freeBusyReader" — drives canEdit. */
  accessRole: string
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

function normaliseEvent(
  it: RawGoogleEvent,
  source: { id: string; name: string; color: string; accessRole: string },
): CalendarEvent {
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
  // Editable when the viewer organised the event OR has write access on
  // the source calendar. Read-only subcalendars (e.g. shared "Verjaardagen")
  // come through as accessRole=reader and shouldn't get edit affordances.
  const writable = source.accessRole === "owner" || source.accessRole === "writer"
  const canEdit = !!it.organizer?.self || !!it.creator?.self || writable

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
    calendarId: source.id,
    calendarColor: source.color,
    calendarName: source.name,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export type ListEventsResult = {
  events: CalendarEvent[]
  error: CalendarFetchError | null
}

// ─────────────────────────────────────────────────────────────────────
// CalendarList
// ─────────────────────────────────────────────────────────────────────

type RawCalendarListEntry = {
  id: string
  summary?: string
  summaryOverride?: string
  backgroundColor?: string
  foregroundColor?: string
  selected?: boolean
  primary?: boolean
  accessRole?: string
  deleted?: boolean
  hidden?: boolean
}

const FALLBACK_CALENDAR_COLOR = "#8967F3"

export async function listMyCalendars(
  userId: string,
): Promise<GoogleResult<CalendarListEntry[]>> {
  const result = await googleFetch<{ items?: RawCalendarListEntry[] }>(
    userId,
    "/users/me/calendarList",
    { searchParams: { minAccessRole: "freeBusyReader", maxResults: "250" } },
  )
  if (!result.ok) return result
  const items = (result.data.items ?? [])
    .filter((it) => !it.deleted && !it.hidden && it.id)
    .map<CalendarListEntry>((it) => ({
      id: it.id,
      summary: (it.summaryOverride ?? it.summary ?? it.id).trim(),
      backgroundColor: it.backgroundColor ?? FALLBACK_CALENDAR_COLOR,
      foregroundColor: it.foregroundColor ?? "#FFFFFF",
      selectedByDefault: !!it.selected,
      primary: !!it.primary,
      accessRole: it.accessRole ?? "reader",
    }))
    // Stable ordering: primary first, then by name. Matches what users
    // see in Google's own sidebar so the Hub picker doesn't surprise.
    .sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1
      return a.summary.localeCompare(b.summary)
    })
  return { ok: true, data: items }
}

/**
 * Resolves which calendar IDs to read events from. Priority order:
 *
 *   1. Explicit `calendarIds` argument (from API caller).
 *   2. Stored `google_calendar_ids` on the user row (Hub picker state).
 *   3. Google's `selected` flag on each CalendarList entry (matches what
 *      the user sees on calendar.google.com out of the box).
 *
 * Returns the full CalendarList metadata too so the events fetcher can
 * stamp each event with the right colour/name without an extra round trip.
 */
async function resolveSelectedCalendars(
  userId: string,
  calendarIds?: string[],
): Promise<GoogleResult<CalendarListEntry[]>> {
  const allRes = await listMyCalendars(userId)
  if (!allRes.ok) return allRes
  const all = allRes.data

  // 1. Explicit override from caller.
  if (calendarIds && calendarIds.length > 0) {
    const allow = new Set(calendarIds)
    return { ok: true, data: all.filter((c) => allow.has(c.id)) }
  }
  if (calendarIds && calendarIds.length === 0) {
    return { ok: true, data: [] }
  }

  // 2. Saved Hub selection.
  const supabase = await createAdminClient()
  const { data: row } = await supabase
    .from("users")
    .select("google_calendar_ids")
    .eq("id", userId)
    .maybeSingle<{ google_calendar_ids: string[] | null }>()
  const saved = row?.google_calendar_ids
  if (Array.isArray(saved)) {
    if (saved.length === 0) return { ok: true, data: [] }
    const allow = new Set(saved)
    return { ok: true, data: all.filter((c) => allow.has(c.id)) }
  }

  // 3. Google's own selected flag — primary always counts so a brand-new
  //    user still sees their own events even if Google didn't mark it.
  const defaults = all.filter((c) => c.selectedByDefault || c.primary)
  return { ok: true, data: defaults.length > 0 ? defaults : all }
}

export async function listCalendarEvents(
  userId: string,
  opts: { timeMin: Date; timeMax: Date; calendarIds?: string[] },
): Promise<ListEventsResult> {
  const resolved = await resolveSelectedCalendars(userId, opts.calendarIds)
  if (!resolved.ok) return { events: [], error: resolved.error }
  const sources = resolved.data
  if (sources.length === 0) return { events: [], error: null }

  // Fan out — Google Calendar has no "events across calendars" endpoint,
  // so we hit each source in parallel and merge. With 10-15 subcalendars
  // this is still well under a second.
  const results = await Promise.all(
    sources.map(async (cal) => {
      const result = await googleFetch<{ items?: RawGoogleEvent[] }>(
        userId,
        `/calendars/${encodeURIComponent(cal.id)}/events`,
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
      return { cal, result }
    }),
  )

  const events: CalendarEvent[] = []
  // First non-OK error wins for surfacing in the UI banner. Per-calendar
  // failures (one shared calendar revoked, others fine) shouldn't blank
  // the whole grid — we keep the partial successes.
  let firstError: CalendarFetchError | null = null
  for (const { cal, result } of results) {
    if (!result.ok) {
      if (!firstError) firstError = result.error
      continue
    }
    for (const raw of result.data.items ?? []) {
      if (raw.status === "cancelled") continue
      const ev = normaliseEvent(raw, {
        id: cal.id,
        name: cal.summary,
        color: cal.backgroundColor,
        accessRole: cal.accessRole,
      })
      if (ev.start && ev.end) events.push(ev)
    }
  }
  // Keep the merged stream sorted — Google sorted each subcalendar but
  // not across them.
  events.sort((a, b) => a.start.localeCompare(b.start))
  return { events, error: firstError }
}

export async function getEvent(
  userId: string,
  eventId: string,
  calendarId: string = "primary",
): Promise<GoogleResult<CalendarEvent>> {
  // Resolve the source calendar's metadata so the returned event carries
  // its colour/name. For the primary calendar shortcut we skip the lookup
  // and stamp brand purple — the dialog doesn't need the real swatch when
  // it's the user's own calendar.
  let source = {
    id: calendarId,
    name: "Primary",
    color: FALLBACK_CALENDAR_COLOR,
    accessRole: "owner",
  }
  if (calendarId !== "primary") {
    const all = await listMyCalendars(userId)
    if (all.ok) {
      const match = all.data.find((c) => c.id === calendarId)
      if (match) {
        source = {
          id: match.id,
          name: match.summary,
          color: match.backgroundColor,
          accessRole: match.accessRole,
        }
      }
    }
  }
  const result = await googleFetch<RawGoogleEvent>(
    userId,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  )
  if (!result.ok) return result
  return { ok: true, data: normaliseEvent(result.data, source) }
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
  return {
    ok: true,
    data: normaliseEvent(result.data, {
      id: "primary",
      name: "Primary",
      color: FALLBACK_CALENDAR_COLOR,
      accessRole: "owner",
    }),
  }
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
  return {
    ok: true,
    data: normaliseEvent(result.data, {
      id: "primary",
      name: "Primary",
      color: FALLBACK_CALENDAR_COLOR,
      accessRole: "owner",
    }),
  }
}
