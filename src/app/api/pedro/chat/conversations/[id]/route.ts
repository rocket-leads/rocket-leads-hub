import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

async function ownConversation(userId: string, id: string) {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("pedro_chat_conversations")
    .select("id, title, user_id, archived_at")
    .eq("id", id)
    .maybeSingle()
  if (!data || data.user_id !== userId) return null
  return { supabase, conversation: data }
}

/** Fetch a conversation with its full message history. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  const owned = await ownConversation(session.user.id, id)
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { data: messages, error } = await owned.supabase
    .from("pedro_chat_messages")
    .select("id, role, content, tool_calls, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ conversation: owned.conversation, messages: messages ?? [] })
}

/** Rename a conversation. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  const owned = await ownConversation(session.user.id, id)
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { title?: string }
  const title = (body.title ?? "").trim()
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 })

  const { error } = await owned.supabase
    .from("pedro_chat_conversations")
    .update({ title: title.slice(0, 120), updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/** Archive (soft-delete) a conversation. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  const owned = await ownConversation(session.user.id, id)
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { error } = await owned.supabase
    .from("pedro_chat_conversations")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
