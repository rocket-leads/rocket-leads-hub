import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * PATCH /api/pedro/campaigns/:id
 *   body: { name?, notes?, touch?, archived? }
 *
 * Single endpoint for renaming, editing notes, bumping last_used_at
 * (the picker calls this with `touch: true` whenever a campaign
 * becomes active), and soft-archiving.
 */

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: "id is verplicht" }, { status: 400 })

  let body: { name?: string; notes?: string; touch?: boolean; archived?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (typeof body.name === "string") update.name = body.name.trim() || null
  if (typeof body.notes === "string") update.notes = body.notes.trim() || null
  if (body.touch) update.last_used_at = new Date().toISOString()
  if (typeof body.archived === "boolean") {
    update.archived_at = body.archived ? new Date().toISOString() : null
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Geen velden om te updaten" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("pedro_campaigns")
    .update(update)
    .eq("id", id)
    .select("id, client_id, campaign_number, name, notes, created_by, created_at, last_used_at, archived_at")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ campaign: data })
}
