import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { listInboxItems } from "@/lib/inbox/fetchers"
import { mirrorItemToMonday } from "@/lib/inbox/monday-mirror"
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

  try {
    const items = await listInboxItems(session.user.id, session.user.role, {
      kind: kindParam ?? undefined,
      clientId,
      assignedToMe,
      statuses,
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
    .select(`
      id, client_id, kind, title, body,
      author:users!inbox_items_author_id_fkey(name, email),
      assignee:users!inbox_items_assignee_id_fkey(name, email)
    `)
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create inbox item" },
      { status: 500 },
    )
  }

  // Mirror to Monday — best-effort, don't block the response on it.
  type Row = {
    id: string
    client_id: string
    kind: InboxKind
    title: string
    body: string | null
    author: { name: string | null; email: string } | null
    assignee: { name: string | null; email: string } | null
  }
  const row = data as unknown as Row
  const authorName = row.author?.name ?? row.author?.email ?? "Unknown"
  const assigneeName = row.assignee?.name ?? row.assignee?.email ?? "Unknown"

  mirrorItemToMonday({
    kind: row.kind,
    clientId: row.client_id,
    title: row.title,
    body: row.body,
    authorName,
    assigneeName,
  })
    .then(async (mondayUpdateId) => {
      if (mondayUpdateId) {
        await supabase
          .from("inbox_events")
          .update({ monday_update_id: mondayUpdateId })
          .eq("id", row.id)
      }
    })
    .catch((e) => console.error("Inbox Monday mirror failed:", e))

  return NextResponse.json({ id: row.id }, { status: 201 })
}
