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
import { fetchBothBoards, parseStripeCustomerIds, type MondayClient } from "@/lib/integrations/monday"
import { updateClientField, advanceBundledSiblings } from "@/lib/clients/edit"
import { addMonthsIso, deriveInvoiceDate } from "@/lib/clients/billing-cycle"
import { setAdministration } from "@/lib/clients/administration-sync"
import { ADMIN_LABELS } from "@/lib/clients/administration"
import { readCache, writeCache } from "@/lib/cache"
import { recordBillingEvent } from "@/lib/billing/audit"

/**
 * Two-step Finance approval flow for sending a Stripe invoice from the Hub.
 *
 *   1. `action: "preview"` - read-only fetch of the Stripe customer +
 *      tax IDs, paired with form-side line-item totals. NO draft is
 *      created; Stripe sees nothing until the user approves and sends.
 *   2. `action: "send"` - atomic draft → finalize → email via Stripe's
 *      hosted template, followed by all post-send refreshes (cycle
 *      advance, Monday admin stamp, billing-summary + past-invoices
 *      cache rebuild). On send failure the draft is voided automatically.
 *
 * Legacy callers (no `action` field) get treated as `send` for backward-
 * compat, since the previous behaviour was one-shot create+send.
 *
 * Open to anyone with a Hub session - billing flows are visible to
 * finance / members / admins (same trust level as opening /billing). We
 * re-resolve the Stripe customer id from the Monday item id on every
 * action so a stale client-side state can't redirect the invoice.
 */
/**
 * Invoice mode:
 *   - "monthly" (default): the recurring service/ad invoice. Advances the
 *     client's payment date one period forward on send and stamps the Monday
 *     admin column. The period the invoice covers is tagged from the current
 *     cycle date.
 *   - "oneoff": a standalone extra invoice (e.g. an add-on package). Sends the
 *     invoice but does NOT touch the payment cycle, MRR or admin status - it's
 *     a one-time charge that leaves the recurring cadence exactly where it was.
 */
