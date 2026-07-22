import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { normalizePhone } from "@/lib/inbox/trengo-contacts"

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
  // Threads are channel-scoped ("<base>|ch:<id>"); linking is contact-level, so
  // act on the base key across all channels. A base is either a single contact
  // (`trengo:contact:<id>`) or a phone-merged thread (`trengo:phone:<E164>`)
  // that fuses several duplicate contacts for one number. Roy 2026-07-22.
  const threadKey = decodeURIComponent(encoded).replace(/\|ch:.*$/, "")

  const body = (await req.json().catch(() => null)) as { clientId?: string } | null
  const clientId = body?.clientId?.trim()
  if (!clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  // Resolve the set of Trengo contact ids this thread represents, and the
  // thread_key(s) whose rows we must backfill.
  const contactIds: string[] = []
  const backfillKeys: string[] = [threadKey]
  if (threadKey.startsWith("trengo:contact:")) {
    const cid = threadKey.replace(/^trengo:contact:/, "")
    if (cid) contactIds.push(cid)
    // If this contact has a phone, its rows may already be phone-merged, and
    // sibling contacts on the same number should link too.
    const { data: me } = await supabase
      .from("trengo_contacts")
      .select("phone")
      .eq("id", Number(cid))
      .maybeSingle<{ phone: string | null }>()
    const norm = normalizePhone(me?.phone)
    if (norm) {
      backfillKeys.push(`trengo:phone:${norm}`)
      const { data: sibs } = await supabase
        .from("trengo_contacts")
        .select("id, phone")
        .eq("phone", me!.phone)
      for (const s of (sibs ?? []) as Array<{ id: number }>) contactIds.push(String(s.id))
    }
  } else if (threadKey.startsWith("trengo:phone:")) {
    const norm = threadKey.replace(/^trengo:phone:/, "")
    // Every registry contact whose normalised phone matches this thread.
    const { data: all } = await supabase
      .from("trengo_contacts")
      .select("id, phone")
      .not("phone", "is", null)
    for (const r of (all ?? []) as Array<{ id: number; phone: string | null }>) {
      if (normalizePhone(r.phone) === norm) contactIds.push(String(r.id))
    }
  } else {
    return NextResponse.json(
      { error: "Linking is only supported on Trengo contact/phone threads" },
      { status: 400 },
    )
  }
  const contactId = contactIds[0]
  if (!contactId) {
    return NextResponse.json({ error: "No contact id resolvable from thread" }, { status: 400 })
  }

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
  const uniqueContactIds = Array.from(new Set(contactIds))
  const { data: existingOwner } = await supabase
    .from("clients")
    .select("monday_item_id, name")
    .overlaps("trengo_contact_ids", uniqueContactIds)
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

  // Append every contact id on this thread (dedupe in JS - PostgreSQL has no
  // native upsert-into-array). Covers all duplicate contacts on a merged phone.
  const current = client.trengo_contact_ids ?? []
  const next = Array.from(new Set([...current, ...uniqueContactIds]))
  const appended = next.length > current.length
  if (appended) {
    const { error: uErr } = await supabase
      .from("clients")
      .update({ trengo_contact_ids: next })
      .eq("monday_item_id", clientId)
    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 })
    }
  }

  // Backfill historical inbox_events: every unlinked event on this thread (both
  // the contact base and the merged phone base) gets the target client_id so
  // the thread shows under the client's history immediately. Only touch rows
  // that were truly unlinked (`client_id = ""`) - never overwrite a link.
  const { error: bErr, count } = await supabase
    .from("inbox_events")
    .update({ client_id: clientId }, { count: "exact" })
    .in("thread_key", backfillKeys)
    .eq("client_id", "")
  if (bErr) {
    console.error("link: backfill failed", bErr)
  }

  return NextResponse.json({
    ok: true,
    appended,
    backfilledCount: count ?? 0,
    clientName: client.name,
  })
}
