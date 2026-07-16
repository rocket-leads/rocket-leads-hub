import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import { fetchMessages } from "@/lib/integrations/trengo"
import { getTrengoMentionContext } from "@/lib/inbox/trengo-mentions"

/**
 * Keep the Hub's Mentioned view 1:1 with Trengo's mention To-do/Done state.
 *
 * Trengo marks a mention `seen` once the tagged user has viewed it in Trengo.
 * The Hub's per-user mention rows (kind='update', source_ref carries the thread
 * key; source_msg_id = `trengo:mention:<noteMsgId>:<hubId>`) must reflect that:
 * seen → status 'read' (Done), unseen → 'unread' (To-do). Otherwise the Hub
 * shows a pile of mentions the user already handled in Trengo (Roy 2026-07-16:
 * "ik zie 8 terwijl er in trengo maar 1 staat").
 *
 * Only un-done (unread) Hub mentions are polled - as they sync to Done they
 * drop out, so steady-state work is just the genuinely-open mentions. We read
 * the seen state from the note message's structured `mentions` array via the
 * system token; no per-user token needed. Direction is Trengo → Hub (Trengo is
 * the source of truth); Trengo has no public mark-seen API for the reverse.
 */

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tracker = startCronRun("sync-trengo-mention-seen")
  const startedAt = Date.now()

  // `?since=<days>` widens the window for a manual catch-up run (default 60d).
  const sinceDaysParam = req.nextUrl.searchParams.get("since")
  const sinceDays = sinceDaysParam && Number.isFinite(Number(sinceDaysParam))
    ? Math.min(Math.max(Number(sinceDaysParam), 1), 180)
    : 60
  const sinceIso = new Date(startedAt - sinceDays * 24 * 60 * 60 * 1000).toISOString()

  try {
    const supabase = await createAdminClient()
    const ctx = await getTrengoMentionContext(supabase)

    // Un-done Hub mentions in the window.
    const { data: rows } = await supabase
      .from("inbox_events")
      .select("id, source_msg_id, assignee_id, source_thread")
      .eq("kind", "update")
      .eq("source", "trengo")
      .eq("status", "unread")
      .not("source_ref->>trengo_mention_in_thread_key", "is", null)
      .gte("created_at", sinceIso)
      .limit(2000)
    const mentions = (rows ?? []) as Array<{
      id: string
      source_msg_id: string | null
      assignee_id: string
      source_thread: string | null
    }>

    // Resolve each mention's note message id, then the note row's ticket. The
    // mention update itself doesn't carry the ticket, so map via the note row.
    const noteMsgIds = Array.from(
      new Set(
        mentions
          .map((m) => m.source_msg_id?.match(/^trengo:mention:(\d+):/)?.[1])
          .filter((x): x is string => !!x),
      ),
    )
    const ticketByNote = new Map<string, number>()
    for (let i = 0; i < noteMsgIds.length; i += 100) {
      const chunk = noteMsgIds.slice(i, i + 100).map((n) => `trengo:msg:${n}`)
      const { data: noteRows } = await supabase
        .from("inbox_events")
        .select("source_msg_id, source_thread")
        .in("source_msg_id", chunk)
      for (const r of (noteRows ?? []) as Array<{ source_msg_id: string; source_thread: string | null }>) {
        const nid = r.source_msg_id.replace(/^trengo:msg:/, "")
        const tid = r.source_thread?.replace(/^trengo:ticket:/, "")
        if (tid) ticketByNote.set(nid, Number(tid))
      }
    }

    // Fetch each ticket's messages once; build noteMsgId → (trengoUserId → seen).
    const seenByNote = new Map<string, Map<number, number>>()
    const ticketCache = new Set<number>()
    let ticketsFetched = 0
    for (const nid of noteMsgIds) {
      const tid = ticketByNote.get(nid)
      if (tid == null || ticketCache.has(tid)) continue
      ticketCache.add(tid)
      try {
        const msgs = await fetchMessages(tid)
        ticketsFetched++
        for (const m of msgs) {
          const seen = new Map<number, number>()
          for (const mm of m.mentions ?? []) seen.set(mm.user_id, mm.seen ?? 0)
          if (seen.size > 0) seenByNote.set(String(m.id), seen)
        }
      } catch {
        // Skip unreadable ticket; its mentions stay as-is this cycle.
      }
    }

    let markedDone = 0
    for (const m of mentions) {
      const nid = m.source_msg_id?.match(/^trengo:mention:(\d+):/)?.[1]
      if (!nid) continue
      const trengoId = ctx.trengoIdByHubId.get(m.assignee_id)
      if (trengoId == null) continue
      const seen = seenByNote.get(nid)?.get(trengoId)
      if (seen === 1) {
        const { error } = await supabase
          .from("inbox_events")
          .update({ status: "read" })
          .eq("id", m.id)
        if (!error) markedDone++
      }
    }

    const metrics = {
      mentionsChecked: mentions.length,
      ticketsFetched,
      markedDone,
      sinceDays,
      durationMs: Date.now() - startedAt,
    }
    await tracker.ok(metrics)
    return NextResponse.json({ ok: true, ...metrics })
  } catch (e) {
    await tracker.fail(e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "sync-trengo-mention-seen failed" },
      { status: 500 },
    )
  }
}
