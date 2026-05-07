import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

// Pedro per-client state — load + upsert. Persists every deliverable
// (brief, angles, script, creatives, LP, ad copy) per (client_id,
// campaign_number) so we build up a per-client content database over time.

type StatePatch = {
  clientId: string
  campaignNumber?: number
  brief?: unknown
  selected_angles?: unknown
  script_text?: string | null
  script_videos?: unknown
  creatives?: unknown
  lp?: unknown
  ad_copy?: unknown
  brand_style?: unknown
  auto_brief_meta?: unknown
}

const ALLOWED_KEYS = [
  "brief",
  "selected_angles",
  "script_text",
  "script_videos",
  "creatives",
  "lp",
  "ad_copy",
  "brand_style",
  "auto_brief_meta",
] as const

// GET /api/pedro/client-state?clientId=X
//   → latest campaign row for that client (highest campaign_number), or null
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const clientId = req.nextUrl.searchParams.get("clientId")
  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("pedro_client_state")
    .select("*")
    .eq("client_id", clientId)
    .order("campaign_number", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ state: data ?? null })
}

// POST /api/pedro/client-state
//   body: { clientId, campaignNumber?, brief?, selected_angles?, ... }
//   Upserts the row; only sends keys the caller included so partial saves
//   (debounced auto-save per stage) don't wipe other stages.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: StatePatch
  try {
    body = (await req.json()) as StatePatch
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body.clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }

  const campaignNumber = body.campaignNumber ?? 1

  // Build a partial patch with only the keys the caller sent — preserves
  // the rest of the row across stage-by-stage saves.
  const patch: Record<string, unknown> = {
    client_id: body.clientId,
    campaign_number: campaignNumber,
  }
  for (const key of ALLOWED_KEYS) {
    if (key in body) {
      patch[key] = (body as unknown as Record<string, unknown>)[key]
    }
  }

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("pedro_client_state")
    .upsert(patch, { onConflict: "client_id,campaign_number" })
    .select()
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ state: data })
}
