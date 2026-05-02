import { auth } from "@/lib/auth"
import { updateClientField, type ClientFieldUpdate } from "@/lib/clients/edit"
import { fetchClientById } from "@/lib/integrations/monday"
import { syncClientToSupabase } from "@/lib/clients/sync"
import { getClientAccess } from "@/lib/clients/access"
import { NextRequest, NextResponse } from "next/server"

/**
 * Single-client detail fetch — backs the slide-over panel on /clients. Returns
 * the same data the old `/clients/[id]` page route assembled server-side
 * (Monday item + Supabase ID + access flags) so the client-side panel can
 * render without a full page navigation.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params

  try {
    const client = await fetchClientById(mondayItemId)
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 })

    let supabaseClientId = ""
    try {
      supabaseClientId = await syncClientToSupabase(client)
    } catch (e) {
      console.error("Supabase sync failed:", e)
    }

    const access = await getClientAccess(
      session.user.id,
      session.user.role ?? "member",
      client.mondayItemId,
    )

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
