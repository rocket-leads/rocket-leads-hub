import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchRecentFathomMeetings, ROCKET_LEADS_TEAMS, type FathomMeeting } from "@/lib/integrations/fathom"
import { ingestFathomMeeting } from "@/lib/meetings/ingest"
import { runMatcherBatch } from "@/lib/meetings/matcher"

export const maxDuration = 300

/**
 * POST /api/admin/fathom-backfill?hours=2160
 *
 * Two-step admin operation, kept behind one button:
 *   1. Pull recent meetings from Fathom (default last 90d = 2160h)
 *      and run them through `ingestFathomMeeting()`. Skipped/dedupe
 *      paths are normal - we just want the full set in `meetings`.
 *   2. Run the matcher batch across every still-unlinked + archived
 *      row so anything we just inserted gets a shot at auto-linking.
 *
 * Designed to be re-runnable: every step is idempotent. Use this after
 * onboarding a new client to surface their previous sales / kick-off
 * calls, or after a long gap where the live webhook may have missed
 * deliveries.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const url = new URL(req.url)
  const hoursParam = parseInt(url.searchParams.get("hours") ?? "2160", 10)
  // Cap at 1 year to keep one accidental click from grinding through
  // tens of thousands of recordings.
  const hours = Number.isFinite(hoursParam) ? Math.min(Math.max(hoursParam, 1), 8760) : 2160

  const startedAt = new Date().toISOString()
  const createdAfter = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

  // ─── Step 1: pull from Fathom + ingest ─────────────────────────────────
  const supabase = await createAdminClient()
  let fetched = 0
  let inserted = 0
  let deduped = 0
  let skippedTeam = 0
  let errored = 0

  try {
    // Two passes against the Fathom API:
    //   1. team-tagged: meetings whose Fathom team contains a Rocket
    //      Leads team. The 99% path - most AMs tag their calls.
    //   2. user-fallback: meetings recorded by any Hub user, regardless
    //      of team tag. Catches AMs who forget to tag the recording -
    //      Roy 2026-06-11 explicitly asked for this since the team-only
    //      pull was missing personal Google Meet sessions from a couple
    //      of AMs.
    //
    // The pulls run in parallel, then we dedupe on `recording_id` so
    // we don't double-ingest a meeting that's BOTH team-tagged AND
    // recorded by a Hub user (the common case).
    const { data: userRows } = await supabase
      .from("users")
      .select("email")
      .not("email", "is", null)
    const hubEmails = (userRows ?? [])
      .map((r) => (r.email ?? "").toLowerCase().trim())
      .filter(Boolean)
    const allowedEmails = new Set<string>(hubEmails)

    const [teamMeetings, userMeetings] = await Promise.all([
      fetchRecentFathomMeetings({
        createdAfter,
        teams: [...ROCKET_LEADS_TEAMS],
        maxPages: 20,
      }),
      hubEmails.length > 0
        ? fetchRecentFathomMeetings({
            createdAfter,
            recordedByEmails: hubEmails,
            maxPages: 20,
          }).catch((e) => {
            console.error("[backfill] user-fallback fetch failed:", e instanceof Error ? e.message : e)
            return [] as FathomMeeting[]
          })
        : Promise.resolve([] as FathomMeeting[]),
    ])

    const seenRecordings = new Set<string>()
    const meetings: FathomMeeting[] = []
    for (const m of [...teamMeetings, ...userMeetings]) {
      const key = m.recording_id != null ? String(m.recording_id) : ""
      if (!key || seenRecordings.has(key)) continue
      seenRecordings.add(key)
      meetings.push(m)
    }

    fetched = meetings.length
    for (const m of meetings) {
      const r = await ingestFathomMeeting(supabase, m, { allowedEmails })
      if (!r.ok) {
        errored++
        continue
      }
      switch (r.status) {
        case "inserted":
          inserted++
          break
        case "deduped":
          deduped++
          break
        case "skipped_team":
          skippedTeam++
          break
      }
    }
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        step: "fetch_or_ingest",
        error: e instanceof Error ? e.message : "Fathom fetch/ingest failed",
        partial: { fetched, inserted, deduped, skippedTeam, errored },
      },
      { status: 500 },
    )
  }

  // ─── Step 2: re-run matcher across unlinked + archived ─────────────────
  let matchSummary
  try {
    const result = await runMatcherBatch(supabase)
    matchSummary = {
      scanned: result.scanned,
      linked: result.linked,
      suggested: result.suggested,
      unarchived_and_linked: result.unarchivedAndLinked,
      unmatched: result.unmatched,
    }
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        step: "match",
        error: e instanceof Error ? e.message : "Matcher failed",
        ingest: { fetched, inserted, deduped, skippedTeam, errored },
      },
      { status: 500 },
    )
  }

  const finishedAt = new Date().toISOString()

  return NextResponse.json({
    ok: true,
    started_at: startedAt,
    finished_at: finishedAt,
    window_hours: hours,
    created_after: createdAfter,
    ingest: {
      fetched,
      inserted,
      deduped,
      skipped_team: skippedTeam,
      errored,
    },
    match: matchSummary,
  })
}
