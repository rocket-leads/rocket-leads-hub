import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards, setItemColumnValue } from "@/lib/integrations/monday"
import {
  fetchAllRecentInvoices,
  refreshBillingSummaries,
  type BillingSummary,
} from "@/lib/integrations/stripe"
import { readCache, writeCache } from "@/lib/cache"
import { deriveInvoiceDate } from "@/lib/clients/billing-cycle"

/**
 * On-demand combined refresh for the Billing page. Triggered by the
 * "Refresh" button — finance hits this when something just changed on
 * Monday or in Stripe and they don't want to wait for the next cron tick.
 *
 * Three things in one call:
 *   1. Live Monday boards fetch → write `monday_boards` cache fresh.
 *   2. Drift-correct Monday's invoice column (cycle - 7d) and mirror both
 *      cycle/invoice dates into Supabase `clients` table.
 *   3. Refresh Stripe `billing_summaries` cache for every linked customer.
 *
 * AI invoice-readiness verdicts are NOT refreshed here — that runs every 6h
 * via its dedicated cron, and the per-row Refresh button on the popover
 * handles single-client recompute. Pulling it into the global Refresh would
 * burn ~50 Claude calls per click.
 *
 * Auth: any signed-in user. Same trust level as opening the page itself.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function handler() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = Date.now()
  const supabase = await createAdminClient()

  // 1. Live Monday fetch.
  let allClients
  try {
    const { onboarding, current } = await fetchBothBoards()
    allClients = [...onboarding, ...current]
    // Refresh the boards cache so every other read in the app picks up the
    // new state without waiting on its own cron.
    await writeCache("monday_boards", { onboarding, current })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Monday fetch failed" },
      { status: 500 },
    )
  }

  const mondayItemIds = allClients.map((c) => c.mondayItemId)
  const { data: clientRows } = await supabase
    .from("clients")
    .select("monday_item_id")
    .in("monday_item_id", mondayItemIds)
  const existing = new Set((clientRows ?? []).map((r) => r.monday_item_id as string))
  const targets = allClients.filter((c) => existing.has(c.mondayItemId))

  // 2. Drift correction + dates mirror — same logic as the daily cron, just
  // exposed on demand. Cycle is the source of truth; invoice = cycle - 7d.
  let drifted = 0
  const driftWrites: Array<Promise<unknown>> = []
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

  const dateUpdates = targets.map((c) => {
    const cycle = DATE_RE.test(c.cycleStartDate) ? c.cycleStartDate : null
    const invoice = DATE_RE.test(c.nextInvoiceDate) ? c.nextInvoiceDate : null
    return supabase
      .from("clients")
      .update({ cycle_start_date: cycle, next_invoice_date: invoice })
      .eq("monday_item_id", c.mondayItemId)
  })
  const dateResults = await Promise.allSettled(dateUpdates)
  const datesFailed = dateResults.filter((r) => r.status === "rejected").length

  // 3. Refresh Stripe state in parallel — per-customer summaries (for the
  // payment pill on each row) AND the global recent-invoices list (for the
  // Past invoices tab).
  const customerIds = Array.from(
    new Set(allClients.map((c) => c.stripeCustomerId).filter((id): id is string => !!id)),
  )
  let stripeRefreshed = 0
  let stripeFailed = 0
  let pastInvoicesCount = 0
  if (customerIds.length > 0) {
    const [summaryRes, pastInvoices] = await Promise.all([
      refreshBillingSummaries(customerIds),
      fetchAllRecentInvoices(180).catch((e) => {
        console.error("past invoices fetch failed:", e instanceof Error ? e.message : e)
        return null
      }),
    ])
    stripeRefreshed = Object.keys(summaryRes.summaries).length
    stripeFailed = summaryRes.failed
    const existingSummaries =
      (await readCache<Record<string, BillingSummary>>("billing_summaries")) ?? {}
    await writeCache("billing_summaries", { ...existingSummaries, ...summaryRes.summaries })
    if (pastInvoices) {
      pastInvoicesCount = pastInvoices.length
      await writeCache("past_invoices", pastInvoices)
    }
  }

  // Stamp last refresh — the page reads this to render "Last updated X ago".
  const refreshedAt = new Date().toISOString()
  await writeCache("billing_refreshed_at", refreshedAt)

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - startedAt,
    refreshedAt,
    monday: {
      total: allClients.length,
      datesWritten: targets.length - datesFailed,
      datesFailed,
      driftCorrected: drifted,
    },
    stripe: {
      customers: customerIds.length,
      refreshed: stripeRefreshed,
      failed: stripeFailed,
      pastInvoices: pastInvoicesCount,
    },
  })
}

export const GET = handler
export const POST = handler
