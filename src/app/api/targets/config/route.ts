import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import type { TargetsConfig } from "@/types/targets"

const EMPTY: TargetsConfig = {
  calls: 0, qualifiedCalls: 0, takenCalls: 0, deals: 0, revenue: 0,
  cbc: 0, cqc: 0, ctc: 0, cpd: 0,
  serviceFeeRevenue: 0, adBudgetRevenue: 0, totalCosts: 0, netProfit: 0, profitMargin: 0,
  mrr: 0, newBusiness: 0, activeCustomers: 0, avgRevenuePerCustomer: 0, maxChurnRate: 0,
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "targets_config")
    .single()

  // Merge with empty to ensure all fields exist (handles old configs missing new fields)
  const stored = data?.value as Partial<TargetsConfig> | null
  const config = stored ? { ...EMPTY, ...stored } : null

  return NextResponse.json(config)
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if ((session.user as { role?: string })?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const body = await request.json() as Partial<TargetsConfig>

  const config: TargetsConfig = { ...EMPTY }
  for (const key of Object.keys(EMPTY) as Array<keyof TargetsConfig>) {
    config[key] = Math.max(0, body[key] ?? 0)
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
