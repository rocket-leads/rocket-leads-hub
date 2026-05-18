import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

/**
 * Patch a weekly-update draft's status — used by the Client Update dialog
 * after a successful send (status: 'sent') and by the queue overlay when
 * the AM dismisses a draft without sending (status: 'dismissed').
 *
 * No transition validation beyond the CHECK constraint at the table level;
 * we just write the requested status + stamp the matching `*_at` /
 * `*_by_user_id` columns so the audit trail stays complete.
 */

type PatchBody = {
  status?: "sent" | "dismissed"
  /** Trengo outbound message id — only populated on `sent` (mirrors the
   *  trengo_message_id we log in client_updates). */
  sentMessageId?: string
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as PatchBody
  const status = body.status

  if (status !== "sent" && status !== "dismissed") {
    return NextResponse.json(
      { error: "status must be 'sent' or 'dismissed'" },
      { status: 400 },
    )
  }

  const supabase = await createAdminClient()
  const nowIso = new Date().toISOString()

  const update: Record<string, unknown> = { status }
  if (status === "sent") {
    update.sent_at = nowIso
    update.sent_by_user_id = session.user.id
    if (body.sentMessageId) update.sent_message_id = body.sentMessageId
  } else {
    update.dismissed_at = nowIso
    update.dismissed_by_user_id = session.user.id
  }

  const { error } = await supabase
    .from("weekly_update_drafts")
    .update(update)
    .eq("id", id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
