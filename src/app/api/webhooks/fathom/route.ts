import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { verifyFathomWebhook, type FathomMeeting } from "@/lib/integrations/fathom"
import { ingestFathomMeeting } from "@/lib/meetings/ingest"

export const maxDuration = 60

/**
 * Fathom `new-meeting-content-ready` webhook receiver.
 *
 * Auth: Svix-style HMAC-SHA256 - we verify against `FATHOM_WEBHOOK_SECRET`
 * (env var, set to the `whsec_…` secret Fathom shows when you create the
 * webhook in Settings → API Access).
 *
 * Behavior: dedupes on `fathom_recording_id` (Fathom retries failed deliveries)
 * and inserts a row into `meetings` with `link_status='unlinked'` (or
 * `'internal'` when the call had no external attendees). Client-matching is
 * NOT done here - that lives in the matcher (C.5.b) so backfills + manual
 * triggers go through the same code path.
 *
 * Meeting type IS classified inline because it depends only on title +
 * recorded_by.team, which are stable at ingest time.
 */
export async function POST(req: NextRequest) {
  // RAW body required for signature verification (must run before JSON.parse).
  const rawBody = await req.text()

  const secret = process.env.FATHOM_WEBHOOK_SECRET
  if (!secret) {
    console.error("Fathom webhook hit but FATHOM_WEBHOOK_SECRET is not set")
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 })
  }

  const headers = {
    "webhook-id": req.headers.get("webhook-id") ?? "",
    "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": req.headers.get("webhook-signature") ?? "",
  }
  if (!verifyFathomWebhook(secret, headers, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  let payload: FathomMeeting
  try {
    payload = JSON.parse(rawBody) as FathomMeeting
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  // Same Hub-user fallback the admin backfill uses: a webhook delivery
  // for an AM's personal Google Meet (no team tag) still gets ingested
  // when the host email matches a Hub user. Roy 2026-06-11.
  const { data: userRows } = await supabase
    .from("users")
    .select("email")
    .not("email", "is", null)
  const allowedEmails = new Set<string>(
    (userRows ?? [])
      .map((r) => (r.email ?? "").toLowerCase().trim())
      .filter(Boolean),
  )
  const result = await ingestFathomMeeting(supabase, payload, { allowedEmails })

  if (!result.ok) {
    console.error("Fathom webhook ingest failed:", result.error)
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }
  return NextResponse.json(result)
}
