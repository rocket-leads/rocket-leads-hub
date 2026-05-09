import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

/**
 * Watchlist AI Notes — facade over pedro_insights.
 *
 * Pre-Pedro-unification this endpoint had its own Anthropic call, its own
 * cache key (watchlist_summaries_v8), its own copy of the guardrail rules.
 * Post-unification it's a thin read: the cron at /api/cron/refresh-pedro-
 * insights is the single Claude pipeline, persisting insight_type =
 * "watchlist_action_note" rows; this endpoint just looks them up by
 * monday_item_id.
 *
 * The request shape stays the same so callers (watchlist-dashboard.tsx)
 * don't have to change. Internally we ignore most of the rich context
 * the caller used to send — that data is now collected server-side by
 * the cron's collectClientAiContext().
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
      .eq("insight_type", "watchlist_action_note")
      .in("monday_item_id", ids)

    if (error) {
      console.error("[watchlist-summaries] read failed:", error.message)
      return NextResponse.json({})
    }

    const result: Record<string, string> = {}
    for (const row of data ?? []) {
      if (row.body) result[row.monday_item_id] = row.body
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
