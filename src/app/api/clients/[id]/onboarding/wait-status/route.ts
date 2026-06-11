import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { fetchWaitStatus } from "@/lib/onboarding/wait-status"
import { saveStepState } from "@/lib/clients/onboarding-state"

/**
 * GET /api/clients/[id]/onboarding/wait-status
 *
 * Returns the three client-side completion signals (Drive content
 * uploaded, Meta BM linked, payment received). UI polls this every
 * ~60s while Stap 4 is open; auto-marks the step done once all three
 * are green so the AM can move to handoff without re-opening the step.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params

  try {
    const status = await fetchWaitStatus({ mondayItemId })

    // Auto-promote: once all three signals are green, persist done so
    // the wizard's "current step" pointer rolls forward to handoff
    // without the AM having to click anything. Idempotent - re-saving
    // done=true is a no-op besides updated_at.
    if (status.allGreen) {
      await saveStepState({
        mondayItemId,
        stepKey: "wait_on_client",
        done: true,
        content: { lastChecked: new Date().toISOString(), ...status },
        userId: session.user.id,
      })
    }

    return NextResponse.json(status)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Wait-status check failed" },
      { status: 500 },
    )
  }
}
