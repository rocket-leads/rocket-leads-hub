import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import type { VerticalPatternRow } from "@/lib/pedro/vertical-patterns"

/**
 * GET /api/pedro/insights
 *
 * Returns every entry in pedro_vertical_patterns sorted by sample size
 * desc — verticals with the most data first. Powers the Pedro Insights
 * tab where the team can browse "what works in branche X" without
 * leaving Pedro.
 *
 * Auth: any logged-in hub user. The data is anonymised at write-time
 * (sourceClientName is in the row but never rendered in UI — UI
 * deliberately hides it). Admin-vs-member gating not needed.
 */
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("pedro_vertical_patterns")
    .select("*")
    .order("sample_size", { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const verticals = (data ?? []) as unknown as VerticalPatternRow[]

  return NextResponse.json({
    verticals,
    summary: {
      verticalCount: verticals.length,
      totalWinners: verticals.reduce((s, v) => s + v.sample_size, 0),
      totalClients: new Set(
        verticals.flatMap((v) => v.top_winners.map((w) => w.sourceClientName)),
      ).size,
      lastRefreshed: verticals[0]?.refreshed_at ?? null,
    },
  })
}
