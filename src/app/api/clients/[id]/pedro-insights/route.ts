import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import type { InsightType } from "@/lib/pedro/insights/types"

/**
 * Per-client Pedro insights — facade reader over the unified pedro_insights
 * table. Returns whatever insight types have been generated for the client.
 *
 * The slide-over fetches this in parallel with the client metadata so a
 * single panel render gets KPI + Pedro insights + access flags without
 * additional round-trips.
 *
 * Response shape:
 *   { insights: { [insight_type]: { body, severity, generated_at, prompt_version } } }
 *
 * No-data clients (or clients the cron hasn't reached yet) return
 * { insights: {} } — caller hides the panel rather than rendering empty.
 */

export type PedroInsightRecord = {
  body: string
  severity: string | null
  generatedAt: string
  promptVersion: number
}

export type PedroClientInsightsResponse = {
  insights: Partial<Record<InsightType, PedroInsightRecord>>
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params

  try {
    const supabase = await createAdminClient()
    const { data, error } = await supabase
      .from("pedro_insights")
      .select("insight_type, body, severity, generated_at, prompt_version")
      .eq("monday_item_id", mondayItemId)

    if (error) {
      console.error("[pedro-insights] read failed:", error.message)
      return NextResponse.json<PedroClientInsightsResponse>({ insights: {} })
    }

    const insights: PedroClientInsightsResponse["insights"] = {}
    for (const row of data ?? []) {
      insights[row.insight_type as InsightType] = {
        body: row.body,
        severity: row.severity ?? null,
        generatedAt: row.generated_at,
        promptVersion: row.prompt_version,
      }
    }

    return NextResponse.json<PedroClientInsightsResponse>(
      { insights },
      { headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" } },
    )
  } catch (e) {
    console.error(
      "[pedro-insights] facade read failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json<PedroClientInsightsResponse>({ insights: {} })
  }
}
