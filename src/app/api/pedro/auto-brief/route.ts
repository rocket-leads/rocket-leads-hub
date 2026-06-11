import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { generateAutoBrief } from "@/lib/pedro/generate-brief"

// Brief generation routinely takes 20-40s on Sonnet 4 with the full
// kick-off / Trengo / Monday context bundle. Without an explicit
// maxDuration, Vercel kills the function at 10s and the CM gets a 504
// HTML page instead of a brief. Matches /api/pedro/claude's 120s ceiling.
export const maxDuration = 120

/**
 * POST /api/pedro/auto-brief
 *   body: { clientId }
 *
 * Thin wrapper around `generateAutoBrief` (lib). Same logic is also called
 * from the kick-off auto-trigger when a Fathom kick-off lands without an
 * existing Pedro brief - see src/lib/pedro/auto-trigger.ts.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let clientId: string
  try {
    const body = await req.json()
    clientId = String(body.clientId ?? "")
    if (!clientId) {
      return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  try {
    const { brief, meta } = await generateAutoBrief(supabase, clientId)
    return NextResponse.json({
      brief,
      meta: {
        hasKickoffUpdate: meta.hasKickoffUpdate,
        hasLatestEval: meta.hasLatestEval,
        hasKickoffMeeting: meta.hasKickoffMeeting,
        monthlyUpdateCount: meta.monthlyUpdateCount,
        hasTrengo: meta.hasTrengo,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Auto-brief mislukt"
    const status = msg.includes("niet gevonden") ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
