import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Toggle the manual billing-hold flag on a client.
 *
 * Used by the Billing overview's "Hold" toggle on each row. Held clients
 * sit in a dedicated "On Hold (manual)" bucket above the time-based ones
 * and are excluded from Overdue/Today/This week so finance can't
 * accidentally invoice a client they explicitly parked.
 *
 * Distinct from campaign status `on_hold` — that one also pauses Meta
 * delivery + filters the client out of every overview. Billing hold only
 * affects the Future invoices view; everything else about the client
 * continues to operate normally.
 */
type Body = {
  hold?: boolean
  reason?: string | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  if (!mondayItemId) return NextResponse.json({ error: "Missing client id" }, { status: 400 })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (typeof body.hold !== "boolean") {
    return NextResponse.json({ error: "`hold` boolean is required" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("clients")
    .update({
      billing_hold: body.hold,
      // Wipe the reason when un-holding so a stale note doesn't haunt the
      // next hold cycle. Keep it when holding (caller may or may not pass one).
      billing_hold_reason: body.hold ? body.reason ?? null : null,
      billing_hold_updated_at: new Date().toISOString(),
    })
    .eq("monday_item_id", mondayItemId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, hold: body.hold })
}
