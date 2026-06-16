/**
 * Hub → Trengo two-way sync helpers for thread triage state.
 *
 * The Hub stores triage state (archived_at, status, snoozed_until) on
 * inbox_events rows; Trengo stores it on tickets. The mirror is:
 *
 *   Hub archive   ↔  Trengo close
 *   Hub unarchive ↔  Trengo reopen
 *
 * Snooze and mark-unread are Hub-only concepts (Trengo has no native
 * equivalent), so they don't propagate. Mark-read isn't mirrored either
 * — Trengo's "read" is per-message, the Hub's is per-thread, and
 * forcing them to agree would either flood Trengo with per-message
 * reads or sit on stale state.
 *
 * Loop prevention: when this fires close-to-Trengo, Trengo will echo
 * a TICKET.CLOSED webhook back. The webhook handler treats already-
 * archived Hub rows as a no-op (sees `archived_at` is set, skips),
 * so the cycle terminates cleanly. Same for reopen.
 *
 * Errors are LOGGED, not raised — Hub-side state is authoritative and
 * users shouldn't see "your archive succeeded but Trengo didn't agree"
 * as a hard failure. The triage-state-diff cron (TODO) reconciles
 * any drift.
 */

import { createAdminClient } from "@/lib/supabase/server"
import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"
import { closeTrengoTicket, reopenTrengoTicket } from "@/lib/integrations/trengo"

/**
 * Mirror a Hub archive/unarchive into Trengo. Looks up every unique
 * Trengo ticket id under this thread (one Hub thread can group
 * multiple Trengo tickets per contact) and fires close/reopen for
 * each, using the acting user's personal Trengo token so the action
 * attributes correctly in Trengo's audit log.
 *
 * Best-effort: returns void. All errors get console.error'd so the
 * cron / dev tail can spot drift without leaking a hard failure to
 * the user.
 */
export async function syncThreadArchiveToTrengo(args: {
  threadKey: string
  userId: string
  archived: boolean
}): Promise<void> {
  const { threadKey, userId, archived } = args

  try {
    const supabase = await createAdminClient()
    // Pull every distinct trengo ticket id under this thread. We can't
    // assume the thread maps to a single ticket — Trengo splits new
    // emails into new tickets, so a Hub thread (`trengo:contact:<id>`)
    // can carry several `trengo:ticket:<id>` source_threads over time.
    const { data: rows, error } = await supabase
      .from("inbox_events")
      .select("source_thread")
      .eq("thread_key", threadKey)
      .eq("source", "trengo")
      .not("source_thread", "is", null)
    if (error) {
      console.error("[trengo-sync] failed to load source_threads:", error.message)
      return
    }

    const ticketIds = new Set<string>()
    for (const r of (rows ?? []) as Array<{ source_thread: string | null }>) {
      const id = (r.source_thread ?? "").replace(/^trengo:ticket:/, "")
      if (id && id !== r.source_thread) ticketIds.add(id)
    }
    if (ticketIds.size === 0) return

    const token = await getUserPlatformToken(userId, "trengo")
    if (!token) {
      console.warn(
        `[trengo-sync] user ${userId} has no Trengo token — skipping ${archived ? "close" : "reopen"} for ${ticketIds.size} ticket(s)`,
      )
      return
    }

    // Fire all close/reopen calls in parallel. Each call is independently
    // idempotent (Trengo 404 = already in target state, swallowed by the
    // helper), so partial failures don't need a transaction.
    const op = archived ? closeTrengoTicket : reopenTrengoTicket
    await Promise.all(
      [...ticketIds].map(async (ticketId) => {
        try {
          await op({ userToken: token, ticketId })
        } catch (e) {
          console.error(
            `[trengo-sync] ${archived ? "close" : "reopen"} ticket ${ticketId} failed:`,
            e instanceof Error ? e.message : String(e),
          )
        }
      }),
    )
  } catch (e) {
    console.error(
      "[trengo-sync] unexpected failure:",
      e instanceof Error ? e.message : String(e),
    )
  }
}
