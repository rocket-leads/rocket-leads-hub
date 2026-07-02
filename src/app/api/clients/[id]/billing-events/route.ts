import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { fetchBillingEvents } from "@/lib/billing/audit"

/** Per-client billing audit trail for the Billing tab history panel. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id: mondayItemId } = await params
  const events = await fetchBillingEvents(mondayItemId)
  return NextResponse.json({ ok: true, events })
}
