import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const maxDuration = 30

/**
 * PATCH /api/meetings/[id]
 *
 * Manual link / archive / unarchive controls used from the meeting card on
 * the global /meetings page.
 *
 * Body shapes:
 *   { client_id: <monday_item_id> }   → link to client (sets link_status='linked')
 *   { link_status: 'archived' }       → drop from triage queue (keeps client_id)
 *   { link_status: 'unlinked' }       → unarchive / un-link (clears client_id)
 *
 * Visibility note: every meeting is admin-visible, so we don't need the
 * cached-Monday filtering used elsewhere — just require an authenticated
 * Hub user. The matcher (C.5.b) will be a separate code path that runs
 * server-side without a session.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  if (!id) return NextResponse.json({ error: "Missing meeting id" }, { status: 400 })

  let body: { client_id?: string | null; link_status?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const update: { client_id?: string | null; link_status?: string } = {}

  if (typeof body.client_id === "string" && body.client_id.length > 0) {
    // Validate the client exists in our Supabase mirror so we never write
    // a phantom monday_item_id into meetings.client_id.
    const { data: client } = await supabase
      .from("clients")
      .select("monday_item_id")
      .eq("monday_item_id", body.client_id)
      .maybeSingle()
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }
    update.client_id = body.client_id
    update.link_status = "linked"
  } else if (body.link_status === "archived") {
    update.link_status = "archived"
  } else if (body.link_status === "unlinked") {
    // Un-archive / un-link: clear the client and put back in triage.
    update.link_status = "unlinked"
    update.client_id = null
  } else {
    return NextResponse.json(
      { error: "Provide either client_id (to link) or link_status='archived'|'unlinked'" },
      { status: 400 },
    )
  }

  const { error } = await supabase.from("meetings").update(update).eq("id", id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, ...update })
}
