import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Pedro campaigns — named campaign containers per client.
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
