import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { getInboxItem, listInboxComments } from "@/lib/inbox/fetchers"
import { mirrorCommentToMonday } from "@/lib/inbox/monday-mirror"
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const item = await getInboxItem(id, session.user.id, session.user.role)
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const comments = await listInboxComments(id)
  return NextResponse.json({ comments })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const item = await getInboxItem(id, session.user.id, session.user.role)
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (item.kind !== "task") {
    return NextResponse.json({ error: "Comments are only available on tasks" }, { status: 400 })
  }

  let parsed: { body?: string }
  try {
    parsed = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const text = parsed.body?.trim()
  if (!text) return NextResponse.json({ error: "Comment body required" }, { status: 400 })

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("inbox_comments")
    .insert({
      item_id: id,
      author_id: session.user.id,
      body: text,
    })
    .select("id")
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to add comment" }, { status: 500 })
  }

  // Mirror to Monday as a reply under the parent's mirrored update.
  mirrorCommentToMonday({
    clientId: item.clientId,
    parentMondayUpdateId: item.mondayUpdateId,
    parentTitle: item.title,
    authorName: session.user.name ?? session.user.email,
    body: text,
  })
    .then(async (mondayUpdateId) => {
      if (mondayUpdateId) {
        await supabase
          .from("inbox_comments")
          .update({ monday_update_id: mondayUpdateId })
          .eq("id", data.id)
      }
    })
    .catch((e) => console.error("Inbox comment mirror failed:", e))

  return NextResponse.json({ id: data.id }, { status: 201 })
}
