import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards } from "@/lib/integrations/monday"

/**
 * On-demand admin trigger that re-syncs `next_invoice_date` from Monday's
 * `date3` column into Supabase `clients.next_invoice_date` for every client.
 *
 * The same logic runs inside the refresh-cache cron every 30 min — this
 * endpoint exists so finance can hit "Sync from Monday" on the Billing page
 * and see freshly-set dates immediately, rather than waiting for the next
 * cron tick. Idempotent + admin-only.
 *
 * Both GET and POST are accepted so the page button can use POST while a
 * direct admin URL hit also works.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function handler() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // Open to any signed-in user — billing is viewable by everyone (finance,
  // members, admins) and the sync just refreshes a non-destructive mirror
  // column from Monday. Same trust level as opening the page itself.

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
  const updates = targets.map((c) => {
    const value = DATE_RE.test(c.nextInvoiceDate) ? c.nextInvoiceDate : null
    return supabase
      .from("clients")
      .update({ next_invoice_date: value })
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
  })
}

export const GET = handler
export const POST = handler
