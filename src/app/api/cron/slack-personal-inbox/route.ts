import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { sendSlackDm } from "@/lib/slack"
import { listInboxItems } from "@/lib/inbox/fetchers"
import {
  DEFAULT_TEMPLATES,
  getNotificationConfig,
  renderTemplate,
  shouldRunNow,
} from "@/lib/slack/notification-config"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"

export const maxDuration = 60

const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL ?? "https://hub.rocketleads.com"
const MAX_LINES_PER_SECTION = 5

/**
 * Morning Slack DM - "wat staat er voor jou klaar in de Hub vandaag".
 *
 * Fans out one DM per Hub user that has a Slack ID mapped. Each user gets
 * their own assigned-to-me view: overdue tasks, tasks due today, unread
 * updates, unread chat threads they have access to.
 *
 * Cadence: hourly cron + shouldRunNow guard against the configured hour
 * (default 08:00 Europe/Amsterdam). Same shape as slack-personal-sales.
 *
 * Failure isolation: per-user failures don't abort the run - they get
 * collected into the response payload so the watchdog can flag a partial
 * outcome instead of marking the whole cron as failed.
 */
export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const force = authz.forcedByAdmin || url.searchParams.get("force") === "1"

  const tracker = startCronRun("slack-personal-inbox")

  const config = await getNotificationConfig("personal_inbox")
  const guard = shouldRunNow(config, force)
  if (!guard.ok) {
    await tracker.ok({ skipped: guard.reason })
    return NextResponse.json({ ok: true, skipped: guard.reason })
  }

  const supabase = await createAdminClient()

  // All hub users with a Slack mapping; users without one are simply
  // skipped (they can't receive a DM and we don't want to surface that as
  // an error on every run).
  const { data: userRows, error: userErr } = await supabase
    .from("users")
    .select("id, name, email, role, slack_user_id")
    .not("slack_user_id", "is", null)
  if (userErr) {
    await tracker.fail(new Error(userErr.message))
    return NextResponse.json({ ok: false, error: userErr.message }, { status: 500 })
  }

  const template = config.template ?? DEFAULT_TEMPLATES.personal_inbox

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const tomorrowStart = new Date(todayStart)
  tomorrowStart.setDate(tomorrowStart.getDate() + 1)

  let dmsSent = 0
  let dmsSkipped = 0
  let dmsFailed = 0
  const errors: Array<{ user: string; error: string }> = []

  for (const u of userRows ?? []) {
    const slackId = u.slack_user_id as string | null
    if (!slackId) {
      dmsSkipped++
      continue
    }

    try {
      const [tasks, updates, threadsRes] = await Promise.all([
        listInboxItems(u.id, u.role ?? "user", {
          kind: "task",
          assignedToMe: true,
          statuses: ["open", "in_progress"],
          snoozed: "active",
        }),
        listInboxItems(u.id, u.role ?? "user", {
          kind: "update",
          assignedToMe: true,
          statuses: ["unread"],
        }),
        // Chat threads endpoint is the simplest path to "unread external
        // threads for this user". Plain HTTP would require an auth header
        // dance - we hit Supabase directly via the same helper the API uses.
        getUnreadExternalThreads(u.id, u.role ?? "user"),
      ])

      const overdue: typeof tasks = []
      const dueToday: typeof tasks = []
      for (const task of tasks) {
        if (!task.dueDate) continue
        const due = new Date(task.dueDate + "T00:00:00")
        if (due.getTime() < todayStart.getTime()) overdue.push(task)
        else if (due.getTime() < tomorrowStart.getTime()) dueToday.push(task)
      }

      const total =
        overdue.length + dueToday.length + updates.length + threadsRes.length
      if (total === 0) {
        // Inbox-zero days: skip the DM rather than spam an empty notification.
        // The summary still records the skip so we can see how many users
        // were quiet today.
        dmsSkipped++
        continue
      }

      const vars = buildVars({
        firstName: deriveFirstName(u.name, u.email),
        overdue,
        dueToday,
        updates,
        threads: threadsRes,
      })
      const message = renderTemplate(template, vars)
      await sendSlackDm(slackId, message)
      dmsSent++
    } catch (e) {
      dmsFailed++
      const userLabel = u.name ?? u.email ?? u.id
      const errMsg = e instanceof Error ? e.message : String(e)
      errors.push({ user: userLabel, error: errMsg })
      console.error(`[slack-personal-inbox] DM failed for ${userLabel}`, e)
    }
  }

  const summary = {
    usersConsidered: userRows?.length ?? 0,
    dmsSent,
    dmsSkipped,
    dmsFailed,
  }
  if (dmsFailed > 0) {
    await tracker.partial(`${dmsFailed} DMs failed`, summary)
  } else {
    await tracker.ok(summary)
  }
  return NextResponse.json({ ok: true, ...summary, errors: errors.slice(0, 10) })
}

