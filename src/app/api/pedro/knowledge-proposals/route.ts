import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Pedro knowledge proposals - list + decide endpoints.
 * Admin-only.
 *
 * GET  /api/pedro/knowledge-proposals?status=pending|accepted|rejected
 *   → list of proposals
 *
 * POST /api/pedro/knowledge-proposals
 *   body: { id, decision: "accepted" | "rejected", note? }
 *   → flips status + records decision metadata. Knowledge file edits
 *     are STILL manual - accepting just acknowledges Roy reviewed and
 *     plans to integrate; rejecting closes the loop without action.
 */

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 })
  }

  const status = req.nextUrl.searchParams.get("status") ?? "pending"
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("pedro_knowledge_proposals")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ proposals: data ?? [] })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 })
  }

  let body: { id?: string; decision?: string; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body.id || (body.decision !== "accepted" && body.decision !== "rejected")) {
    return NextResponse.json(
      { error: "id + decision (accepted|rejected) required" },
      { status: 400 },
    )
  }

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("pedro_knowledge_proposals")
    .update({
      status: body.decision,
      decided_at: new Date().toISOString(),
      decided_by: session.user.id ?? null,
      decision_note: body.note ?? null,
    })
    .eq("id", body.id)
    .eq("status", "pending")
    .select("id, inbox_task_id")
    .maybeSingle<{ id: string; inbox_task_id: string | null }>()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) {
    return NextResponse.json({ error: "Proposal not found or already decided" }, { status: 404 })
  }

  // Close the linked inbox task (if any) so the reviewer's queue clears.
  if (data.inbox_task_id) {
    await supabase
      .from("inbox_events")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", data.inbox_task_id)
      .eq("status", "open")
  }

  return NextResponse.json({ ok: true })
}
