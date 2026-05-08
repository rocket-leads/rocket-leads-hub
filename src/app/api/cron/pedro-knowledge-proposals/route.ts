import { NextRequest, NextResponse } from "next/server"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { createAdminClient } from "@/lib/supabase/server"
import { runKnowledgeProposalScan } from "@/lib/pedro/knowledge-proposals"

/**
 * GET /api/cron/pedro-knowledge-proposals
 *
 * Weekly scan: detect verticals where ≥5 winners across ≥3 distinct
 * clients converge on an angle/hook that isn't yet in knowledge/
 * campaigns.md. Pedro composes a proposed addition. A pending row is
 * inserted in pedro_knowledge_proposals + an inbox task lands on Roy
 * (admin) to review.
 *
 * Knowledge-file edits are manual. Auto-write is too risky — every
 * line in campaigns.md is loaded into every Pedro AI call.
 */

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = await createAdminClient()
  try {
    const result = await runKnowledgeProposalScan(supabase)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error("Pedro knowledge proposal cron failed:", e)
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 },
    )
  }
}
