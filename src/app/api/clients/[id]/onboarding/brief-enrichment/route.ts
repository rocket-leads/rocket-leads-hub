import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { enrichBriefFromTranscript } from "@/lib/onboarding/brief-enrichment"
import { saveStepState } from "@/lib/clients/onboarding-state"

// Sonnet enrichment over a 30-60 min transcript can take 20-40s. Same
// ceiling as Pedro's auto-brief route.
export const maxDuration = 120

/**
 * POST /api/clients/[id]/onboarding/brief-enrichment
 *
 * Runs the AI enrichment pass: takes the AM's live brief from Stap 1 +
 * the Fathom transcript linked in Stap 2 and produces per-field
 * suggestions. The result is persisted as content on the brief_enrichment
 * step row (NOT marked done - the AM still has to accept/reject + save).
 *
 * Idempotent: re-running re-asks the model. The UI's "Re-generate" knob
 * uses this to retry when the AM thinks the first pass missed things.
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
    const result = await enrichBriefFromTranscript({ mondayItemId })

    // Persist suggestions onto the step's content. We don't merge with
    // a previous `acceptedFields` map - Re-generate replaces from
    // scratch, the UI re-applies the AM's accepts on the new payload.
    // Keeping the step `done: false` because the AM still has to
    // approve.
    await saveStepState({
      mondayItemId,
      stepKey: "brief_enrichment",
      done: false,
      content: {
        suggestions: result.suggestions,
        insufficientTranscript: result.insufficientTranscript,
        generatedAt: new Date().toISOString(),
      },
      userId: session.user.id,
    })

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Enrichment failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
