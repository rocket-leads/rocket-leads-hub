import { auth } from "@/lib/auth"
import { updateClientField, type ClientFieldUpdate } from "@/lib/clients/edit"
import { fetchClientById } from "@/lib/integrations/monday"
import { syncClientToSupabase, ensureClientId } from "@/lib/clients/sync"
import { getClientAccess } from "@/lib/clients/access"
import { NextRequest, NextResponse } from "next/server"

/**
 * Single-client detail fetch — backs the slide-over panel on /clients
 * and the Watch List. Latency-sensitive: every ms here is a delay
 * before the panel renders the client tabs.
 *
 * Three round-trips run in parallel:
 *   1. Monday fetchClientById (the slow one, 500-2000ms typically)
 *   2. Supabase getClientAccess (indexed lookup, ~50ms)
 *   3. Supabase ensureClientId (SELECT id by monday_item_id, ~50ms)
 *
 * The full Supabase sync (column updates, agreement seed) runs as a
 * fire-and-forget after we already have the response queued — it's
 * not in the critical path of rendering the panel.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params

  try {
    const [client, access] = await Promise.all([
      fetchClientById(mondayItemId),
      getClientAccess(
        session.user.id,
        session.user.role ?? "member",
        mondayItemId,
      ),
    ])
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Need the Supabase id for HomeTab's inbox query. The fast path
    // is a single SELECT (or one extra INSERT for brand-new clients);
    // the full column sync is deferred.
    let supabaseClientId = ""
    try {
      supabaseClientId = await ensureClientId(client)
    } catch (e) {
      console.error("ensureClientId failed:", e)
    }

    // Fire-and-forget the full sync — it writes the latest Monday
    // column values + seeds an agreement row if missing. Not awaited
    // because the panel doesn't need any of that to render. Errors
    // are logged but never block the response.
    void syncClientToSupabase(client).catch((e) => {
      console.error("Background Supabase sync failed:", e)
    })

    return NextResponse.json({ client, supabaseClientId, access })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load client" },
      { status: 500 },
    )
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const body = (await req.json()) as ClientFieldUpdate

  try {
    await updateClientField(mondayItemId, body)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 400 },
    )
  }
}