type InvoiceMode = "monthly" | "oneoff"
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type PreviewBody = {
  action: "preview"
  items: Array<{ description?: string; amountEuro?: number | string }>
  daysUntilDue?: number
  mode?: InvoiceMode
}
type SendBody = {
  action: "send"
  items: Array<{ description?: string; amountEuro?: number | string }>
  daysUntilDue?: number
  mode?: InvoiceMode
  /** For monthly mode: the END of the period this invoice covers, used ONLY to
   *  render the "(28 Aug – 27 Nov 2026)" suffix on each line (period = current
   *  cycle → this date − 1 day). The Hub does NOT write this back to Monday -
   *  Monday's automation advances the payment date. Ignored for oneoff. */
  nextCycleDate?: string
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

  // Server-side authoritative customer id - pulled from Supabase by the
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

  // A client should have exactly ONE Stripe customer. The field can hold
  // multiple comma-separated IDs (legacy / entity changes), but we must never
  // hand a combined string to Stripe - it can't look up "cus_A, cus_B" and
  // errors. When there's more than one, block invoicing and point finance to
  // the Billing tab, where they pick the correct customer (which replaces the
  // other). A single well-formed id is used as-is.
  const stripeIds = parseStripeCustomerIds(client.stripe_customer_id)
  if (stripeIds.length === 0) {
    return NextResponse.json(
      { error: "No valid Stripe customer linked for this client." },
      { status: 400 },
    )
  }
  if (stripeIds.length > 1) {
    return NextResponse.json(
      {
        error: `This client has ${stripeIds.length} Stripe customers linked. Open the client's Billing tab → "Stripe customer details" and pick the correct one before invoicing.`,
      },
      { status: 400 },
    )
  }
  const customerId = stripeIds[0]

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

  // A one-off invoice is a standalone charge, so it doesn't carry the monthly
  // billing period (cycle → cycle+1mo-1d) that recurring invoices tag on each
  // line. Passing null suppresses the "(3 Jun – 2 Jul)" suffix for one-offs.
  const mode: InvoiceMode = "mode" in body && body.mode === "oneoff" ? "oneoff" : "monthly"
  const currentCycle = (client.cycle_start_date as string | null) ?? null
  const periodCycle = mode === "oneoff" ? null : currentCycle

  // Period END = the next cycle date this send advances to. Drives the real
  // billing-period suffix on each line ("(28 Aug – 27 Nov 2026)" for a
  // quarterly client) instead of a hardcoded 1-month span. Read generically
  // off the body since both preview + send carry it; null for one-offs (no
  // period block) and when finance hasn't supplied a next date.
  const rawNextCycle = (body as { nextCycleDate?: unknown }).nextCycleDate
  const periodEnd =
    mode === "oneoff"
      ? null
      : typeof rawNextCycle === "string" && DATE_RE.test(rawNextCycle)
        ? rawNextCycle
        : null

  // ── action: preview ─ read-only fetch + local totals, no Stripe mutation ─
  if (action === "preview") {
    let preview: InvoiceDraftPreview
    try {
      preview = await fetchInvoicePreview({
        customerId: customerId,
        items,
        daysUntilDue: body.daysUntilDue,
        cycleStartDate: periodCycle,
        nextCycleDate: periodEnd,
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
  // Hard pre-send guard: the net total must be positive. Discount lines can be
  // negative, but a zero/negative invoice can't be sent (and would confuse the
  // customer). Finance sees the subtotal in the preview before reaching here.
  const netTotal = items.reduce((s, i) => s + (Number.isFinite(i.amountEuro) ? i.amountEuro : 0), 0)
  if (netTotal <= 0) {
    return NextResponse.json(
      { error: "Invoice total must be greater than €0. Check the amounts and any discount lines." },
      { status: 400 },
    )
  }

  let result: Awaited<ReturnType<typeof createAndSendInvoice>>
  try {
    result = await createAndSendInvoice({
      customerId: customerId,
      items,
      daysUntilDue: body.daysUntilDue,
      cycleStartDate: periodCycle,
      nextCycleDate: periodEnd,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to send invoice" },
      { status: 500 },
    )
  }

  // Audit trail - log the send with amount + invoice number + mode. Best-effort
  // (helper swallows its own errors) so it never blocks the response.
  await recordBillingEvent({
    action: "invoice_sent",
    mondayItemId,
    stripeCustomerId: customerId,
    stripeInvoiceId: result.invoiceId,
    invoiceNumber: result.number,
    amountEur: result.amountDue,
    detail: { mode, lineItems: items.length, daysUntilDue: body.daysUntilDue ?? 7 },
    actorUserId: session.user.id,
    actorEmail: session.user.email ?? null,
  })

  // ---- Post-send actions (best effort, but surfaced) ----
  // 2026-06-03: Roy reported ProSteal got an invoice sent from Hub but the
  // Monday admin status stayed "Overdue" and the invoice date didn't advance.
  // Likely cause: one of these Monday writes silently failed (Monday API
  // hiccup) - the previous code logged + continued, so finance had no way to
  // know which sync step didn't take. Collect any failure as a warning and
  // include it in the response so the dialog can surface it on the success
  // screen + finance can manually fix Monday before walking away.
  const postSendWarnings: string[] = []

  let newCycle: string | null = null
  let cycleWritten = false
  let adminStamped = false
  // Bundled siblings whose admin we successfully stamped to "Invoice sent
  // (unpaid)" - used to reflect the same status in the cache overlay below.
  const stampedSiblingIds = new Set<string>()

  // Cycle advance + admin stamp are MONTHLY-only. A one-off invoice is a
  // standalone charge that must not disturb the recurring cadence: no date
  // shift, no admin flip. Stripe payment status (billing_summaries, refreshed
  // below) still picks up the new open balance either way.
  //
  // The Hub OWNS the payment-date advance (Monday's automation was removed to
  // avoid a double +1-month jump). Dates are still READ live from Monday, but
  // the Hub is what writes the advance on send. Default is +1 month; finance
  // overrides via `nextCycleDate` for quarterly / 2-month clients (same value
  // that sets the invoice-line period end).
  if (mode === "monthly") {
    // 0. Stamp the Monday "Administration" column to "Invoice sent (unpaid)".
    // Per Roy's 2026-05-19 spec this auto-target may overwrite ANY existing
    // value (incl. Discuss first / Debt collection) because "Stripe shipped
    // the invoice" is an objective fact.
    const adminResult = await setAdministration(mondayItemId, ADMIN_LABELS.invoiceSend)
    adminStamped = adminResult.ok
    if (!adminResult.ok) {
      postSendWarnings.push(
        `Monday admin status could not be set to '${ADMIN_LABELS.invoiceSend}' - update manually. (${adminResult.error})`,
      )
    }

    // 1. Advance the payment date one period forward. `periodEnd` is finance's
    // next-payment date from the dialog (also the invoice-line period end);
    // fall back to +1 month. With no prior cycle we can still ESTABLISH one if
    // finance supplied an explicit date (first invoice after onboarding).
    newCycle = currentCycle ? periodEnd ?? addMonthsIso(currentCycle, 1) : periodEnd
    if (newCycle) {
      try {
        await updateClientField(mondayItemId, { fieldKey: "cycle_start_date", value: newCycle })
        cycleWritten = true
        // Advance + stamp the OTHER campaigns bundled onto this same invoice
        // (same Stripe customer AND same current payment date) so the whole
        // group moves + flips together. Separately-invoiced campaigns on a
        // different date are left alone.
        if (currentCycle) {
          try {
            const siblings = await advanceBundledSiblings(mondayItemId, currentCycle, newCycle)
            for (const sib of siblings) {
              const sibAdmin = await setAdministration(sib.mondayItemId, ADMIN_LABELS.invoiceSend)
              if (sibAdmin.ok) {
                stampedSiblingIds.add(sib.mondayItemId)
              } else {
                postSendWarnings.push(
                  `Linked campaign ${sib.mondayItemId} admin status could not be set to '${ADMIN_LABELS.invoiceSend}' - update manually. (${sibAdmin.error})`,
                )
              }
            }
          } catch (e) {
            console.error(
              `[create-invoice] bundled sibling advance failed for ${mondayItemId}:`,
              e instanceof Error ? e.message : e,
            )
            postSendWarnings.push(
              `Some linked campaigns' payment dates could not advance - check the Billing page.`,
            )
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[create-invoice] cycle advance failed for ${mondayItemId}:`, msg)
        postSendWarnings.push(
          `Payment date could not advance to ${newCycle} - update manually. (${msg})`,
        )
      }
    } else {
      postSendWarnings.push(
        "Client has no payment date set - it won't advance until one is set.",
      )
    }
  }

  // Refresh the Monday boards cache, OVERLAYING what we just wrote (new cycle +
  // derived invoice date + admin stamp) for the primary + bundled siblings.
  // Monday's API is read-after-write eventually-consistent (a fetch right after
  // the write can still return the OLD values), so we force the known-new state
  // onto the fetched snapshot. This is what makes a just-invoiced client leave
  // the Billing "to send" list INSTANTLY - both because its date jumps forward
  // and because the page filters out the "Invoice sent (unpaid)" status.
  if (mode === "monthly" && (cycleWritten || adminStamped || stampedSiblingIds.size > 0)) {
    const newInvoiceDate = newCycle ? deriveInvoiceDate(newCycle) ?? "" : ""
    const overlay = (clients: MondayClient[]): MondayClient[] =>
      clients.map((c) => {
        const isPrimary = c.mondayItemId === mondayItemId
        const isBundledSibling =
          !!currentCycle &&
          !!c.stripeCustomerId &&
          c.stripeCustomerId === customerId &&
          c.cycleStartDate === currentCycle
        const stamped = (isPrimary && adminStamped) || stampedSiblingIds.has(c.mondayItemId)
        if (!isPrimary && !isBundledSibling && !stamped) return c
        const next = { ...c }
        // Advance dates for the group when we wrote a new cycle.
        if (cycleWritten && newCycle && (isPrimary || isBundledSibling)) {
          next.cycleStartDate = newCycle
          next.nextInvoiceDate = newInvoiceDate
        }
        if (stamped) next.administration = ADMIN_LABELS.invoiceSend
        return next
      })

    try {
      const { onboarding, current } = await fetchBothBoards()
      await writeCache("monday_boards", {
        onboarding: overlay(onboarding),
        current: overlay(current),
      })
    } catch (e) {
      console.error(
        "[create-invoice] monday boards cache refresh failed:",
        e instanceof Error ? e.message : e,
      )
      // Re-fetch failed - overlay onto the existing cache so the just-sent
      // client still leaves the "Send invoice" list.
      try {
        const prev = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
          "monday_boards",
        )
        if (prev) {
          await writeCache("monday_boards", {
            onboarding: overlay(prev.onboarding),
            current: overlay(prev.current),
          })
        }
      } catch (e2) {
        console.error(
          "[create-invoice] monday boards cache overlay fallback failed:",
          e2 instanceof Error ? e2.message : e2,
        )
      }
    }
  }

  // 2. Refresh this customer's billing summary so payment-status pill flips.
  try {
    const fresh = await fetchBillingSummary(customerId)
    const existing =
      (await readCache<Record<string, BillingSummary>>("billing_summaries")) ?? {}
    await writeCache("billing_summaries", {
      ...existing,
      [customerId]: fresh,
    })
  } catch (e) {
    console.error(
      `[create-invoice] billing summary refresh failed for ${customerId}:`,
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
    // Silent - this is just a UI hint, not load-bearing.
  }

  return NextResponse.json({
    ok: true,
    ...result,
    mode,
    newCycleStartDate: newCycle,
    postSendWarnings,
  })
}
