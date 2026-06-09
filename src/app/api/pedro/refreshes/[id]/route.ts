import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/pedro/refreshes/[id]
 *
 * Returns the full envelope for one historical refresh, in the same shape
 * the live `creative-refresh` POST returns. The RefreshHistoryPanel calls
 * this when the AM clicks a row, then feeds the result into the existing
 * RefreshShell render path. No regeneration, no Anthropic call.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  try {
    const supabase = await createAdminClient()
    const { data, error } = await supabase
      .from("pedro_refreshes")
      .select(
        "id, client_id, stage, generated_at, window_start, window_end, window_days, envelope, saved_to_inbox_event_id, saved_to_drive_file_id, saved_to_drive_url",
      )
      .eq("id", id)
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: "Refresh not found" }, { status: 404 })

    // Look up the client name from the clients table so the envelope is
    // self-contained — same shape the live POST returns.
    const { data: clientRow } = await supabase
      .from("clients")
      .select("name")
      .eq("monday_item_id", data.client_id)
      .maybeSingle()

    type Envelope = {
      stats?: unknown
      trend?: unknown
      summary?: string
      proposals?: unknown[]
      warnings?: string[]
    }
    const env = (data.envelope ?? {}) as Envelope

    // Reconstruct the same response shape as POST /creative-refresh so the
    // UI doesn't need a separate render path for live vs historical.
    return NextResponse.json({
      mode: "iterate-winners",
      refreshId: data.id,
      clientId: data.client_id,
      clientName: clientRow?.name ?? data.client_id,
      window: {
        start: data.window_start,
        end: data.window_end,
        days: data.window_days,
      },
      stats: env.stats ?? {},
      trend: env.trend ?? {},
      proposals: env.proposals ?? [],
      summary: env.summary ?? "",
      warnings: env.warnings ?? [],
      // Status flags for the inbox/drive save buttons — UI shows
      // "Already saved" instead of the action button when set.
      savedToInboxEventId: data.saved_to_inbox_event_id ?? null,
      savedToDriveFileId: data.saved_to_drive_file_id ?? null,
      savedToDriveUrl: data.saved_to_drive_url ?? null,
    })
  } catch (e) {
    console.error(
      "[pedro/refreshes/:id] read failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load refresh" },
      { status: 500 },
    )
  }
}
