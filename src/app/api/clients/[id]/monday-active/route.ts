import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

export type KpiVisibility = {
  leads: boolean
  appointments: boolean
  deals: boolean
}

const ALL_ON: KpiVisibility = { leads: true, appointments: true, deals: true }
const LEADS_ONLY: KpiVisibility = { leads: true, appointments: false, deals: false }

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const supabase = await createAdminClient()

  const { data } = await supabase
    .from("clients")
    .select("kpi_visibility, monday_client_board_id")
    .eq("monday_item_id", mondayItemId)
    .single()

  // If kpi_visibility is set, use it. Otherwise default based on whether a board is linked.
  const visibility: KpiVisibility = data?.kpi_visibility
    ?? (data?.monday_client_board_id ? ALL_ON : LEADS_ONLY)

  // Backwards compat: derive mondayActive from visibility
  const mondayActive = visibility.appointments || visibility.deals

  return NextResponse.json({ mondayActive, kpiVisibility: visibility })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const body = await req.json()

  const supabase = await createAdminClient()

  // Support both old { mondayActive } and new { kpiVisibility } format
  if ("kpiVisibility" in body) {
    const kpiVisibility = body.kpiVisibility as KpiVisibility
    const { error } = await supabase
      .from("clients")
      .update({ kpi_visibility: kpiVisibility })
      .eq("monday_item_id", mondayItemId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ kpiVisibility })
  }

  // Legacy: mondayActive toggle
  const { mondayActive } = body as { mondayActive: boolean }
  const kpiVisibility: KpiVisibility = mondayActive ? ALL_ON : LEADS_ONLY
  const { error } = await supabase
    .from("clients")
    .update({ kpi_visibility: kpiVisibility })
    .eq("monday_item_id", mondayItemId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ mondayActive, kpiVisibility })
}
