import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const supabase = await createAdminClient()

  const [{ data }, { data: settingsRow }] = await Promise.all([
    supabase
      .from("clients")
      .select("column_mapping_override")
      .eq("monday_item_id", mondayItemId)
      .single(),
    supabase
      .from("settings")
      .select("value")
      .eq("key", "board_config")
      .single(),
  ])

  const defaults = (settingsRow?.value as Record<string, unknown>)?.client_board_columns ?? {
    date_created: "date4", date_appointment: "dup__of_date_created__1",
    lead_status: "dup__of_status__1", lead_status_2: "dup__of_status6__1",
    deal_value: "omzet__1", utm: "text9__1",
    date_deal: "date_mm1vgcfx",
  }

  return NextResponse.json({ overrides: data?.column_mapping_override ?? null, defaults })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params
  const { overrides } = await req.json() as { overrides: Record<string, string> | null }

  const supabase = await createAdminClient()

  const { error } = await supabase
    .from("clients")
    .update({ column_mapping_override: overrides })
    .eq("monday_item_id", mondayItemId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ overrides })
}
