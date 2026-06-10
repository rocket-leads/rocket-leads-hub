import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Pedro creative feedback capture + lookup.
 *
 * POST: log a feedback row (explicit CM note, prompt edit, regen, upload).
 *       Used by:
 *         - the variant-image-panel "Geef feedback" button (type=explicit)
 *         - the generate-image route when promptOverride is passed
 *           (type=prompt_edit, fired server-side)
 *         - the upload-image route when CM uploads their own (type=upload)
 *
 * GET ?clientId=... : recent feedback (last 90d, capped at 20 rows) for
 *       the creative-refresh prompt's "klant-feedback patronen" block.
 *
 * Roy 2026-06-10: per knowledge/campaigns.md §Image Creative Principles
 * #5 ("Feedback-loop: CM iteraties verbreden Pedro's knowledge base").
 */

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: {
    clientId?: string
    variantId?: string
    variantImagePosition?: number
    refreshId?: string
    feedbackType?: "explicit" | "prompt_edit" | "regen" | "upload"
    feedbackText?: string
  } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const clientId = body.clientId?.trim()
  const feedbackType = body.feedbackType
  const feedbackText = body.feedbackText?.trim()

  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }
  if (!feedbackType || !["explicit", "prompt_edit", "regen", "upload"].includes(feedbackType)) {
    return NextResponse.json({ error: "Ongeldig feedbackType" }, { status: 400 })
  }
  if (!feedbackText) {
    return NextResponse.json({ error: "feedbackText is verplicht" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  try {
    const { data, error } = await supabase
      .from("pedro_creative_feedback")
      .insert({
        client_id: clientId,
        variant_id: body.variantId ?? null,
        variant_image_position:
          typeof body.variantImagePosition === "number" ? body.variantImagePosition : null,
        refresh_id: body.refreshId ?? null,
        feedback_type: feedbackType,
        feedback_text: feedbackText.slice(0, 2000),
        created_by_email: session.user.email ?? null,
      })
      .select("id")
      .single()
    if (error) throw error
    return NextResponse.json({ id: data.id, ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Insert failed" },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const clientId = url.searchParams.get("clientId")?.trim()
  const limit = Math.max(
    1,
    Math.min(50, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
  )
  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  // Last 90 days. Older entries stay in the table for analytics but
  // don't carry weight for the prompt-injection block.
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString()

  const { data, error } = await supabase
    .from("pedro_creative_feedback")
    .select("id, feedback_type, feedback_text, created_at, created_by_email, variant_image_position")
    .eq("client_id", clientId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ feedback: data ?? [] })
}
