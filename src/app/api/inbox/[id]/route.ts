import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { getInboxItem, listInboxComments } from "@/lib/inbox/fetchers"
import { mirrorStatusChangeToMonday } from "@/lib/inbox/monday-mirror"
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
  const canEditMeta = isAuthor || isAdmin

  // Status transitions: anyone with visibility may flip status; metadata edits
  // (title, body, assignee, due date, priority) are author/admin only.
  const update: Record<string, unknown> = {}

  if (patch.status !== undefined) {
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

  if (canEditMeta) {
    if (patch.title !== undefined) update.title = patch.title.trim()
    if (patch.body !== undefined) update.body = patch.body?.trim() || null
    if (patch.assigneeId !== undefined) update.assignee_id = patch.assigneeId
    if (patch.dueDate !== undefined) update.due_date = patch.dueDate
    if (patch.priority !== undefined) update.priority = patch.priority
  } else {
    const triedToEditMeta =
      patch.title !== undefined ||
      patch.body !== undefined ||
      patch.assigneeId !== undefined ||
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
  const { error } = await supabase.from("inbox_items").update(update).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Mirror task status changes to Monday (done/cancelled only — see helper)
  if (patch.status && item.kind === "task") {
    mirrorStatusChangeToMonday({
      kind: item.kind,
      clientId: item.clientId,
      parentMondayUpdateId: item.mondayUpdateId,
      parentTitle: item.title,
      newStatus: patch.status,
      actorName: session.user.name ?? session.user.email,
    }).catch((e) => console.error("Inbox status-change mirror failed:", e))
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

  const canDelete = item.authorId === session.user.id || session.user.role === "admin"
  if (!canDelete) {
    return NextResponse.json({ error: "Only the author or an admin can delete" }, { status: 403 })
  }

  const supabase = await createAdminClient()
  const { error } = await supabase.from("inbox_items").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
