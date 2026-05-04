import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { updateClientField } from "@/lib/clients/edit"
import { resolveClientAssignee } from "@/lib/inbox/assignee"

/**
 * Link a Trengo contact to a Hub client and backfill any unlinked inbox events
 * for that contact so they show up under the right client + on the right AM's
 * "Assigned to me" filter going forward.
 *
 * Steps:
 *  1. Write the contact id to the client's `trengo_contact_id` Monday column
 *     (re-syncs to Supabase via `updateClientField`).
 *  2. Update every Trengo `inbox_events` row whose `author_external` matches
 *     the contact id and whose `client_id` is empty (unlinked) — set them to
 *     the new client id.
 *  3. Re-resolve the AM for that client and rewrite `assignee_id` for those
 *     same rows when the previous assignee was the system HQ user (the
 *     placeholder we used at ingest time).
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { trengoContactId?: string; mondayItemId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const trengoContactId = body.trengoContactId?.trim()
  const mondayItemId = body.mondayItemId?.trim()
  if (!trengoContactId || !mondayItemId) {
    return NextResponse.json(
      { error: "trengoContactId and mondayItemId are required" },
      { status: 400 },
    )
  }

  // 1. Write the contact id to the client's Monday column. updateClientField
  // throws on failure, which we let bubble up as a 500 — the caller will see
  // a meaningful error rather than a silent partial success.
  try {
    await updateClientField(mondayItemId, {
      fieldKey: "trengo_contact_id",
      value: trengoContactId,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update client" },
      { status: 500 },
    )
  }

  const supabase = await createAdminClient()

  // 2. Backfill unlinked inbox events. We match strictly: same external id,
  // same source, currently empty client_id. We don't touch already-linked
  // rows — those belong to whichever client they were tagged with.
  const { data: rowsToBackfill, error: fetchErr } = await supabase
    .from("inbox_events")
    .select("id, assignee_id")
    .eq("source", "trengo")
    .eq("author_external", trengoContactId)
    .or("client_id.is.null,client_id.eq.")
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  const rows = rowsToBackfill ?? []
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, backfilled: 0 })
  }

  // Resolve the AM for the freshly-linked client. Falls back to the existing
  // HQ assignee when no mapping exists, so we don't accidentally reassign to
  // null and break the FK.
  const newAssignee = await resolveClientAssignee(mondayItemId)

  // Look up the system HQ user once — it's the marker for "this row was never
  // routed to anyone real, so it's safe to overwrite the assignee."
  const { data: hq } = await supabase
    .from("users")
    .select("id")
    .eq("email", "rocketleadshq@gmail.com")
    .maybeSingle()
  const hqId = hq?.id ?? null

  const ids = rows.map((r) => r.id)

  // Always update client_id; only overwrite assignee when it was the HQ
  // placeholder. If a human had already manually reassigned a row, we leave
  // their pick alone.
  const { error: updateClientErr } = await supabase
    .from("inbox_events")
    .update({ client_id: mondayItemId })
    .in("id", ids)
  if (updateClientErr) {
    return NextResponse.json({ error: updateClientErr.message }, { status: 500 })
  }

  if (newAssignee && hqId) {
    const idsStillOnHq = rows
      .filter((r) => r.assignee_id === hqId)
      .map((r) => r.id)
    if (idsStillOnHq.length > 0) {
      const { error: updateAssigneeErr } = await supabase
        .from("inbox_events")
        .update({ assignee_id: newAssignee })
        .in("id", idsStillOnHq)
      if (updateAssigneeErr) {
        return NextResponse.json({ error: updateAssigneeErr.message }, { status: 500 })
      }
    }
  }

  return NextResponse.json({
    ok: true,
    backfilled: rows.length,
    reassigned: newAssignee && hqId ? rows.filter((r) => r.assignee_id === hqId).length : 0,
  })
}
