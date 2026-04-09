import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import type { TargetsConfig } from "@/types/targets"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "targets_config")
    .single()

  const config = data?.value as TargetsConfig | null
  return NextResponse.json(config)
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if ((session.user as { role?: string })?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const body = await request.json() as Partial<TargetsConfig>

  const config: TargetsConfig = {
    calls: Math.max(0, body.calls ?? 0),
    qualifiedCalls: Math.max(0, body.qualifiedCalls ?? 0),
    takenCalls: Math.max(0, body.takenCalls ?? 0),
    deals: Math.max(0, body.deals ?? 0),
    revenue: Math.max(0, body.revenue ?? 0),
    cbc: Math.max(0, body.cbc ?? 0),
    cqc: Math.max(0, body.cqc ?? 0),
    ctc: Math.max(0, body.ctc ?? 0),
    cpd: Math.max(0, body.cpd ?? 0),
  }

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("settings")
    .upsert({ key: "targets_config", value: config, updated_at: new Date().toISOString() })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(config)
}
