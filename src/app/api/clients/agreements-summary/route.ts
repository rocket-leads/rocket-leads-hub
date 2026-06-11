import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { agreementMonthly, normalizeAgreement } from "@/lib/clients/agreement"
import { NextResponse } from "next/server"

export type AgreementSummary = {
  adBudget: number
  mrr: number
}

/**
 * Bulk read of per-client ad-budget and MRR from `client_agreements`. Keyed by
 * `monday_item_id` so the Clients overview table (which is keyed off Monday
 * IDs, not Hub UUIDs) can map directly without an extra lookup.
 *
 * Cheap query - single Supabase round-trip with a join - so we don't bother
 * with the cron-cache pattern used for Stripe / KPIs. Browser revalidates
 * every minute via the cache-control header.
 */
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("client_agreements")
    .select(
      "ad_budget, platforms, platform_fees, follow_up, follow_up_fee, clients!inner(monday_item_id)",
    )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const summaries: Record<string, AgreementSummary> = {}
  for (const row of data ?? []) {
    // Supabase typing for the joined `clients!inner` returns it as either a
    // single row or an array depending on the relationship - handle both.
    const joined = row.clients as
      | { monday_item_id: string }
      | { monday_item_id: string }[]
      | null
    const mondayItemId = Array.isArray(joined)
      ? joined[0]?.monday_item_id
      : joined?.monday_item_id
    if (!mondayItemId) continue
    const agreement = normalizeAgreement(row)
    summaries[mondayItemId] = {
      adBudget: agreement.ad_budget,
      mrr: agreementMonthly(agreement),
    }
  }

  return NextResponse.json(summaries, {
    headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
  })
}
