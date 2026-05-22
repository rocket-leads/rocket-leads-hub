import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { assembleDeliverable } from "@/lib/pedro/deliverable"

/**
 * Pedro client deliverable — assembled markdown doc per client.
 *
 *   GET  /api/pedro/deliverable?clientId=X&campaignNumber=N
 *     → returns the currently-stored deliverable or null
 *
 *   POST /api/pedro/deliverable  body: { clientId, campaignNumber? }
 *     → re-reads latest saved versions of each stage, assembles the
 *       markdown, upserts to pedro_deliverables, returns the result
 *
 * Generation is cheap (a few small Supabase reads + string joins) so we
 * always regenerate on POST rather than caching. The Supabase upsert is
 * keyed on (client_id, campaign_number), so regenerating overwrites.
 */

const DEFAULT_CAMPAIGN = 1

type DeliverableRow = {
  id: string
  client_id: string
  campaign_number: number
  content_md: string
  metadata: unknown
  generated_at: string
  generated_by: string | null
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const clientId = url.searchParams.get("clientId")
  const campaignNumber = Number(url.searchParams.get("campaignNumber") ?? DEFAULT_CAMPAIGN)
  if (!clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("pedro_deliverables")
    .select("*")
    .eq("client_id", clientId)
    .eq("campaign_number", campaignNumber)
    .maybeSingle<DeliverableRow>()

  if (error) {
    console.error("[pedro/deliverable GET]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deliverable: data ?? null })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { clientId?: string; campaignNumber?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const clientId = body.clientId
  const campaignNumber = body.campaignNumber ?? DEFAULT_CAMPAIGN
  if (!clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  // Look up client name from supabase clients table — faster than
  // re-fetching Monday and good enough for the deliverable header.
  const { data: clientRow } = await supabase
    .from("clients")
    .select("name")
    .eq("monday_item_id", clientId)
    .maybeSingle<{ name: string }>()
  const clientName = clientRow?.name ?? clientId

  try {
    const assembled = await assembleDeliverable(supabase, clientId, clientName, campaignNumber)

    const { data, error } = await supabase
      .from("pedro_deliverables")
      .upsert(
        {
          client_id: clientId,
          campaign_number: campaignNumber,
          content_md: assembled.contentMd,
          metadata: assembled.metadata,
          generated_by: session.user.id,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "client_id,campaign_number" },
      )
      .select("*")
      .maybeSingle<DeliverableRow>()

    if (error) {
      console.error("[pedro/deliverable POST] upsert failed", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ deliverable: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "deliverable assembly failed"
    console.error("[pedro/deliverable POST]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
