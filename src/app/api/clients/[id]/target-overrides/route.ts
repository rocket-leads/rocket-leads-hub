import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { DEFAULT_TARGETS, type KpiTargets } from "@/lib/clients/targets"
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const supabase = await createAdminClient()

  const [{ data: clientRow }, { data: settingsRow }] = await Promise.all([
    supabase
      .from("clients")
      .select("target_overrides")
      .eq("monday_item_id", mondayItemId)
      .single(),
    supabase
      .from("settings")
      .select("value")
      .eq("key", "kpi_targets")
      .single(),
  ])

  const globalTargets = (settingsRow?.value ?? DEFAULT_TARGETS) as KpiTargets

  return NextResponse.json({
    global: globalTargets,
    overrides: clientRow?.target_overrides ?? null,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const { overrides } = await req.json() as { overrides: Partial<KpiTargets> | null }

  const supabase = await createAdminClient()

  const { error } = await supabase
    .from("clients")
    .update({ target_overrides: overrides })
    .eq("monday_item_id", mondayItemId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ overrides, saved: true })
}
