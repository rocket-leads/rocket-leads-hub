import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Pedro saved versions — explicit "Save final version" snapshots per
 * stage. Layer 2 of the two-layer storage model (drafts in
 * pedro_client_state, versions here).
 *
 * GET /api/pedro/saved-versions?clientId=X&stage=Y[&campaignNumber=Z]
 *   → list of versions for that stage, newest first
 *
 * POST /api/pedro/saved-versions
 *   body: { clientId, stage, data, label?, campaignNumber? }
 *   → creates a new version row with auto-incremented version_number
 *     for (client_id, campaign_number, stage). Returns the inserted row.
 */

const VALID_STAGES = new Set([
  "brief",
  "angles",
  "script",
  "creatives",
  "lp",
  "ad-copy",
  "research",
])

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const clientId = req.nextUrl.searchParams.get("clientId")
  const stage = req.nextUrl.searchParams.get("stage")
  const campaignNumberParam = req.nextUrl.searchParams.get("campaignNumber")
  const campaignNumber = campaignNumberParam ? parseInt(campaignNumberParam, 10) : null

  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  let query = supabase
    .from("pedro_stage_versions")
    .select("id, client_id, campaign_number, stage, version_number, data, label, saved_by, saved_at")
    .eq("client_id", clientId)
    .order("saved_at", { ascending: false })

  if (stage) {
    if (!VALID_STAGES.has(stage)) {
      return NextResponse.json({ error: "ongeldige stage" }, { status: 400 })
    }
    query = query.eq("stage", stage)
  }

  if (campaignNumber != null && Number.isFinite(campaignNumber)) {
    query = query.eq("campaign_number", campaignNumber)
  }

  const { data, error } = await query.limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ versions: data ?? [] })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: {
    clientId?: string
    stage?: string
    data?: unknown
    label?: string
    campaignNumber?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const clientId = String(body.clientId ?? "")
  const stage = String(body.stage ?? "")
  const data = body.data
  const label = body.label?.trim() || null
  const campaignNumber = body.campaignNumber ?? 1

  if (!clientId || !stage || !VALID_STAGES.has(stage) || data == null) {
    return NextResponse.json(
      { error: "clientId, stage en data zijn verplicht; stage moet geldig zijn" },
      { status: 400 },
    )
  }

  const supabase = await createAdminClient()

  // Compute next version_number for this (client, campaign, stage) tuple.
  // We do this app-side because Postgres' SERIAL isn't scoped to a
  // composite key and a unique index already guards against duplicates.
  const { data: latest } = await supabase
    .from("pedro_stage_versions")
    .select("version_number")
    .eq("client_id", clientId)
    .eq("campaign_number", campaignNumber)
    .eq("stage", stage)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ version_number: number }>()

  const nextVersion = (latest?.version_number ?? 0) + 1

  const { data: inserted, error } = await supabase
    .from("pedro_stage_versions")
    .insert({
      client_id: clientId,
      campaign_number: campaignNumber,
      stage,
      version_number: nextVersion,
      data,
      label,
      saved_by: session.user.id ?? null,
    })
    .select("id, version_number, saved_at")
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ version: inserted })
}
