import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { applyCycleToAllSiblings } from "@/lib/clients/edit"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { writeCache } from "@/lib/cache"

/**
 * Explicit "align all campaigns of this client onto its payment date" action.
 *
 * Takes the source client's current `cycle_start_date` and writes it (plus the
 * derived invoice-out date) to every OTHER Monday row sharing its Stripe
 * customer. This is the opt-in replacement for the automatic sibling sync that
 * used to fire on every date edit - finance triggers it deliberately for
 * clients whose campaigns should share one invoice cadence, while
 * separately-invoiced clients (e.g. HeroLeads) keep their divergent dates.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params

  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("cycle_start_date")
    .eq("monday_item_id", mondayItemId)
    .maybeSingle()

  const cycleStartDate = (client?.cycle_start_date as string | null) ?? null
  if (!cycleStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(cycleStartDate)) {
    return NextResponse.json(
      { error: "This client has no payment date set - set one before aligning campaigns." },
      { status: 400 },
    )
  }

  let applied = 0
  try {
    const result = await applyCycleToAllSiblings(mondayItemId, cycleStartDate)
    applied = result.applied
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to align campaigns" },
      { status: 500 },
    )
  }

  // Refresh the Monday boards cache so the Billing page reflects the aligned
  // dates immediately (which also re-bundles the now-matching siblings).
  try {
    const { onboarding, current } = await fetchBothBoards()
    await writeCache("monday_boards", { onboarding, current })
  } catch {
    // Best-effort - the next cron tick will reconcile the cache.
  }

  return NextResponse.json({ ok: true, applied })
}
