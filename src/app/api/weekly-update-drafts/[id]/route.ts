import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import type { EditableParts } from "@/lib/clients/client-update-template"
import { NextRequest, NextResponse } from "next/server"

/**
 * Patch a weekly-update draft. Three flavours:
 *
 *   1. `status: "sent"`      — after the Trengo template send succeeded.
 *      Stamps `sent_at` + `sent_by_user_id`, optionally `sent_message_id`.
 *   2. `status: "dismissed"` — when the AM skips this draft for the week.
 *      Stamps `dismissed_at` + `dismissed_by_user_id`.
 *   3. `parts: EditableParts` — autosave from the queue editor. The cron
 *      pre-generated the draft; once the AM tweaks anything in the
 *      composer we persist those edits so navigating away (closing the
 *      sheet, switching drafts, hard refresh) doesn't lose them.
 *
 * Status + parts can be sent together (e.g., final edit + send) but in
 * practice the autosave fires on its own debounce.
 */

type PatchBody = {
  status?: "sent" | "dismissed"
  /** Trengo outbound message id — only populated on `sent` (mirrors the
   *  trengo_message_id we log in client_updates). */
  sentMessageId?: string
  /** Replacement EditableParts snapshot for autosave. Server overwrites
   *  the whole `parts` column — partial merges aren't supported (the
   *  composer always ships the full edited snapshot). */
  parts?: EditableParts
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

  // Reject the no-op call early so the client can fall back to a local
  // "nothing changed" path without the round-trip.
  if (!status && !body.parts) {
    return NextResponse.json(
      { error: "PATCH requires `status` and/or `parts`" },
      { status: 400 },
    )
  }
  if (status && status !== "sent" && status !== "dismissed") {
    return NextResponse.json(
      { error: "status must be 'sent' or 'dismissed'" },
      { status: 400 },
    )
  }

  const supabase = await createAdminClient()
  const nowIso = new Date().toISOString()

  const update: Record<string, unknown> = {}
  if (body.parts) {
    update.parts = body.parts
  }
  if (status === "sent") {
    update.status = status
    update.sent_at = nowIso
    update.sent_by_user_id = session.user.id
    if (body.sentMessageId) update.sent_message_id = body.sentMessageId
  } else if (status === "dismissed") {
    update.status = status
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
