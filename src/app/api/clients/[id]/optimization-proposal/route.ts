import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import {
  generateProposalForClient,
  loadActiveFingerprints,
  proposalCacheKey,
  PROPOSAL_TTL_MS,
  type CachedProposal,
  type ProposalInput,
} from "@/lib/proposals/generate"
import { NextRequest, NextResponse } from "next/server"

/**
 * GET — fast cached read. Returns the most recent cached proposal for
 * this client (within TTL) with the per-client feedback filter applied.
 * Returns { cached: false } if there's no cache yet — the UI then falls
 * back to a full POST.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const cached = await readCache<CachedProposal>(proposalCacheKey(mondayItemId), PROPOSAL_TTL_MS)
  if (!cached) return NextResponse.json({ cached: false })

  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", mondayItemId)
    .single()

  const activeFingerprints = client ? await loadActiveFingerprints(client.id) : new Set<string>()
  const insights = cached.insights.filter((i) => !i.fingerprint || !activeFingerprints.has(i.fingerprint))

  return NextResponse.json({
    cached: true,
    insights,
    leadAnalysis: cached.leadAnalysis ?? null,
    hasKnowledge: cached.hasKnowledge,
    generatedAt: cached.generatedAt,
  })
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
      insights: result.insights,
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
