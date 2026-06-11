import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { updateTrengoContactName } from "@/lib/integrations/trengo"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * PATCH /api/inbox/threads/{threadKey}/contact
 *
 * Body: `{ name: string }` - updates the Trengo contact's display name.
 * Used by the chat-pane header's editable name affordance: AM clicks the
 * bold contact name (e.g. "+31 6 12345678" or "Unknown"), types the actual
 * name, save propagates to Trengo so every surface (Trengo web UI, future
 * inbound webhooks, other agents) picks it up.
 *
 * threadKey shape for Trengo: `trengo:contact:<id>`. Other sources are
 * rejected - Slack DM "names" are auto-derived from the user object and
 * we don't expose an edit affordance for them.
 *
 * Side effect: bumps `author_name_cached` on existing inbox_events rows
 * for this contact so the new name shows up in the thread list immediately
 * (without waiting for the next inbound to refresh).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ threadKey: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { threadKey: encoded } = await params
  const threadKey = decodeURIComponent(encoded)
  if (!threadKey.startsWith("trengo:contact:")) {
    return NextResponse.json(
      { error: "Editable name is only supported on Trengo contact threads" },
      { status: 400 },
    )
  }
  const contactId = threadKey.replace(/^trengo:contact:/, "")
  if (!contactId) {
    return NextResponse.json({ error: "Missing contact id in threadKey" }, { status: 400 })
  }

  const body = (await req.json().catch(() => null)) as { name?: string } | null
  const name = body?.name?.trim()
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 })
  }
  if (name.length > 200) {
    return NextResponse.json({ error: "name too long (max 200)" }, { status: 400 })
  }

  try {
    const result = await updateTrengoContactName(contactId, name)

    // Mirror the new name into the Hub's cached author names so the thread
    // list shows the updated label immediately. Best-effort - failure here
    // doesn't block the response since the Trengo write already succeeded
    // and the next webhook will reconcile.
    try {
      const supabase = await createAdminClient()
      await supabase
        .from("inbox_events")
        .update({ author_name_cached: name })
        .eq("thread_key", threadKey)
        .neq("author_kind", "rl_team")
    } catch (e) {
      console.error("Failed to update mirrored author_name_cached:", e)
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update contact" },
      { status: 502 },
    )
  }
}
