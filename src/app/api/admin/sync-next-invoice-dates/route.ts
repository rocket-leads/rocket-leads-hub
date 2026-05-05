import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards, setItemColumnValue } from "@/lib/integrations/monday"
import { deriveInvoiceDate } from "@/lib/clients/billing-cycle"

/**
 * On-demand trigger that re-syncs the cycle + invoice dates from Monday into
 * Supabase, plus drift-corrects Monday's invoice column when it differs from
 * `cycle - 7d`. Cycle is the single source of truth; invoice date is always
 * derived.
 *
 * Same logic as the refresh-cache cron, exposed on demand so finance can hit
 * "Sync from Monday" on the Billing page and see freshly-set dates without
 * waiting for the next 30-min cron tick. Idempotent + open to any signed-in
 * user (the operation is non-destructive on Monday/Supabase rows; it just
 * keeps two existing fields in lockstep).
 *
 * Both GET and POST are accepted so the page button can use POST while a
 * direct URL hit also works.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function handler() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = Date.now()
  const supabase = await createAdminClient()

  let onboarding, current
  try {
    ;({ onboarding, current } = await fetchBothBoards())
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Monday fetch failed" },
      { status: 500 },
    )
  }
  const allClients = [...onboarding, ...current]
  const mondayItemIds = allClients.map((c) => c.mondayItemId)

  // Match Supabase rows that already exist — never insert stub rows.
  const { data: clientRows } = await supabase
    .from("clients")
    .select("monday_item_id")
    .in("monday_item_id", mondayItemIds)
  const existing = new Set((clientRows ?? []).map((r) => r.monday_item_id as string))
  const targets = allClients.filter((c) => existing.has(c.mondayItemId))

  // Drift correction first: rewrite Monday's invoice column where it doesn't
  // match cycle - 7d. We mutate `c.nextInvoiceDate` in place so the Supabase
  // sync below writes the corrected value rather than the stale one.
  const driftWrites: Array<Promise<unknown>> = []
  let drifted = 0
  for (const c of targets) {
    const cycle = DATE_RE.test(c.cycleStartDate) ? c.cycleStartDate : null
    const expected = cycle ? deriveInvoiceDate(cycle) : null
    const current = DATE_RE.test(c.nextInvoiceDate) ? c.nextInvoiceDate : null
    if ((expected ?? "") !== (current ?? "")) {
      c.nextInvoiceDate = expected ?? ""
      drifted++
      driftWrites.push(
        setItemColumnValue(c.boardType, c.mondayItemId, "next_invoice_date", expected ?? "")
          .catch((e) => console.error(`drift write failed for ${c.mondayItemId}:`, e instanceof Error ? e.message : e)),
      )
    }
  }
  if (driftWrites.length > 0) await Promise.allSettled(driftWrites)

  // Mirror both columns into Supabase.
  const updates = targets.map((c) => {
    const cycle = DATE_RE.test(c.cycleStartDate) ? c.cycleStartDate : null
    const invoice = DATE_RE.test(c.nextInvoiceDate) ? c.nextInvoiceDate : null
    return supabase
      .from("clients")
      .update({ cycle_start_date: cycle, next_invoice_date: invoice })
      .eq("monday_item_id", c.mondayItemId)
  })
  const results = await Promise.allSettled(updates)
  const failed = results.filter((r) => r.status === "rejected").length
  const written = results.length - failed
  const skipped = allClients.length - targets.length

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - startedAt,
    totalMondayClients: allClients.length,
    written,
    failed,
    skippedNotInSupabase: skipped,
    driftCorrected: drifted,
  })
}

export const GET = handler
export const POST = handler
