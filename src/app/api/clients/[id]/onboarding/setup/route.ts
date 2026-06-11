import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { runAutoSetup } from "@/lib/onboarding/auto-setup"
import { saveStepState } from "@/lib/clients/onboarding-state"

// Drive folder + 7 subfolders + Monday writeback = ~10-15s on the happy
// path. Allow generous timeout so a slow Drive day doesn't 504 the AM.
export const maxDuration = 60

/**
 * POST /api/clients/[id]/onboarding/setup
 *
 * Runs the wizard's auto-setup pipeline for this client: creates the
 * Drive folder tree, generates the Meta BM connect URL placeholder, and
 * (TODO) a Stripe payment link. Results land in the kickoff_live step's
 * content so the AM sees ready resources the moment they enter Stap 1.
 *
 * Idempotent - if Drive folder ID is already mirrored from a prior run,
 * the setup reuses it instead of creating duplicates.
 *
 * Triggered by the wizard page on first mount (UI shows "Setting up…"
 * spinner during the POST), so the AM doesn't have to remember to click
 * a button before starting the kick-off call.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params

  try {
    const result = await runAutoSetup({ mondayItemId })

    // Persist into kickoff_live step content so the wizard's GET sees
    // the resources next time without re-running setup. We DON'T mark
    // the step done - the AM still has to fill the brief + share with
    // the client + payment received before this step counts as complete.
    await saveStepState({
      mondayItemId,
      stepKey: "kickoff_live",
      done: false,
      content: { autoSetup: result },
      userId: session.user.id,
    })

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Auto-setup failed"
    console.error("[onboarding-setup] failed:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
