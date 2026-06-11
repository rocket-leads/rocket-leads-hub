import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import type { CopilotAction, CopilotDraft, CopilotDraftStatus } from "@/lib/copilot/tools"

/**
 * Active drafts for the bell - ready + failed + pending only. Approved
 * and dismissed drafts stay in the table for audit but are filtered out.
 *
 * Ordered newest-ready-first so the most recent ✨ work shows on top.
 * Pending drafts come last (they're still spinning).
 */

type Row = {
  id: string
  input: string
  status: CopilotDraftStatus
  draft_action: CopilotAction | null
  summary: string | null
  sources_used: string[] | null
  error: string | null
  created_at: string
  ready_at: string | null
  completed_at: string | null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("copilot_drafts")
    .select(
      "id, input, status, draft_action, summary, sources_used, error, created_at, ready_at, completed_at",
    )
    .eq("user_id", session.user.id)
    .in("status", ["pending", "ready", "failed"])
    .order("ready_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const drafts: CopilotDraft[] = (data as Row[] | null ?? []).map((r) => ({
    id: r.id,
    input: r.input,
    status: r.status,
    draftAction: r.draft_action,
    summary: r.summary,
    sourcesUsed: r.sources_used ?? [],
    error: r.error,
    createdAt: r.created_at,
    readyAt: r.ready_at,
    completedAt: r.completed_at,
  }))

  return NextResponse.json({ drafts })
}
