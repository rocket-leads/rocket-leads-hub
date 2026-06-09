import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { listInboxItems } from "@/lib/inbox/fetchers"
import { sendPushToUser } from "@/lib/notifications/push"
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

  try {
    const items = await listInboxItems(session.user.id, session.user.role, {
      kind: kindParam ?? undefined,
      clientId,
      assignedToMe,
      statuses,
      snoozed,
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
    })
    .select("id, title")
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create inbox item" },
      { status: 500 },
    )
  }

  // Push notification: notify the assignee about a new task on their plate.
  // Skip self-assigned items (you don't ping yourself when creating a task
  // for yourself). Updates are noisier; only push for tasks for now.
  if (body.kind === "task" && body.assigneeId !== session.user.id) {
    sendPushToUser(body.assigneeId, {
      title: "Nieuwe taak op je naam",
      body: data.title.length > 120 ? data.title.slice(0, 117) + "…" : data.title,
      url: "/inbox",
      tag: `inbox-task-${data.id}`,
    }).catch((e) => console.error("Inbox-create push failed:", e))
  }

  return NextResponse.json({ id: data.id }, { status: 201 })
}
