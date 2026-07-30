import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import {
  getConnectionOverrides,
  setConnectionOverride,
  isConnectionService,
} from "@/lib/clients/connection-overrides"
import { invalidateClientHealth } from "@/lib/integrations/health"

/**
 * GET  /api/clients/[id]/connection-override
 *   → { overrides: Record<service, { notApplicable, note }> }
 *
 * POST /api/clients/[id]/connection-override
 *   body: { service, notApplicable, note? }
 *   → { ok: true }
 *
 * Records the Hub-only "this service is not applicable for this client" flag
 * that distinguishes a deliberately-blank connection (struck dash in the audit)
 * from a forgotten one (red "missing"). Writing an override busts the client's
 * cached health snapshot so the audit reflects the change immediately.
 *
 * All ConnectedEntity instances on a client panel share the GET (one query key
 * keyed by client id), so opening the panel is a single fetch, not five.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const overrides = await getConnectionOverrides(mondayItemId)
  return NextResponse.json({ overrides })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const body = (await req.json().catch(() => ({}))) as {
    service?: string
    notApplicable?: boolean
    note?: string | null
  }

  if (!body.service || !isConnectionService(body.service)) {
    return NextResponse.json({ error: "Unknown service" }, { status: 400 })
  }

  try {
    await setConnectionOverride(
      mondayItemId,
      body.service,
      body.notApplicable === true,
      body.note ?? null,
      session.user.id,
    )
    // The verdict changed - drop the cached audit row so the next Clients-tab
    // load (and the posture "needs linking" count) recompute.
    await invalidateClientHealth(mondayItemId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save override" },
      { status: 500 },
    )
  }
}
