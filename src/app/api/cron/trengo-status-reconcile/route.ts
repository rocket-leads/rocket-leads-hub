import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import { fetchTrengoTickets, fetchUserTickets } from "@/lib/integrations/trengo"
import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"

/**
 * Mirror Trengo ticket CLOSES back into the Hub.
 *
 * Neither the INBOUND webhook nor the message poll fire on a status-only change,
 * so a ticket closed in Trengo (by a teammate, an automation, or Trengo AI) kept
 * showing as open in the Hub — the "single source of truth" divergence Roy hit
 * (2026-07-17). This cron walks recently-CLOSED Trengo tickets and archives the
 * matching Hub thread if it's still open.
 *
 * Direction is deliberately CLOSE-ONLY (Trengo→Hub). We never un-archive here:
 *  - A Trengo *reopen* self-heals — a new inbound message clears archived_at on
 *    the freshest row, so the thread returns to the inbox naturally.
 *  - Only propagating closes means we never revert a Hub-side close whose
 *    Hub→Trengo sync momentarily failed (that just re-attempts on next Hub action).
 *
 * Runs hourly; bounded by a page cap + a "stop once we're past the recent
 * window" guard so it never scans all historical closed tickets.
 */

export const dynamic = "force-dynamic"
export const maxDuration = 120

/** Only reconcile tickets closed within this window (Trengo lists newest-first,
 *  so we stop paging once we're past it). `?sinceHours=` widens it for a manual
 *  catch-up run. */
const DEFAULT_WINDOW_HOURS = 48
const MAX_PAGES = 12

function parseTrengoTs(s: string | null | undefined): number | null {
  if (!s) return null
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z"
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : null
}

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tracker = startCronRun("trengo-status-reconcile")
  const startedAt = Date.now()
  const sinceHoursParam = req.nextUrl.searchParams.get("sinceHours")
  const windowHours =
    sinceHoursParam && Number.isFinite(Number(sinceHoursParam))
      ? Math.min(Math.max(Number(sinceHoursParam), 1), 24 * 30)
      : DEFAULT_WINDOW_HOURS
  const cutoffMs = startedAt - windowHours * 60 * 60 * 1000

  try {
    const supabase = await createAdminClient()

    // 1. Collect recently-closed Trengo ticket ids (newest-first; stop once a
    //    whole page is older than the window). Helper so both the workspace-token
    //    pass and the per-user pass share the paging + recency logic.
    const closedIdSet = new Set<number>()
    let ticketsScanned = 0
    let usersScanned = 0
    async function collectClosed(
      fetchPage: (page: number) => Promise<Array<{ id: number; closed_at: string | null; latest_message_at: string | null }>>,
    ) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        let tickets: Array<{ id: number; closed_at: string | null; latest_message_at: string | null }>
        try {
          tickets = await fetchPage(page)
        } catch {
          break
        }
        if (tickets.length === 0) break
        ticketsScanned += tickets.length
        let anyRecent = false
        for (const t of tickets) {
          const closedMs = parseTrengoTs(t.closed_at) ?? parseTrengoTs(t.latest_message_at)
          // No timestamp → include (safer to check than skip); recent → include.
          if (closedMs == null || closedMs >= cutoffMs) {
            closedIdSet.add(t.id)
            anyRecent = true
          }
        }
        if (!anyRecent) break
        await new Promise((r) => setTimeout(r, 120))
      }
    }

    // 1a. Workspace token → shared channels.
    await collectClosed((page) => fetchTrengoTickets(`status=CLOSED&page=${page}`))

    // 1b. Per-user token → PRIVATE inboxes ("Roy Personal" etc.), which the
    //     workspace token can't see. This is why closes there weren't syncing to
    //     the Hub, inflating the open count. Roy 2026-07-22. Only users with a
    //     connected personal Trengo token.
    const { data: userRows } = await supabase
      .from("users")
      .select("id")
      .not("trengo_channel_ids", "is", null)
    for (const u of (userRows ?? []) as Array<{ id: string }>) {
      const token = await getUserPlatformToken(u.id, "trengo")
      if (!token) continue
      usersScanned += 1
      await collectClosed((page) => fetchUserTickets(token, `status=CLOSED&page=${page}`))
    }

    const closedIds = Array.from(closedIdSet)

    // 2. Of those, find the ones the Hub still shows as OPEN (archived_at null).
    let archivedThreads = 0
    let archivedRows = 0
    const openTicketRefs = new Set<string>()
    for (let i = 0; i < closedIds.length; i += 100) {
      const chunk = closedIds.slice(i, i + 100).map((id) => `trengo:ticket:${id}`)
      const { data } = await supabase
        .from("inbox_events")
        .select("source_thread")
        .eq("source", "trengo")
        .is("archived_at", null)
        .in("source_thread", chunk)
      for (const r of (data ?? []) as Array<{ source_thread: string | null }>) {
        if (r.source_thread) openTicketRefs.add(r.source_thread)
      }
    }

    // 3. Archive each still-open Hub thread whose Trengo ticket is closed.
    const nowIso = new Date().toISOString()
    for (const ref of openTicketRefs) {
      const { data, error } = await supabase
        .from("inbox_events")
        .update({ archived_at: nowIso })
        .eq("source", "trengo")
        .eq("source_thread", ref)
        .is("archived_at", null)
        .select("id")
      if (!error && data) {
        archivedThreads += 1
        archivedRows += data.length
      }
    }

    const metrics = {
      windowHours,
      ticketsScanned,
      usersScanned,
      closedTickets: closedIds.length,
      archivedThreads,
      archivedRows,
      durationMs: Date.now() - startedAt,
    }
    await tracker.ok(metrics)
    return NextResponse.json({ ok: true, ...metrics })
  } catch (e) {
    await tracker.fail(e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "trengo-status-reconcile failed" },
      { status: 500 },
    )
  }
}
