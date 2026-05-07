import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  createAndSendInvoice,
  fetchAllRecentInvoices,
  fetchBillingSummary,
  type BillingSummary,
  type PastInvoice,
} from "@/lib/integrations/stripe"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { updateClientField } from "@/lib/clients/edit"
import { addMonthsIso } from "@/lib/clients/billing-cycle"
import { readCache, writeCache } from "@/lib/cache"

/**
 * Send a Stripe invoice for a client straight from the Hub. Open to anyone
 * with a Hub session — billing flows are visible to finance / members /
 * admins (same trust level as opening /billing).
 *
 * The body is the user-confirmed line items; we don't fabricate amounts on
 * the server because finance is expected to double-check them in the dialog
 * before pressing Send. We DO re-resolve the Stripe customer id from the
 * Monday item id so a stale client-side state can't be tricked into sending
 * an invoice to the wrong customer.
 *
 * After a successful send, this also:
 *   1. Advances the client's `cycle_start_date` by one month (the derived
 *      invoice date follows automatically via the edit pipeline + sibling
 *      sync, so multi-campaign clients all roll forward together).
 *   2. Refreshes the Stripe `billing_summaries` cache for this customer so
 *      the parent row's "Open · €X" pill flips to "Paid up" / new outstanding
 *      without waiting for the hourly cron.
 *   3. Refreshes the global `past_invoices` cache so the just-sent invoice
 *      shows up under the Past tab on next render.
 *
 * Each post-send step is best-effort — if any fails, the invoice still went
 * out and finance can hit the Refresh button manually. We log + continue
 * rather than returning an error after a successful Stripe send.
 */
type Body = {
  items?: Array<{ description?: string; amountEuro?: number | string }>
  daysUntilDue?: number
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "items[] is required" }, { status: 400 })
  }

  // Server-side authoritative customer id — pulled from Supabase by the
  // Monday item id rather than trusted from the request, so a tampered client
  // state can't redirect the invoice.
  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("monday_item_id, stripe_customer_id, name, cycle_start_date")
    .eq("monday_item_id", mondayItemId)
    .maybeSingle()

  if (!client) {
    return NextResponse.json({ error: "Client not synced to Supabase yet" }, { status: 404 })
  }
  if (!client.stripe_customer_id) {
    return NextResponse.json(
      { error: "No Stripe customer linked for this client. Add a Stripe customer ID on the client first." },
      { status: 400 },
    )
  }

  // Coerce numeric amounts coming from JSON (could be string from form input).
  const items = body.items.map((i) => ({
    description: String(i.description ?? "").trim(),
    amountEuro: typeof i.amountEuro === "string" ? Number(i.amountEuro) : Number(i.amountEuro ?? 0),
  }))

  if (items.some((i) => !Number.isFinite(i.amountEuro))) {
    return NextResponse.json({ error: "Invalid line item amount" }, { status: 400 })
  }

  let result: Awaited<ReturnType<typeof createAndSendInvoice>>
  try {
    result = await createAndSendInvoice({
      customerId: client.stripe_customer_id,
      items,
      daysUntilDue: body.daysUntilDue,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to send invoice" },
      { status: 500 },
    )
  }

  // ---- Post-send actions (best effort) ----

  // 1. Advance cycle by one month. Skip when the row has no cycle yet —
  // there's nothing to advance and the next-render bucket is unaffected.
  const currentCycle = (client.cycle_start_date as string | null) ?? null
  let newCycle: string | null = null
  let cycleWritten = false
  if (currentCycle) {
    newCycle = addMonthsIso(currentCycle, 1)
    if (newCycle) {
      try {
        await updateClientField(mondayItemId, {
          fieldKey: "cycle_start_date",
          value: newCycle,
        })
        cycleWritten = true
      } catch (e) {
        console.error(
          `[create-invoice] cycle advance failed for ${mondayItemId}:`,
          e instanceof Error ? e.message : e,
        )
      }
    }
  }

  // 1a. Refresh the Monday boards cache when we just wrote a new cycle.
  // updateClientField mirrors to Supabase + syncs siblings, but the
  // `monday_boards` cache (read by the Billing page on next render) is only
  // refreshed by the hourly cron + the manual Refresh button. Without this,
  // the user would still see the old cycle/invoice date on `router.refresh()`
  // — making it look like nothing changed even though the invoice went out.
  if (cycleWritten) {
    try {
      const { onboarding, current } = await fetchBothBoards()
      await writeCache("monday_boards", { onboarding, current })
    } catch (e) {
      console.error(
        "[create-invoice] monday boards cache refresh failed:",
        e instanceof Error ? e.message : e,
      )
    }
  }

  // 2. Refresh this customer's billing summary so payment-status pill flips.
  try {
    const fresh = await fetchBillingSummary(client.stripe_customer_id)
    const existing =
      (await readCache<Record<string, BillingSummary>>("billing_summaries")) ?? {}
    await writeCache("billing_summaries", {
      ...existing,
      [client.stripe_customer_id]: fresh,
    })
  } catch (e) {
    console.error(
      `[create-invoice] billing summary refresh failed for ${client.stripe_customer_id}:`,
      e instanceof Error ? e.message : e,
    )
  }

  // 3. Refresh past_invoices so the just-sent invoice appears under Past tab.
  // Full re-fetch (180-day window) — single Stripe API call, ~1-2s. Cheaper
  // than reasoning about how to splice a single new invoice into the cache.
  try {
    const pastInvoices: PastInvoice[] = await fetchAllRecentInvoices(180)
    await writeCache("past_invoices", pastInvoices)
  } catch (e) {
    console.error(
      "[create-invoice] past invoices refresh failed:",
      e instanceof Error ? e.message : e,
    )
  }

  // Bump the "last refreshed" stamp so the Refresh button's hint reflects the
  // post-send refresh too.
  try {
    await writeCache("billing_refreshed_at", new Date().toISOString())
  } catch {
    // Silent — this is just a UI hint, not load-bearing.
  }

  return NextResponse.json({ ok: true, ...result, newCycleStartDate: newCycle })
}
