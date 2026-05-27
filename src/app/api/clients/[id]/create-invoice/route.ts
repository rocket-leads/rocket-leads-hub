import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  createAndSendInvoice,
  fetchInvoicePreview,
  fetchAllRecentInvoices,
  fetchBillingSummary,
  type BillingSummary,
  type InvoiceDraftPreview,
  type PastInvoice,
} from "@/lib/integrations/stripe"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { updateClientField } from "@/lib/clients/edit"
import { addMonthsIso } from "@/lib/clients/billing-cycle"
import { setAdministration } from "@/lib/clients/administration-sync"
import { ADMIN_LABELS } from "@/lib/clients/administration"
import { readCache, writeCache } from "@/lib/cache"

/**
 * Two-step Finance approval flow for sending a Stripe invoice from the Hub.
 *
 *   1. `action: "preview"` — read-only fetch of the Stripe customer +
 *      tax IDs, paired with form-side line-item totals. NO draft is
 *      created; Stripe sees nothing until the user approves and sends.
 *   2. `action: "send"` — atomic draft → finalize → email via Stripe's
 *      hosted template, followed by all post-send refreshes (cycle
 *      advance, Monday admin stamp, billing-summary + past-invoices
 *      cache rebuild). On send failure the draft is voided automatically.
 *
 * Legacy callers (no `action` field) get treated as `send` for backward-
 * compat, since the previous behaviour was one-shot create+send.
 *
 * Open to anyone with a Hub session — billing flows are visible to
 * finance / members / admins (same trust level as opening /billing). We
 * re-resolve the Stripe customer id from the Monday item id on every
 * action so a stale client-side state can't redirect the invoice.
 */
type PreviewBody = {
  action: "preview"
  items: Array<{ description?: string; amountEuro?: number | string }>
  daysUntilDue?: number
}
type SendBody = {
  action: "send"
  items: Array<{ description?: string; amountEuro?: number | string }>
  daysUntilDue?: number
}
type LegacyBody = {
  items?: Array<{ description?: string; amountEuro?: number | string }>
  daysUntilDue?: number
}
type Body = PreviewBody | SendBody | LegacyBody

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

  // Server-side authoritative customer id — pulled from Supabase by the
  // Monday item id rather than trusted from the request, so a tampered
  // client state can't redirect the invoice.
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

  const action = "action" in body ? body.action : "send"

  // Items + due-days are validated the same way for preview and send.
  const rawItems = (body as { items?: Array<{ description?: string; amountEuro?: number | string }> }).items
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: "items[] is required" }, { status: 400 })
  }
  const items = rawItems.map((i) => ({
    description: String(i.description ?? "").trim(),
    amountEuro: typeof i.amountEuro === "string" ? Number(i.amountEuro) : Number(i.amountEuro ?? 0),
  }))
  if (items.some((i) => !Number.isFinite(i.amountEuro))) {
    return NextResponse.json({ error: "Invalid line item amount" }, { status: 400 })
  }

  // ── action: preview ─ read-only fetch + local totals, no Stripe mutation ─
  if (action === "preview") {
    let preview: InvoiceDraftPreview
    try {
      preview = await fetchInvoicePreview({
        customerId: client.stripe_customer_id,
        items,
        daysUntilDue: body.daysUntilDue,
        cycleStartDate: (client.cycle_start_date as string | null) ?? null,
      })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Failed to build invoice preview" },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: true, ...preview })
  }

  // ── action: send ─ create + finalize + email + post-send refreshes ──
  let result: Awaited<ReturnType<typeof createAndSendInvoice>>
  try {
    result = await createAndSendInvoice({
      customerId: client.stripe_customer_id,
      items,
      daysUntilDue: body.daysUntilDue,
      cycleStartDate: (client.cycle_start_date as string | null) ?? null,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to send invoice" },
      { status: 500 },
    )
  }

  // ---- Post-send actions (best effort) ----

  // 0. Stamp the Monday "Administration" column to "Invoice send". Per Roy's
  // 2026-05-19 spec this is the one auto-target allowed to overwrite ANY
  // existing value (incl. Discuss first / Debt collection agencies) because
  // "Stripe shipped the invoice" is an objective fact. Best-effort: a Monday
  // write failure doesn't block the rest of the post-send flow.
  await setAdministration(mondayItemId, ADMIN_LABELS.invoiceSend)

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
