import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Pedro campaigns - named campaign containers per client.
 *
 * GET  /api/pedro/campaigns?clientId=X[&includeArchived=1]
 *      → list of campaigns for that client, most-recently-used first.
 *
 * POST /api/pedro/campaigns
 *      body: { clientId, name? }
 *      → creates the next campaign (campaign_number = max + 1) with
 *        the given name (or default "Campagne N" when omitted).
 */

export type PedroCampaign = {
  id: string
  client_id: string
  campaign_number: number
  name: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  last_used_at: string
  archived_at: string | null
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const clientId = req.nextUrl.searchParams.get("clientId")
  const includeArchived = req.nextUrl.searchParams.get("includeArchived") === "1"

  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  // ── Self-heal: enforce the invariant "every saved version / draft has
  // a campaign". Roy 2026-05-23: spotted a client (Financial Planner)
  // showing "v5" in the stage bar while the campaign picker said "no
  // campaign yet". Causes: (a) initial backfill in the migration didn't
  // run yet on this DB, or (b) saves happened on a client whose
  // pedro_campaigns row was archived/deleted manually. Either way,
  // versions without campaigns are nonsense - auto-create the
  // corresponding "Campagne N" row so the picker always reflects reality. ──
  const [{ data: savedTuples }, { data: draftTuples }] = await Promise.all([
    supabase
      .from("pedro_stage_versions")
      .select("campaign_number")
      .eq("client_id", clientId),
    supabase
      .from("pedro_client_state")
      .select("campaign_number")
      .eq("client_id", clientId),
  ])

  const referencedNumbers = new Set<number>()
  for (const r of savedTuples ?? []) {
    if (typeof r.campaign_number === "number") referencedNumbers.add(r.campaign_number)
  }
  for (const r of draftTuples ?? []) {
    if (typeof r.campaign_number === "number") referencedNumbers.add(r.campaign_number)
  }

  if (referencedNumbers.size > 0) {
    const { data: existing } = await supabase
      .from("pedro_campaigns")
      .select("campaign_number")
      .eq("client_id", clientId)
    const existingNumbers = new Set((existing ?? []).map((r) => r.campaign_number))
    const missing = Array.from(referencedNumbers).filter((n) => !existingNumbers.has(n))
    if (missing.length > 0) {
      // Bulk-insert the missing campaign rows. `Campagne N` is the default
      // name - the CM can rename via the picker's pencil. last_used_at /
      // created_at default to now() which is fine; the saved-versions /
      // draft history isn't retroactively dated.
      await supabase.from("pedro_campaigns").insert(
        missing.map((n) => ({
          client_id: clientId,
          campaign_number: n,
          name: `Campagne ${n}`,
        })),
      )
    }
  }

  let query = supabase
    .from("pedro_campaigns")
    .select("id, client_id, campaign_number, name, notes, created_by, created_at, last_used_at, archived_at")
    .eq("client_id", clientId)
    .order("last_used_at", { ascending: false })

  if (!includeArchived) {
    query = query.is("archived_at", null)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ campaigns: (data ?? []) as PedroCampaign[] })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { clientId?: string; name?: string; notes?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const clientId = String(body.clientId ?? "").trim()
  const name = body.name?.trim() || null
  const notes = body.notes?.trim() || null

  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  // Next campaign_number for this client. Inclusive of archived rows so
  // numbering stays monotonic over the lifetime of a client (no reuse).
  const { data: maxRow } = await supabase
    .from("pedro_campaigns")
    .select("campaign_number")
    .eq("client_id", clientId)
    .order("campaign_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ campaign_number: number }>()

  const nextNumber = (maxRow?.campaign_number ?? 0) + 1
  const finalName = name ?? `Campagne ${nextNumber}`

  const { data: inserted, error } = await supabase
    .from("pedro_campaigns")
    .insert({
      client_id: clientId,
      campaign_number: nextNumber,
      name: finalName,
      notes,
      created_by: session.user.id ?? null,
    })
    .select("id, client_id, campaign_number, name, notes, created_by, created_at, last_used_at, archived_at")
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ campaign: inserted as PedroCampaign })
}
