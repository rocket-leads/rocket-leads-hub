import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

export type ProposalFeedbackStatus = "done" | "later" | "skip"

export type ProposalFeedbackRow = {
  id: string
  insight_fingerprint: string
  insight_type: "positive" | "warning" | "critical" | "action"
  insight_title: string
  insight_action: string | null
  insight_detail: string | null
  status: ProposalFeedbackStatus
  feedback_note: string | null
  snoozed_until: string | null
  created_at: string
}

const LATER_SNOOZE_DAYS = 7

// GET — return feedback history for this client.
// Active items (still hiding insights) come back by default.
// Pass ?all=1 to also include historical resolved entries (for the AI prompt).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const includeAll = req.nextUrl.searchParams.get("all") === "1"

  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", mondayItemId)
    .single()

  if (!client) return NextResponse.json({ feedback: [] })

  const query = supabase
    .from("proposal_feedback")
    .select("id, insight_fingerprint, insight_type, insight_title, insight_action, insight_detail, status, feedback_note, snoozed_until, created_at")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })

  const { data } = includeAll ? await query.limit(50) : await query.limit(100)

  return NextResponse.json({ feedback: (data ?? []) as ProposalFeedbackRow[] })
}

// POST — record / update feedback for an insight.
type PostBody = {
  insightFingerprint: string
  insightType: "positive" | "warning" | "critical" | "action"
  insightTitle: string
  insightAction?: string | null
  insightDetail?: string | null
  status: ProposalFeedbackStatus
  feedbackNote?: string | null
  kpiSnapshot?: unknown
  contextSnapshot?: unknown
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const body: PostBody = await req.json()

  if (!body.insightFingerprint || !body.status || !body.insightTitle || !body.insightType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", mondayItemId)
    .single()

  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 })

  const snoozedUntil =
    body.status === "later"
      ? new Date(Date.now() + LATER_SNOOZE_DAYS * 24 * 60 * 60 * 1000).toISOString()
      : null

  const { error } = await supabase
    .from("proposal_feedback")
    .upsert(
      {
        client_id: client.id,
        monday_item_id: mondayItemId,
        insight_fingerprint: body.insightFingerprint,
        insight_type: body.insightType,
        insight_title: body.insightTitle,
        insight_action: body.insightAction ?? null,
        insight_detail: body.insightDetail ?? null,
        status: body.status,
        feedback_note: body.feedbackNote ?? null,
        snoozed_until: snoozedUntil,
        kpi_snapshot: body.kpiSnapshot ?? null,
        context_snapshot: body.contextSnapshot ?? null,
        resolved_by: session.user.id,
        created_at: new Date().toISOString(),
      },
      { onConflict: "client_id,insight_fingerprint" },
    )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// DELETE — remove feedback (e.g. user clicked the same status to undo).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const fingerprint = req.nextUrl.searchParams.get("fingerprint")
  if (!fingerprint) return NextResponse.json({ error: "fingerprint required" }, { status: 400 })

  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", mondayItemId)
    .single()

  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 })

  await supabase
    .from("proposal_feedback")
    .delete()
    .eq("client_id", client.id)
    .eq("insight_fingerprint", fingerprint)

  return NextResponse.json({ ok: true })
}