// ─── helpers ─────────────────────────────────────────────────────────────

function deriveFirstName(name: string | null, email: string | null): string {
  if (name && name.trim()) {
    return name.trim().split(/\s+/)[0]
  }
  if (email) {
    const local = email.split("@")[0] ?? ""
    return local ? local[0].toUpperCase() + local.slice(1) : "team"
  }
  return "team"
}

/** Per-user unread external thread fetcher. Mirrors the access-control
 *  filter the /api/inbox/threads endpoint applies so each user only sees
 *  the threads they're allowed to read. */
async function getUnreadExternalThreads(userId: string, role: string) {
  const { listChatThreads } = await import("@/lib/inbox/fetchers")
  // The fetcher's Role type is internal to the module; safe to widen here -
  // listChatThreads handles unknown roles by falling back to the most
  // restrictive access path.
  const threads = await listChatThreads(userId, role as Parameters<typeof listChatThreads>[1], "external")
  return threads.filter((t) => t.unreadCount > 0)
}

type TaskOrUpdate = Awaited<ReturnType<typeof listInboxItems>>[number]
type ThreadSummary = Awaited<ReturnType<typeof getUnreadExternalThreads>>[number]

function buildVars({
  firstName,
  overdue,
  dueToday,
  updates,
  threads,
}: {
  firstName: string
  overdue: TaskOrUpdate[]
  dueToday: TaskOrUpdate[]
  updates: TaskOrUpdate[]
  threads: ThreadSummary[]
}): Record<string, string | number> {
  const summaryParts: string[] = []
  if (overdue.length) summaryParts.push(`${overdue.length} te laat`)
  if (dueToday.length) summaryParts.push(`${dueToday.length} vandaag`)
  if (updates.length) summaryParts.push(`${updates.length} nieuwe updates`)
  if (threads.length) summaryParts.push(`${threads.length} nieuwe chatberichten`)
  const summaryLine = summaryParts.length > 0 ? summaryParts.join(" · ") : "Niets urgents."

  return {
    first_name: firstName,
    summary_line: summaryLine,
    overdue_count: overdue.length,
    today_count: dueToday.length,
    updates_count: updates.length,
    chats_count: threads.length,
    overdue_section: renderTaskSection(":rotating_light: *Te laat*", overdue),
    today_section: renderTaskSection(":calendar: *Vandaag*", dueToday),
    updates_section: renderUpdateSection(":mailbox_with_mail: *Nieuwe updates*", updates),
    chats_section: renderChatSection(":speech_balloon: *Nieuwe berichten*", threads),
    empty_section:
      overdue.length + dueToday.length + updates.length + threads.length === 0
        ? ":white_check_mark: Alles bij. Geen urgente items op dit moment."
        : "",
    open_link: `<${HUB_URL}/inbox|Open Hub inbox>`,
  }
}

function renderTaskSection(header: string, items: TaskOrUpdate[]): string {
  if (items.length === 0) return ""
  const bullets = items
    .slice(0, MAX_LINES_PER_SECTION)
    .map((it) => {
      const client = it.clientName ? `*${it.clientName}* - ` : ""
      return `• ${client}${truncate(it.title, 80)}`
    })
    .join("\n")
  const more = items.length > MAX_LINES_PER_SECTION ? `\n_+ ${items.length - MAX_LINES_PER_SECTION} more_` : ""
  return `${header}\n${bullets}${more}\n`
}

function renderUpdateSection(header: string, items: TaskOrUpdate[]): string {
  if (items.length === 0) return ""
  const bullets = items
    .slice(0, MAX_LINES_PER_SECTION)
    .map((it) => {
      const from = it.authorName ? `${it.authorName} → ` : ""
      const client = it.clientName ? `*${it.clientName}* - ` : ""
      return `• ${from}${client}${truncate(it.title, 80)}`
    })
    .join("\n")
  const more = items.length > MAX_LINES_PER_SECTION ? `\n_+ ${items.length - MAX_LINES_PER_SECTION} more_` : ""
  return `${header}\n${bullets}${more}\n`
}

function renderChatSection(header: string, threads: ThreadSummary[]): string {
  if (threads.length === 0) return ""
  const bullets = threads
    .slice(0, MAX_LINES_PER_SECTION)
    .map((t) => {
      const name = t.clientName ?? t.primaryName
      return `• *${name}* - ${truncate(t.latestPreview, 80)} _(${t.unreadCount} unread)_`
    })
    .join("\n")
  const more = threads.length > MAX_LINES_PER_SECTION ? `\n_+ ${threads.length - MAX_LINES_PER_SECTION} more_` : ""
  return `${header}\n${bullets}${more}\n`
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}
