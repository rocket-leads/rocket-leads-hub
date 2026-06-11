import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/inbox/threads/{threadKey}/subject
 *
 * Returns the latest ticket subject for a Trengo thread, used by the email
 * composer to prefill the Subject field with `Re: <original>` so the AM
 * gets the same affordance as a normal mail client (just edit if needed,
 * don't re-type from scratch).
 *
 * Source: the latest inbox_events row's `raw` payload - Trengo webhooks
 * include the email subject under `email_message.subject` (or `subject` at
 * the top level depending on event shape). We avoid an extra Trengo
 * round-trip by reading from the cached webhook data.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ threadKey: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { threadKey: encoded } = await params
  const threadKey = decodeURIComponent(encoded)
  if (!threadKey) {
    return NextResponse.json({ error: "threadKey required" }, { status: 400 })
  }

  try {
    const supabase = await createAdminClient()
    // Walk events newest-first; first one with a subject wins. Limit to a
    // small window so we don't scan the whole thread for old conversations.
    const { data } = await supabase
      .from("inbox_events")
      .select("raw, title")
      .eq("thread_key", threadKey)
      .order("created_at", { ascending: false })
      .limit(20)

    let subject: string | null = null
    for (const row of (data ?? []) as Array<{
      raw: Record<string, unknown> | null
      title: string | null
    }>) {
      const fromRaw = extractSubject(row.raw)
      if (fromRaw) {
        subject = fromRaw
        break
      }
    }
    return NextResponse.json({ subject })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load subject" },
      { status: 500 },
    )
  }
}

/** Walk a few common shapes Trengo's webhook payloads use to surface the
 *  email subject. Returns the first non-empty hit. */
function extractSubject(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null
  const candidates: unknown[] = []
  // Direct
  candidates.push(raw.subject)
  // Ticket envelope
  const ticket = raw.ticket as Record<string, unknown> | undefined
  if (ticket) candidates.push(ticket.subject)
  // Email message envelope (matches the shape we observed in the Phase 0 audit)
  const em = raw.email_message as Record<string, unknown> | undefined
  if (em) candidates.push(em.subject)
  // Message envelope
  const msg = raw.message as Record<string, unknown> | undefined
  if (msg) {
    candidates.push(msg.subject)
    const mEm = msg.email_message as Record<string, unknown> | undefined
    if (mEm) candidates.push(mEm.subject)
  }
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim()
  }
  return null
}
