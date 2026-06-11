import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import {
  generateProposalForClient,
  PROPOSAL_TTL_MS,
  type CachedProposal,
  type ProposalInput,
} from "@/lib/proposals/generate"
import { NextRequest, NextResponse } from "next/server"

/**
 * Pre-Pedro-unification this read from a separate `client_proposal_v3:{id}`
 * cache_store entry. Now the structured proposal lives in pedro_insights as
 * a row with insight_type = "client_optimisation_full" - the same table
 * that backs all per-client AI surfaces.
 *
 * GET = fast path. Reads pedro_insights and returns the parsed body. No
 * Anthropic call. UI falls back to POST when this returns { cached: false }.
 */
const PROPOSAL_INSIGHT_TYPE = "client_optimisation_full"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params

  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from("pedro_insights")
      .select("body, generated_at")
      .eq("monday_item_id", mondayItemId)
      .eq("insight_type", PROPOSAL_INSIGHT_TYPE)
      .maybeSingle()

    if (!data?.body) return NextResponse.json({ cached: false })
    const ageMs = Date.now() - new Date(data.generated_at).getTime()
    if (ageMs > PROPOSAL_TTL_MS) return NextResponse.json({ cached: false })

    let parsed: Partial<CachedProposal>
    try {
      parsed = JSON.parse(data.body) as Partial<CachedProposal>
    } catch {
      // Corrupt row - surface as cache-miss so the UI re-runs POST.
      return NextResponse.json({ cached: false })
    }

    return NextResponse.json({
      cached: true,
      proposals: parsed.proposals ?? [],
      leadAnalysis: parsed.leadAnalysis ?? null,
      hasKnowledge: parsed.hasKnowledge ?? false,
      generatedAt: parsed.generatedAt ?? data.generated_at,
    })
  } catch (e) {
    console.error(
      "[optimization-proposal] read failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json({ cached: false })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const force = req.nextUrl.searchParams.get("force") === "1"
  const body = (await req.json()) as Omit<ProposalInput, "mondayItemId">

  try {
    const result = await generateProposalForClient(
      { mondayItemId, ...body },
      { force },
    )
    return NextResponse.json({
      proposals: result.proposals,
      leadAnalysis: result.leadAnalysis,
      hasKnowledge: result.hasKnowledge,
      generatedAt: result.generatedAt,
      cached: result.fromCache,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("AI proposal error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
