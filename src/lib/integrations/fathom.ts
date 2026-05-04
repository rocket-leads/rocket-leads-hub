import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

const BASE_URL = "https://api.fathom.ai/external/v1"

let cachedToken: { value: string; expiresAt: number } | null = null

export async function getFathomToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "fathom")
    .single()
  if (!data) throw new Error("Fathom token not configured. Go to Settings → API Tokens.")
  const token = decrypt(data.token_encrypted).trim()
  cachedToken = { value: token, expiresAt: Date.now() + 5 * 60 * 1000 }
  return token
}

export function clearFathomTokenCache() {
  cachedToken = null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fathomFetch<T>(path: string, retries = 3): Promise<T> {
  const token = await getFathomToken()
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: { "X-Api-Key": token, Accept: "application/json" },
      next: { revalidate: 300 },
    })

    if (res.status === 429 && attempt < retries) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "", 10)
      const delay = retryAfter ? retryAfter * 1000 : 2000 * 2 ** attempt
      await sleep(delay)
      continue
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Fathom API error ${res.status}: ${text.slice(0, 200) || res.statusText}`)
    }
    return res.json() as Promise<T>
  }

  throw new Error("Fathom API rate limit exceeded after retries")
}

// ─── Public types ───────────────────────────────────────────────────────────

export type FathomTeamMember = {
  name: string
  email: string
  created_at: string
}

export type FathomTeam = {
  name: string
  created_at: string
}

type Paged<T> = {
  limit: number | null
  next_cursor: string | null
  items: T[]
}

export type FathomInvitee = {
  name: string | null
  matched_speaker_display_name?: string | null
  email: string | null
  email_domain: string | null
  is_external: boolean
}

export type FathomActionItem = {
  description: string
  user_generated: boolean
  completed: boolean
  recording_timestamp: string
  recording_playback_url: string
  assignee: {
    name: string | null
    email: string | null
    team: string | null
  }
}

export type FathomTranscriptItem = {
  speaker: {
    display_name: string
    matched_calendar_invitee_email?: string | null
  }
  text: string
  timestamp: string
}

export type FathomRecorder = {
  name: string
  email: string
  email_domain: string
  team: string | null
}

/**
 * Shape of both the `/meetings` list response items AND the webhook payload.
 * Fathom uses the same `Meeting` schema in both places, so our typing handles
 * both paths through one definition.
 */
export type FathomMeeting = {
  title: string
  meeting_title: string | null
  recording_id: number
  url: string
  share_url: string
  created_at: string
  scheduled_start_time: string
  scheduled_end_time: string
  recording_start_time: string
  recording_end_time: string
  calendar_invitees_domains_type: "only_internal" | "one_or_more_external"
  transcript_language: string
  transcript?: FathomTranscriptItem[] | null
  default_summary?: { template_name: string | null; markdown_formatted: string | null } | null
  action_items?: FathomActionItem[] | null
  calendar_invitees: FathomInvitee[]
  recorded_by: FathomRecorder
}

// ─── API calls ──────────────────────────────────────────────────────────────

export async function fetchFathomTeamMembers(team?: string): Promise<FathomTeamMember[]> {
  const all: FathomTeamMember[] = []
  let cursor: string | null = null
  let pageCount = 0
  do {
    const params = new URLSearchParams()
    if (cursor) params.set("cursor", cursor)
    if (team) params.set("team", team)
    const qs = params.toString()
    const page: Paged<FathomTeamMember> = await fathomFetch(`/team_members${qs ? `?${qs}` : ""}`)
    all.push(...page.items)
    cursor = page.next_cursor
    pageCount++
  } while (cursor && pageCount < 20)
  return all
}

export async function fetchFathomTeams(): Promise<FathomTeam[]> {
  const all: FathomTeam[] = []
  let cursor: string | null = null
  let pageCount = 0
  do {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
    const page: Paged<FathomTeam> = await fathomFetch(`/teams${qs}`)
    all.push(...page.items)
    cursor = page.next_cursor
    pageCount++
  } while (cursor && pageCount < 20)
  return all
}

/**
 * Fetch recent meetings via the `/meetings` endpoint with all enrichment
 * flags on (transcript + summary + action items + CRM matches). Cursor-paginates
 * up to a hard cap so we can never accidentally drain a huge history.
 *
 * Used by the admin fetch diagnostic and (later) the C.5.e backfill cron.
 */
export async function fetchRecentFathomMeetings(opts: {
  createdAfter?: string             // ISO string; defaults to 24h ago
  recordedByEmails?: string[]
  teams?: string[]
  maxPages?: number                 // safety cap; default 5 (= up to ~500 meetings depending on page size)
} = {}): Promise<FathomMeeting[]> {
  const createdAfter = opts.createdAfter ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const maxPages = opts.maxPages ?? 5

  const all: FathomMeeting[] = []
  let cursor: string | null = null
  let page = 0
  do {
    const params = new URLSearchParams()
    params.set("include_transcript", "true")
    params.set("include_summary", "true")
    params.set("include_action_items", "true")
    params.set("include_crm_matches", "true")
    params.set("created_after", createdAfter)
    if (cursor) params.set("cursor", cursor)
    for (const email of opts.recordedByEmails ?? []) params.append("recorded_by[]", email)
    for (const team of opts.teams ?? []) params.append("teams[]", team)

    const data: Paged<FathomMeeting> = await fathomFetch(`/meetings?${params.toString()}`)
    all.push(...data.items)
    cursor = data.next_cursor
    page++
  } while (cursor && page < maxPages)
  return all
}

/**
 * Lightweight ping — fetches one team member (or zero) just to confirm
 * the API key is valid. Used by Settings → Test connection.
 */
export async function pingFathom(): Promise<{ ok: true; teamMembers: number } | { ok: false; message: string }> {
  try {
    const page: Paged<FathomTeamMember> = await fathomFetch(`/team_members`)
    return { ok: true, teamMembers: page.items.length }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unknown error" }
  }
}

// ─── Webhook signature verification ─────────────────────────────────────────

/**
 * Verify a Fathom webhook signature (Svix-style HMAC-SHA256).
 *
 * Spec: https://developers.fathom.ai/webhooks#verifying-webhooks
 *   - Build signed content: `${webhook-id}.${webhook-timestamp}.${rawBody}`
 *   - Base64-decode the part of the secret after the `whsec_` prefix
 *   - HMAC-SHA256, then Base64 encode — compare against any of the v1 sigs
 *   - Reject if timestamp is older than 5 minutes (replay protection)
 *
 * IMPORTANT: `rawBody` must be the raw request body as a string, BEFORE any
 * JSON parsing. In a Next.js route, use `await req.text()`, not `req.json()`.
 */
export function verifyFathomWebhook(
  secret: string,
  headers: { "webhook-id": string; "webhook-timestamp": string; "webhook-signature": string },
  rawBody: string,
): boolean {
  const { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": sigHeader } = headers
  if (!id || !ts || !sigHeader) return false

  // Replay protection: reject anything more than 5 minutes off.
  const tsNum = parseInt(ts, 10)
  if (!Number.isFinite(tsNum)) return false
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - tsNum) > 300) return false

  // Strip whsec_ prefix and Base64-decode the secret bytes.
  const secretPart = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret
  let secretBytes: Buffer
  try {
    secretBytes = Buffer.from(secretPart, "base64")
  } catch {
    return false
  }

  const signedContent = `${id}.${ts}.${rawBody}`
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64")
  const expectedBuf = Buffer.from(expected)

  // Header looks like "v1,sig1 v2,sig2 ..." — strip the version prefix from each.
  const candidates = sigHeader
    .split(" ")
    .map((s) => s.split(",").pop() ?? s)
    .filter(Boolean)

  return candidates.some((sig) => {
    const candidateBuf = Buffer.from(sig)
    if (candidateBuf.length !== expectedBuf.length) return false
    try {
      return crypto.timingSafeEqual(expectedBuf, candidateBuf)
    } catch {
      return false
    }
  })
}

// ─── Team filtering ─────────────────────────────────────────────────────────

/**
 * Roy's Fathom account spans multiple teams (Rocket Leads delivery, Rocket
 * Leads sales, Founder Download, etc.). Only Rocket Leads recordings belong
 * in the Hub — anything else gets skipped at ingest time. Match is a
 * case-insensitive substring on "rocket leads" so renames like "Sales Rocket
 * Leads NL" still pass.
 */
export function isRocketLeadsTeam(team: string | null | undefined): boolean {
  if (!team) return false
  return team.toLowerCase().includes("rocket leads")
}

/**
 * Exact Fathom team names to pass to the API's `teams[]=` filter. Cuts the
 * backfill from "fetch every recording in the workspace, drop 99%" down to
 * "ask Fathom only for our teams" — typically dozens of recordings instead
 * of hundreds, which keeps us well under the pagination cap.
 *
 * The API filter is exact-match, so add new exact team names here when Roy
 * spins up another Rocket Leads team. The substring `isRocketLeadsTeam`
 * stays as a defensive check on the data side.
 */
export const ROCKET_LEADS_TEAMS = ["Sales Rocket Leads", "Delivery Rocket Leads"] as const

// ─── Meeting type classification ────────────────────────────────────────────

export type MeetingType = "sales" | "kick_off" | "evaluation" | "internal" | "other"

/**
 * Classify a Fathom meeting into one of our internal types. Driven by:
 *   1. calendar_invitees_domains_type === 'only_internal'  → internal
 *   2. recorded_by.team contains 'sales'                   → sales
 *   3. Title pattern (Delivery team or unknown)            → kick_off / evaluation / other
 *
 * Roy's Fathom teams: "Sales Rocketleads" and "Delivery Rocketleads". Match
 * the substring "sales" so we don't break if the team is renamed slightly.
 */
export function classifyMeetingType(payload: FathomMeeting): MeetingType {
  if (payload.calendar_invitees_domains_type === "only_internal") return "internal"

  const team = (payload.recorded_by?.team ?? "").toLowerCase()
  if (team.includes("sales")) return "sales"

  const title = `${payload.title ?? ""} ${payload.meeting_title ?? ""}`.toLowerCase()
  if (/\b(kick[- ]?off|kickoff|onboarding|start[- ]gesprek)\b/.test(title)) return "kick_off"
  if (/\b(evaluation|evaluatie|evaluatiecall|review|monthly|maandelijks|update[- ]call|check[- ]?in)\b/.test(title)) {
    return "evaluation"
  }

  return "other"
}

/**
 * Render the structured transcript array as a readable text blob — speaker +
 * timestamp prefix per line. Stored on `meetings.transcript` so we can full-text
 * search and feed it to AI prompts later without re-parsing the JSON each time.
 */
export function renderTranscript(items: FathomTranscriptItem[] | null | undefined): string | null {
  if (!items || items.length === 0) return null
  return items.map((t) => `[${t.timestamp}] ${t.speaker.display_name}: ${t.text}`).join("\n")
}
