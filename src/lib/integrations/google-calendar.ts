import { decrypt, encrypt } from "@/lib/encryption"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Google Calendar v3 client scoped to the connected user's primary
 * calendar. Read-only — we only ever surface events in the Hub Calendar
 * page, never write back. Tokens are persisted to the `users` row during
 * sign-in (`src/lib/auth.ts`) and refreshed lazily here when the
 * access_token has expired.
 *
 * Why no separate API key: the integration uses each signed-in user's
 * personal OAuth credentials. There is no shared service account, so
 * the events shown always belong to the viewer. AM/CM see their own
 * agenda, no cross-user reads possible.
 */

const TOKEN_REFRESH_SKEW_MS = 60_000

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

  // Token still valid → return decrypted access_token directly.
  if (Date.now() < expiresAt - TOKEN_REFRESH_SKEW_MS) {
    return decrypt(data.google_access_token)
  }

  // Need to refresh. Without a refresh_token we can't continue — the user
  // must re-sign-in (which re-prompts consent and stores a fresh one).
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
  // Google rarely rotates the refresh_token, but persist it if it does.
  if (json.refresh_token) {
    update.google_refresh_token = encrypt(json.refresh_token)
  }
  await supabase.from("users").update(update).eq("id", userId)

  return json.access_token
}

/**
 * Returns true when the user has connected Google Calendar (has both an
 * access token and a refresh token persisted). Cheap — single SELECT.
 */
export async function hasCalendarConnected(userId: string): Promise<boolean> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("users")
    .select("google_access_token, google_refresh_token")
    .eq("id", userId)
    .maybeSingle<Pick<StoredTokens, "google_access_token" | "google_refresh_token">>()
  return !!(data?.google_access_token && data?.google_refresh_token)
}

type RawGoogleEvent = {
  id: string
  summary?: string
  status?: string
  location?: string
  hangoutLink?: string
  htmlLink?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
}

export type CalendarFetchError = {
  /** HTTP status from Google, or 0 when we never even got that far. */
  status: number
  /** Short human-readable summary the UI shows verbatim. */
  message: string
  /** Hint for what to fix (enable API, re-consent, …). */
  hint?: string
}

export type ListEventsResult = {
  events: CalendarEvent[]
  error: CalendarFetchError | null
}

export async function listCalendarEvents(
  userId: string,
  opts: { timeMin: Date; timeMax: Date },
): Promise<ListEventsResult> {
  const token = await getValidAccessToken(userId)
  if (!token) {
    return {
      events: [],
      error: {
        status: 0,
        message: "No valid Google access token stored for this user.",
        hint: "Sign out and sign back in to grant Calendar access.",
      },
    }
  }

  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  )
  url.searchParams.set("timeMin", opts.timeMin.toISOString())
  url.searchParams.set("timeMax", opts.timeMax.toISOString())
  url.searchParams.set("singleEvents", "true")
  url.searchParams.set("orderBy", "startTime")
  url.searchParams.set("maxResults", "250")

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })

  if (!res.ok) {
    const rawText = await res.text()
    console.error("Google Calendar events fetch failed:", res.status, rawText)

    // Translate the most common failure modes into actionable hints —
    // saves a round-trip to DevTools when one of the standard config
    // gotchas bites.
    let hint: string | undefined
    const lower = rawText.toLowerCase()
    if (res.status === 403 && lower.includes("has not been used")) {
      hint = "Enable the Google Calendar API in the Google Cloud project that owns your OAuth client."
    } else if (res.status === 403 && lower.includes("insufficient")) {
      hint = "Calendar scope wasn't granted. Sign out, sign back in, and approve the calendar.readonly scope on the consent screen."
    } else if (res.status === 401) {
      hint = "Access token rejected. Sign out and sign back in to refresh the connection."
    }

    return {
      events: [],
      error: {
        status: res.status,
        message: extractErrorMessage(rawText) ?? `Google API returned ${res.status}`,
        hint,
      },
    }
  }

  const json = (await res.json()) as { items?: RawGoogleEvent[] }
  const events = (json.items ?? [])
    .filter((it) => it.status !== "cancelled")
    .map((it) => {
      const allDay = !!it.start?.date
      return {
        id: it.id,
        title: it.summary?.trim() || "(no title)",
        start: it.start?.dateTime ?? it.start?.date ?? "",
        end: it.end?.dateTime ?? it.end?.date ?? "",
        allDay,
        location: it.location ?? null,
        hangoutLink: it.hangoutLink ?? null,
        htmlLink: it.htmlLink ?? null,
      } satisfies CalendarEvent
    })
    .filter((e) => e.start && e.end)

  return { events, error: null }
}

function extractErrorMessage(rawText: string): string | null {
  try {
    const parsed = JSON.parse(rawText) as {
      error?: { message?: string; errors?: Array<{ message?: string }> }
    }
    return (
      parsed.error?.message ??
      parsed.error?.errors?.[0]?.message ??
      null
    )
  } catch {
    return null
  }
}
