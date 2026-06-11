import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { parsePedroBody } from "@/lib/pedro/insights/types"
import { NextRequest, NextResponse } from "next/server"

/**
 * Watchlist AI Notes - facade over pedro_insights.
 *
 * Post Pedro-v2 unification we read `client_pedro` (JSON body with conclusion +
 * actions) and return just the conclusion sentence as the 1-line note. This
 * guarantees the Watch List 1-liner is aligned with the full Pedro card on the
 * client detail page - they're literally the same generation.
 *
 * The request shape is unchanged so callers (watchlist-dashboard.tsx) don't
 * have to change.
 */

type ClientInput = {
  id: string
  name?: string
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { clients?: ClientInput[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({}, { status: 400 })
  }

  const ids = Array.from(
    new Set((body.clients ?? []).map((c) => c.id).filter((id): id is string => !!id)),
  )
  if (ids.length === 0) return NextResponse.json({})

  try {
    const supabase = await createAdminClient()
    const { data, error } = await supabase
      .from("pedro_insights")
      .select("monday_item_id, body")
      .eq("insight_type", "client_pedro")
      .in("monday_item_id", ids)

    if (error) {
      console.error("[watchlist-summaries] read failed:", error.message)
      return NextResponse.json({})
    }

    const result: Record<string, string> = {}
    for (const row of data ?? []) {
      const parsed = parsePedroBody(row.body)
      if (parsed?.conclusion) result[row.monday_item_id] = parsed.conclusion
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
    })
  } catch (e) {
    console.error(
      "[watchlist-summaries] facade read failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json({})
  }
}
