import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { readCache } from "@/lib/cache"

/**
 * Admin-only readout of the Trengo webhook debug ring buffer. Each entry
 * records what arrived on /api/webhooks/trengo BEFORE any auth or shape
 * checks - used to diagnose why real Trengo deliveries don't land in
 * inbox_events even when the curl probe works end-to-end.
 *
 * Drop this endpoint once the webhook flow is healthy.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const entries = (await readCache<unknown[]>("trengo_webhook_debug")) ?? []
  return NextResponse.json({ entries })
}
