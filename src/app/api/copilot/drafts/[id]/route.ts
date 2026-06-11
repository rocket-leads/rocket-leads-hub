import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { broadcastInvalidate } from "@/lib/realtime/broadcast"
import { NextRequest, NextResponse } from "next/server"
import type { CopilotAction, CopilotDraftStatus } from "@/lib/copilot/tools"

/**
 * Draft mutations. Three transitions the UI cares about:
 *
 *   PATCH { action }                - user edited fields before approving;
 *                                     stores the patched action without
 *                                     changing status.
 *   PATCH { status: 'approved' }    - executor ran successfully client-side;
 *                                     hide from bell.
 *   PATCH { status: 'dismissed' }   - user threw the draft away.
 *
 * The executor runs CLIENT-SIDE (router.push for navigate, fetch to the
 * inbox/pedro routes for the others), so the server here just records
 * the terminal state. Decoupling keeps the navigate action working
 * without a server router.
 */

type Body = {
  action?: CopilotAction
  status?: Extract<CopilotDraftStatus, "approved" | "dismissed">
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await ctx.params

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body.action && !body.status) {
    return NextResponse.json({ error: "Provide action or status" }, { status: 400 })
  }
  if (body.status && body.status !== "approved" && body.status !== "dismissed") {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  // Scope mutations to the owner - RLS would also catch this but the
  // explicit filter keeps the response code accurate (404 vs 403).
  const patch: Record<string, unknown> = {}
  if (body.action) patch.draft_action = body.action
  if (body.status) {
    patch.status = body.status
    patch.completed_at = new Date().toISOString()
  }

  const { error, data } = await supabase
    .from("copilot_drafts")
    .update(patch)
    .eq("id", id)
    .eq("user_id", session.user.id)
    .select("id, status")
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Draft not found" }, { status: 404 })

  // Status change → tell every open tab to refetch.
  if (body.status) {
    await broadcastInvalidate(["copilot-drafts"])
  }

  return NextResponse.json({ ok: true })
}
