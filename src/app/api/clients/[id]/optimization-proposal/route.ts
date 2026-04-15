import { auth } from "@/lib/auth"
import { readCache } from "@/lib/cache"
import {
  generateProposalForClient,
  proposalCacheKey,
  PROPOSAL_TTL_MS,
  type ProposalInput,
} from "@/lib/proposals/generate"
import { NextRequest, NextResponse } from "next/server"

/**
 * GET — fast cached read. Returns the most recent cached proposal for
 * this client (within TTL). Returns { cached: false } if there's no
 * cache yet — the UI then falls back to a full POST.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cached = await readCache<any>(proposalCacheKey(mondayItemId), PROPOSAL_TTL_MS)
  if (!cached) return NextResponse.json({ cached: false })

  // Backward compat: old cache entries have "insights" instead of "proposals"
  const proposals = cached.proposals ?? cached.insights ?? []

  return NextResponse.json({
    cached: true,
    proposals,
    leadAnalysis: cached.leadAnalysis ?? null,
    hasKnowledge: cached.hasKnowledge ?? false,
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
