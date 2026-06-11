import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { getInboxItem, listInboxComments } from "@/lib/inbox/fetchers"
import { sendPushToUser } from "@/lib/notifications/push"
import type { TaskStatus, UpdateInboxItemInput, UpdateStatus } from "@/types/inbox"
import { NextRequest, NextResponse } from "next/server"

const TASK_STATUSES: TaskStatus[] = ["open", "in_progress", "done", "cancelled"]
const UPDATE_STATUSES: UpdateStatus[] = ["unread", "read"]

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const item = await getInboxItem(id, session.user.id, session.user.role)
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const comments = item.kind === "task" ? await listInboxComments(id) : []
  return NextResponse.json({ item, comments })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const item = await getInboxItem(id, session.user.id, session.user.role)
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let patch: UpdateInboxItemInput
  try {
    patch = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const isAuthor = item.authorId === session.user.id
  const isAdmin = session.user.role === "admin"
  const isAssignee = item.assigneeId === session.user.id
  // Tasks: the assignee is the person who's actually going to do the work, so
  // they get the same edit rights as the author - fixing the title, expanding
  // the body, or sliding the due date is routine triage on a task that landed
  // on you, not authorial overreach. The bulk of our tasks are auto-ingested
  // by the system HQ user (Trengo, Monday, Fathom, automation cron), so
  // gating edits behind "author === HQ system user" effectively meant "no AM
  // can ever fix anything." For updates we keep the original gate (author/
  // admin only) since updates are read-only signals, not actionable items.
  const canEditMeta = isAuthor || isAdmin || (item.kind === "task" && isAssignee)

  // Status transitions: anyone with visibility may flip status; metadata edits
  // (title, body, due date, priority) are author/admin/assignee.
  const update: Record<string, unknown> = {}

  // Reclassify (Move to Tasks / Updates / Chat) - open to anyone with
  // visibility, since it's a triage operation on a misclassified ingest. We
  // reset status + priority to sane defaults for the new kind so we don't
  // strand cross-enum statuses (e.g. "in_progress" sticking around on an
  // Update). Stamp classify_method='manual' so it's clear a human overrode AI.
  if (patch.kind !== undefined) {
    if (!["task", "update", "chat"].includes(patch.kind)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 })
    }
    if (patch.kind === item.kind) {
      // No-op kind change; ignore so we don't reset status/priority.
    } else {
      // Disallow moving Monday/automation/watchlist/manual items to chat -
      // they don't have a thread_key so they'd disappear from every view.
      if (patch.kind === "chat" && item.source !== "trengo" && item.source !== "slack") {
        return NextResponse.json(
          { error: "Only Trengo or Slack items can be moved to Chat" },
          { status: 400 },
        )
      }
      update.kind = patch.kind
      update.classify_method = "manual"
      if (patch.kind === "task") {
        update.status = "open"
        update.priority = "normal"
        update.completed_at = null
      } else {
        // update or chat - both default to unread, no priority
        update.status = "unread"
        update.priority = null
        update.completed_at = null
      }
    }
  }

  if (patch.status !== undefined && update.kind === undefined) {
    const valid = item.kind === "task"
      ? TASK_STATUSES.includes(patch.status as TaskStatus)
      : UPDATE_STATUSES.includes(patch.status as UpdateStatus)
    if (!valid) {
      return NextResponse.json({ error: "Invalid status for this item kind" }, { status: 400 })
    }
    update.status = patch.status
    const isTerminal = ["done", "cancelled", "read"].includes(patch.status)
    update.completed_at = isTerminal ? new Date().toISOString() : null
  }

  // Reassignment is open to anyone with visibility - handing a task off is a
  // routine team operation, not an authorial edit. The other metadata edits
  // (title, body, due date, priority) stay author/admin-only because changing
  // them silently after creation can mislead the assignee.
  if (patch.assigneeId !== undefined) update.assignee_id = patch.assigneeId

  // Snooze is also open to anyone with visibility - pushing a task to later
  // is a personal triage move, not an authorial edit. Null wakes it up.
  // Only valid on tasks; ignored on updates (which have their own read flow).
  if (patch.snoozedUntil !== undefined && item.kind === "task") {
    if (patch.snoozedUntil === null) {
      update.snoozed_until = null
    } else if (typeof patch.snoozedUntil === "string") {
      const ts = new Date(patch.snoozedUntil)
      if (Number.isNaN(ts.getTime())) {
        return NextResponse.json({ error: "Invalid snoozedUntil timestamp" }, { status: 400 })
      }
      update.snoozed_until = ts.toISOString()
    } else {
      return NextResponse.json({ error: "snoozedUntil must be ISO string or null" }, { status: 400 })
    }
  }

  if (canEditMeta) {
    if (patch.title !== undefined) update.title = patch.title.trim()
    if (patch.body !== undefined) update.body = patch.body?.trim() || null
    if (patch.dueDate !== undefined) update.due_date = patch.dueDate
    if (patch.priority !== undefined) update.priority = patch.priority
  } else {
    const triedToEditMeta =
      patch.title !== undefined ||
      patch.body !== undefined ||
      patch.dueDate !== undefined ||
      patch.priority !== undefined
    if (triedToEditMeta) {
      return NextResponse.json(
        { error: "Only the author or an admin can edit item metadata" },
        { status: 403 },
      )
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true })
  }

  const supabase = await createAdminClient()
  const { error } = await supabase.from("inbox_events").update(update).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Push notification on reassignment to a different user. Skip when the new
  // assignee is the actor (you don't notify yourself), and best-effort fail
  // silently - notification delivery shouldn't block the API response.
  if (
    patch.assigneeId !== undefined &&
    patch.assigneeId !== item.assigneeId &&
    patch.assigneeId !== session.user.id
  ) {
    sendPushToUser(patch.assigneeId, {
      title: "Nieuwe taak op je naam",
      body: item.title.length > 120 ? item.title.slice(0, 117) + "…" : item.title,
      url: "/inbox",
      tag: `inbox-task-${id}`,
    }).catch((e) => console.error("Reassign push send failed:", e))
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const item = await getInboxItem(id, session.user.id, session.user.role)
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Tasks: the assignee owns the work and can permanently remove it. Same
  // policy as the meta-edit widening in PATCH - the AM landed on Roy's
  // critique that auto-ingested rows with the system HQ user as author
  // were untouchable for non-admins. Updates stay author/admin-only.
  const isAssignee = item.assigneeId === session.user.id
  const canDelete =
    item.authorId === session.user.id ||
    session.user.role === "admin" ||
    (item.kind === "task" && isAssignee)
  if (!canDelete) {
    return NextResponse.json({ error: "Not authorised to delete this item" }, { status: 403 })
  }

  const supabase = await createAdminClient()
  const { error } = await supabase.from("inbox_events").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
