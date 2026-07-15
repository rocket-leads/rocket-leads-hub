import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * POST /api/inbox/threads/{threadKey}/link
 *
 * Body: `{ clientId: string }` - the target client's `monday_item_id`.
 * Links an unlinked Trengo contact to a Hub client by appending the
 * contact id to `clients.trengo_contact_ids` (TEXT[] - already supports
 * multi-channel) and backfilling existing inbox_events for the thread.
 *
 * Per Roy's spec: appending, not replacing. A client can be reachable on
 * multiple Trengo contacts (e.g. WhatsApp + email separately registered).
 *
 * Idempotent: if the contact id is already in the array, the array isn't
 * touched but the inbox_events backfill still runs (covers the case where
 * the link was added directly in Supabase but historical events weren't
 * relinked).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadKey: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { threadKey: encoded } = await params
  // Threads are channel-scoped ("<base>|ch:<id>"); linking a contact to a
  // client is contact-level, so act on the base key across all channels.
  const threadKey = decodeURIComponent(encoded).replace(/\|ch:.*$/, "")
  if (!threadKey.startsWith("trengo:contact:")) {
    return NextResponse.json(
      { error: "Linking is only supported on Trengo contact threads" },
      { status: 400 },
    )
  }
  const contactId = threadKey.replace(/^trengo:contact:/, "")
  if (!contactId) {
    return NextResponse.json({ error: "Missing contact id in threadKey" }, { status: 400 })
  }

  const body = (await req.json().catch(() => null)) as { clientId?: string } | null
  const clientId = body?.clientId?.trim()
  if (!clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  // Resolve target client and verify it exists.
  const { data: client, error: cErr } = await supabase
    .from("clients")
    .select("monday_item_id, name, trengo_contact_ids")
    .eq("monday_item_id", clientId)
    .maybeSingle<{
      monday_item_id: string
      name: string
      trengo_contact_ids: string[] | null
    }>()
  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 })
  }
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  // Refuse to silently steal a contact already linked to a DIFFERENT client.
  // Surfaces the conflict so the AM can decide (Trengo allows one contact
  // per real person; mapping it to two RL clients is almost always a
  // mistake).
  const { data: existingOwner } = await supabase
    .from("clients")
    .select("monday_item_id, name")
    .contains("trengo_contact_ids", [contactId])
    .neq("monday_item_id", clientId)
    .maybeSingle<{ monday_item_id: string; name: string }>()
  if (existingOwner) {
    return NextResponse.json(
      {
        error: `Already linked to "${existingOwner.name}". Unlink there first to move it.`,
        existingClientId: existingOwner.monday_item_id,
        existingClientName: existingOwner.name,
      },
      { status: 409 },
    )
  }

  // Append the contact id (no-op if already present). PostgreSQL doesn't
  // have a native upsert-into-array; we do the dedupe in JS.
  const current = client.trengo_contact_ids ?? []
  let appended = false
  let next = current
  if (!current.includes(contactId)) {
    next = [...current, contactId]
    appended = true
  }
  if (appended) {
    const { error: uErr } = await supabase
      .from("clients")
      .update({ trengo_contact_ids: next })
      .eq("monday_item_id", clientId)
    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 })
    }
  }

  // Backfill historical inbox_events: every unlinked event in this thread
  // gets the target client_id so the thread shows up under the client's
  // history immediately. We only touch rows that were truly unlinked
  // (`client_id = ""`) - never overwrite an existing link.
  const { error: bErr, count } = await supabase
    .from("inbox_events")
    .update({ client_id: clientId }, { count: "exact" })
    .eq("thread_key", threadKey)
    .eq("client_id", "")
  if (bErr) {
    // Don't fail the response - the link itself succeeded; the backfill
    // is a nice-to-have. Surface in logs for monitoring.
    console.error("link: backfill failed", bErr)
  }

  return NextResponse.json({
    ok: true,
    appended,
    backfilledCount: count ?? 0,
    clientName: client.name,
  })
}
