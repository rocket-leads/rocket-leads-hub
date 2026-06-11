import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/pedro/refreshes?clientId=X&stage=creatives&limit=10
 *
 * Returns the most recent Pedro refresh runs for a client, oldest-first
 * trimmed. Used by the RefreshHistoryPanel at the top of the Optimize
 * tabs to show "Eerdere refreshes (N)" with click-to-load behaviour.
 *
 * Lightweight projection - only the columns the panel needs to render a
 * row. The full envelope comes from GET /api/pedro/refreshes/[id] when
 * the AM clicks a row.
 */

const VALID_STAGES = new Set(["creatives", "angles", "script", "ad_copy"])

export type RefreshHistoryRow = {
  id: string
  stage: "creatives" | "angles" | "script" | "ad_copy"
  generatedAt: string
  windowStart: string
  windowEnd: string
  windowDays: number
  summarySnippet: string
  winnerCount: number | null
  proposalCount: number
  savedToInbox: boolean
  savedToDrive: boolean
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sp = req.nextUrl.searchParams
  const clientId = sp.get("clientId")
  const stage = sp.get("stage") ?? "creatives"
  const limit = Math.max(1, Math.min(parseInt(sp.get("limit") ?? "10", 10) || 10, 50))

  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 })
  }
  if (!VALID_STAGES.has(stage)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 })
  }

  try {
    const supabase = await createAdminClient()
    const { data, error } = await supabase
      .from("pedro_refreshes")
      .select(
        "id, stage, generated_at, window_start, window_end, window_days, envelope, saved_to_inbox_event_id, saved_to_drive_file_id",
      )
      .eq("client_id", clientId)
      .eq("stage", stage)
      .order("generated_at", { ascending: false })
      .limit(limit)

    if (error) throw error

    type Row = {
      id: string
      stage: RefreshHistoryRow["stage"]
      generated_at: string
      window_start: string
      window_end: string
      window_days: number
      envelope: {
        summary?: string
        proposals?: unknown[]
        stats?: { winnerCount?: number }
      }
      saved_to_inbox_event_id: string | null
      saved_to_drive_file_id: string | null
    }

    const rows: RefreshHistoryRow[] = ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      stage: r.stage,
      generatedAt: r.generated_at,
      windowStart: r.window_start,
      windowEnd: r.window_end,
      windowDays: r.window_days,
      summarySnippet: (r.envelope?.summary ?? "").slice(0, 240),
      winnerCount:
        typeof r.envelope?.stats?.winnerCount === "number"
          ? r.envelope.stats.winnerCount
          : null,
      proposalCount: Array.isArray(r.envelope?.proposals) ? r.envelope.proposals.length : 0,
      savedToInbox: r.saved_to_inbox_event_id != null,
      savedToDrive: r.saved_to_drive_file_id != null,
    }))

    return NextResponse.json({ refreshes: rows })
  } catch (e) {
    console.error(
      "[pedro/refreshes] list failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load refreshes" },
      { status: 500 },
    )
  }
}
