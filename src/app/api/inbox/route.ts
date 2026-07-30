import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { listInboxItems } from "@/lib/inbox/fetchers"
import { sendPushToUser } from "@/lib/notifications/push"
import { postItemUpdate } from "@/lib/integrations/monday"
import type {
  CreateInboxItemInput,
  InboxKind,
  TaskStatus,
  UpdateStatus,
} from "@/types/inbox"
import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const kindParam = sp.get("kind") as InboxKind | null
  const clientId = sp.get("clientId") ?? undefined
  const assignedToMe = sp.get("assignedToMe") === "true"
  const statusesParam = sp.get("statuses")
  const statuses = statusesParam !== null
    ? statusesParam.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined
  const snoozedRaw = sp.get("snoozed")
  const snoozed: "active" | "snoozed" | "all" | undefined =
    snoozedRaw === "active" || snoozedRaw === "snoozed" || snoozedRaw === "all"
      ? snoozedRaw
      : undefined
  const mentionsOnly = sp.get("mentions") === "1"
  const ownerRaw = sp.get("owner")
  const owner: "assigned" | "created" | "all" | undefined =
    ownerRaw === "assigned" || ownerRaw === "created" || ownerRaw === "all"
      ? ownerRaw
      : undefined

  try {
    const items = await listInboxItems(session.user.id, session.user.role, {
      kind: kindParam ?? undefined,
      clientId,
      assignedToMe,
      statuses,
      snoozed,
      mentionsOnly,
      owner,
    })
    return NextResponse.json({ items })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list inbox items" },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: CreateInboxItemInput
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body.kind || !body.clientId || !body.assigneeId || !body.title?.trim()) {
    return NextResponse.json(
      { error: "kind, clientId, assigneeId and title are required" },
      { status: 400 },
    )
  }

  if (!["update", "task"].includes(body.kind)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 })
  }

  const initialStatus: UpdateStatus | TaskStatus =
    body.kind === "update" ? "unread" : "open"

  // Scheduled reminders pass `snoozedUntil` either as a full ISO timestamp
  // or a plain YYYY-MM-DD. The plain form means "09:00 Europe/Amsterdam on
  // that day" - resolveSnoozedUntil handles DST so a Tuesday reminder lands
  // at 09:00 NL whether it's summer or winter.
  let snoozedUntil: string | null = null
  if (body.snoozedUntil) {
    try {
      snoozedUntil = resolveSnoozedUntil(body.snoozedUntil)
    } catch {
      return NextResponse.json({ error: "Invalid snoozedUntil" }, { status: 400 })
    }
  }

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("inbox_events")
    .insert({
      kind: body.kind,
      client_id: body.clientId,
      author_id: session.user.id,
      assignee_id: body.assigneeId,
      title: body.title.trim(),
      body: body.body?.trim() || null,
      status: initialStatus,
      priority: body.kind === "task" ? body.priority ?? "normal" : null,
      due_date: body.kind === "task" ? body.dueDate ?? null : null,
      source: body.source ?? "manual",
      source_ref: body.sourceRef ?? null,
      snoozed_until: snoozedUntil,
    })
    .select("id, title")
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create inbox item" },
      { status: 500 },
    )
  }

  // Mirror the new task/update to Monday as a real update on the client's item,
  // then relink the Hub row to it (source=monday + the thread/msg ids the reply
  // path keys on). Result: "1 Hub task/update ↔ 1 Monday update", and replying
  // in the Hub threads a reply onto it. Best-effort + awaited so the item is
  // linked by the time the composer refetches; a Monday failure leaves the item
  // as a normal manual Hub item (no throw). clientId is the Monday item id.
  // Roy 2026-07-26.
  if (body.clientId) {
    try {
      const mondayBody = body.body?.trim()
        ? `${body.title.trim()}\n\n${body.body.trim()}`
        : body.title.trim()
      const updateId = await postItemUpdate(body.clientId, mondayBody, {
        actorUserId: session.user.id,
      })
      if (updateId) {
        await supabase
          .from("inbox_events")
          .update({
            source: "monday",
            source_thread: `monday:item:${body.clientId}`,
            source_msg_id: `monday:update:${body.clientId}:${updateId}`,
            monday_update_id: updateId,
          })
          .eq("id", data.id)
      }
    } catch (e) {
      console.error("Monday update mirror on inbox-create failed:", e)
    }
  }

  // Push notification: notify the assignee about a new task on their plate.
  // Skip self-assigned items (you don't ping yourself when creating a task
  // for yourself). Updates are noisier; only push for tasks for now. Also
  // skip when the item is scheduled for the future - the user doesn't want
  // a "new task" ping at creation time for something that's hidden until
  // next Tuesday; the surface-time push is a separate concern (cron-driven,
  // fase 2).
  // Await the push (instead of fire-and-forget) so we can record delivery:
  // when at least one endpoint accepts it we stamp `notified_at`, which drives
  // the "Delivered" signal on the creator's Delegated view. A push send is a
  // short web-push HTTP call; the added latency is acceptable. Failures are
  // swallowed - the task itself is already persisted. Roy 2026-07-30.
  const isScheduledFuture = snoozedUntil !== null && new Date(snoozedUntil).getTime() > Date.now()
  if (
    body.kind === "task" &&
    body.assigneeId !== session.user.id &&
    !isScheduledFuture
  ) {
    try {
      const { delivered } = await sendPushToUser(body.assigneeId, {
        title: "Nieuwe taak op je naam",
        body: data.title.length > 120 ? data.title.slice(0, 117) + "…" : data.title,
        url: "/inbox",
        tag: `inbox-task-${data.id}`,
      })
      if (delivered > 0) {
        await supabase
          .from("inbox_events")
          .update({ notified_at: new Date().toISOString() })
          .eq("id", data.id)
      }
    } catch (e) {
      console.error("Inbox-create push failed:", e)
    }
  }

  return NextResponse.json({ id: data.id }, { status: 201 })
}

/** Expand `snoozedUntil` input to a canonical ISO timestamp.
 *
 * - Plain YYYY-MM-DD → 09:00 Europe/Amsterdam on that day (DST-aware).
 * - Anything else is fed to `new Date()`; if it parses, we return its ISO.
 *
 * The Intl roundtrip resolves the Amsterdam UTC offset on the target date
 * (CEST=+02:00 in summer, CET=+01:00 in winter) without needing date-fns-tz.
 */
function resolveSnoozedUntil(input: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(input)
  if (dateOnly) {
    const probe = new Date(`${input}T09:00:00Z`)
    const tzName = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Amsterdam",
      timeZoneName: "shortOffset",
    })
      .formatToParts(probe)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+1"
    const offsetMatch = /GMT([+-]\d+)/.exec(tzName)
    const offsetHours = offsetMatch ? parseInt(offsetMatch[1], 10) : 1
    const utcHour = 9 - offsetHours
    const hh = String(utcHour).padStart(2, "0")
    return `${input}T${hh}:00:00.000Z`
  }
  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date")
  }
  return parsed.toISOString()
}
