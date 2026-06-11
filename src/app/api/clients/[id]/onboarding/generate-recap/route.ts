import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { generateRecapFromTranscript } from "@/lib/onboarding/generate-recap"
import { fetchStoredSteps } from "@/lib/clients/onboarding-state"

// AI generation over a 30-60 min transcript can take 20-40s.
export const maxDuration = 120

/**
 * POST /api/clients/[id]/onboarding/generate-recap
 *
 * Generates the post-kick-off recap email — AI-driven from the linked
 * Fathom transcript when available, fallback skeleton template when
 * not. Body returned as plain text the AM pastes/edits in the recap
 * dialog before sending via Trengo.
 *
 * Falls back transparently: caller doesn't need to know whether the
 * transcript was ready or not. The `source` field in the response
 * tells the UI whether to surface a "transcript not yet — fill the
 * placeholder" hint.
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

  // Pull Drive folder + Meta BM URLs from the kickoff_live step's
  // autoSetup content so the AI can drop them into the body in the
  // right place. Same lookup as the wait-status endpoint uses for the
  // Drive subfolder.
  const stored = await fetchStoredSteps(mondayItemId)
  const kickoffContent = stored.get("kickoff_live")?.content as
    | {
        autoSetup?: {
          drive?: { rootFolderUrl?: string }
          metaBmConnectUrl?: string
        }
      }
    | null
    | undefined

  try {
    const result = await generateRecapFromTranscript({
      mondayItemId,
      driveFolderUrl: kickoffContent?.autoSetup?.drive?.rootFolderUrl ?? null,
      metaBmConnectUrl: kickoffContent?.autoSetup?.metaBmConnectUrl ?? null,
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Recap generation failed" },
      { status: 500 },
    )
  }
}
