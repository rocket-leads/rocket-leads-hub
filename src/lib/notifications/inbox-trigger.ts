import type { SupabaseClient } from "@supabase/supabase-js"
import { sendPushToUser } from "./push"

/**
 * One-call helper: given a freshly-inserted `inbox_events` row id, fan a push
 * notification out to the assignee.
 *
 * Used by every code path that inserts a task by writing to Supabase directly
 * (automation cron rules, Trengo webhook ingest, Monday webhook ingest, Fathom
 * action item bundles), so the assignee actually gets pinged on their device
 * instead of having to remember to refresh the inbox tab.
 *
 * Fire-and-forget - callers should `void` this rather than awaiting, since a
 * push delivery hiccup shouldn't block the parent ingest path. Errors are
 * logged but otherwise swallowed.
 *
 * Skips when:
 *   - the row isn't a task (updates use a different cadence)
 *   - the assignee equals the author (no point pinging yourself when you
 *     created your own task)
 *   - the assignee equals the HQ system user (a placeholder author when
 *     ingest can't resolve a real Hub user - pinging the shared mailbox
 *     would notify nobody useful)
 */
export async function sendInboxAssignmentPush(
  supabase: SupabaseClient,
  eventId: string,
): Promise<void> {
  try {
    const { data: row } = await supabase
      .from("inbox_events")
      .select("id, kind, status, title, assignee_id, author_id, source")
      .eq("id", eventId)
      .maybeSingle<{
        id: string
        kind: string
        status: string
        title: string
        assignee_id: string | null
        author_id: string | null
        source: string
      }>()

    if (!row) return
    if (row.kind !== "task") return
    // Already-completed tasks (auto-completion at insert time, e.g. Fathom
    // bundle where every action_item was already ticked) shouldn't trigger
    // a push - there's nothing to act on.
    if (row.status === "done" || row.status === "cancelled") return
    if (!row.assignee_id) return
    if (row.assignee_id === row.author_id) return

    // Skip pings to the HQ system user. The author_id on automation /
    // webhook rows is set to HQ as a placeholder; if for some reason the
    // assignee resolution also lands on HQ, we'd otherwise be pinging the
    // shared mailbox owner with every team task.
    const { data: hq } = await supabase
      .from("users")
      .select("id")
      .eq("email", "rocketleadshq@gmail.com")
      .maybeSingle<{ id: string }>()
    if (hq && row.assignee_id === hq.id) return

    const title = row.title.length > 120 ? row.title.slice(0, 117) + "…" : row.title
    const headline = headlineForSource(row.source)

    await sendPushToUser(row.assignee_id, {
      title: headline,
      body: title,
      url: "/inbox",
      tag: `inbox-task-${row.id}`,
    })
  } catch (e) {
    console.error("sendInboxAssignmentPush failed for", eventId, e)
  }
}

/** Headline tuned to where the task originated - gives the AM a single-line
 *  hint about the source before they even open the Hub. Short enough to fit
 *  on a phone lock screen banner. */
function headlineForSource(source: string): string {
  switch (source) {
    case "automation":
      return "Nieuwe automation-taak"
    case "trengo":
      return "Nieuwe klantvraag"
    case "monday":
      return "Nieuwe Monday-taak"
    case "slack":
      return "Nieuwe Slack-taak"
    case "meeting":
      return "Nieuwe taak uit meeting"
    case "watchlist":
      return "Watch list - actie nodig"
    default:
      return "Nieuwe taak op je naam"
  }
}
