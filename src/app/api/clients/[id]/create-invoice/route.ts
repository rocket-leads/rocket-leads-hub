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
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { updateClientField } from "@/lib/clients/edit"
import { addMonthsIso, deriveInvoiceDate } from "@/lib/clients/billing-cycle"
import { setAdministration } from "@/lib/clients/administration-sync"
import { ADMIN_LABELS } from "@/lib/clients/administration"
import { readCache, writeCache } from "@/lib/cache"

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

/** `YYYY-MM-DD` guard - shared by the sibling-resolution + cache-patch logic. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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

  // ---- Post-send actions (best effort, but surfaced) ----
  // 2026-06-03: Roy reported ProSteal got an invoice sent from Hub but the
  // Monday admin status stayed "Overdue" and the invoice date didn't advance.
  // Likely cause: one of these Monday writes silently failed (Monday API
  // hiccup) - the previous code logged + continued, so finance had no way to
  // know which sync step didn't take. Collect any failure as a warning and
  // include it in the response so the dialog can surface it on the success
  // screen + finance can manually fix Monday before walking away.
  const postSendWarnings: string[] = []

  // ── Resolve every Monday row this invoice covers (primary + siblings) ──
  // Multi-campaign clients (e.g. "Nexa | B2B" + "Nexa | B2C") share one Stripe
  // customer and one billing cycle, and the dialog consolidates ALL their line
  // items into the single invoice we just sent. So every sibling row - not just
  // the one whose id arrived on the URL - needs its admin label flipped and its
  // cycle advanced. If we touched only the primary, the untouched siblings keep
  // their old cycle date, split off into their own stale "Send invoice" group
  // on the next render, and finance thinks a second invoice is owed.
  //
  // Siblings are read from the same monday_boards cache the Billing page groups
  // from, matched on (stripe customer + next-invoice-date) - the exact bundling
  // key `groupBillingRows` uses, so the Hub-side row set matches what was sent.
  const boardsCache = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
  )
  const allCachedRows = boardsCache
    ? [...boardsCache.onboarding, ...boardsCache.current]
    : []
  const primaryRow = allCachedRows.find((c) => c.mondayItemId === mondayItemId)
  const groupInvoiceDate =
    primaryRow && DATE_RE.test(primaryRow.nextInvoiceDate) ? primaryRow.nextInvoiceDate : ""
  const siblingIds =
    groupInvoiceDate
      ? allCachedRows
          .filter(
            (c) =>
              c.stripeCustomerId === client.stripe_customer_id &&
              c.nextInvoiceDate === groupInvoiceDate,
          )
          .map((c) => c.mondayItemId)
      : []
  // Always include the row we were called with, even if the cache missed it.
  const targetItemIds = Array.from(new Set([mondayItemId, ...siblingIds]))

  const nameById = new Map(allCachedRows.map((c) => [c.mondayItemId, c.name]))
  const rowLabel = (id: string): string => nameById.get(id) ?? id

  // Each row's own current cycle (Monday `date3`). Primary falls back to the
  // Supabase mirror when the cache row is missing (cold cache). Advancing each
  // row from its OWN date keeps siblings honest even if one drifted.
  const cycleOf = (id: string): string | null => {
    const row = allCachedRows.find((c) => c.mondayItemId === id)
    if (row && DATE_RE.test(row.cycleStartDate)) return row.cycleStartDate
    const supaCycle = (client.cycle_start_date as string | null) ?? ""
    if (id === mondayItemId && DATE_RE.test(supaCycle)) return supaCycle
    return null
  }

  // 0 + 1. For every covered row: stamp the Monday "Administration" column to
  // "Invoice sent (unpaid)" and advance its cycle one month. Per Roy's
  // 2026-05-19 spec the admin stamp is the one auto-target allowed to overwrite
  // ANY existing value (incl. Discuss first / Debt collection agency) because
  // "Stripe shipped the invoice" is an objective fact. Track per-row success so
  // a partial Monday failure is surfaced AND the cache patch stays honest.
  const adminOkById = new Map<string, boolean>()
  const newCycleById = new Map<string, string>()
  for (const itemId of targetItemIds) {
    const adminRes = await setAdministration(itemId, ADMIN_LABELS.invoiceSend)
    adminOkById.set(itemId, adminRes.ok)
    if (!adminRes.ok) {
      postSendWarnings.push(
        `Monday admin status could not be set to '${ADMIN_LABELS.invoiceSend}' for ${rowLabel(itemId)} - update manually. (${adminRes.error})`,
      )
    }

    const cur = cycleOf(itemId)
    if (cur) {
      const nc = addMonthsIso(cur, 1)
      if (nc) {
        try {
          await updateClientField(itemId, { fieldKey: "cycle_start_date", value: nc })
          newCycleById.set(itemId, nc)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`[create-invoice] cycle advance failed for ${itemId}:`, msg)
          postSendWarnings.push(
            `Monday invoice date could not advance to ${nc} for ${rowLabel(itemId)} - update manually. (${msg})`,
          )
        }
      }
    } else if (itemId === mondayItemId) {
      // No cycle on the primary means we won't advance one - surface it so
      // finance can backfill the cycle date in Monday if they expected it.
      postSendWarnings.push(
        "Client has no cycle date in Monday - invoice date won't auto-advance until one is set.",
      )
    }
  }
  // Primary's new cycle drives the response payload (the dialog shows it).
  const newCycle = newCycleById.get(mondayItemId) ?? null

  // 1a. Patch the Monday boards cache in place so the Billing page reflects the
  // new admin status + advanced cycle on the very next render.
  //
  // 2026-06-18: Roy reported Nexa / Inland Invest / GLS Finance got invoices
  // sent from the Hub - Monday's label flipped to "Invoice sent (unpaid)" but
  // the Hub's own "Send invoice" pill stayed stuck. Root cause: the Admin
  // column is read PURELY from this cache (`c.administration`) with no Supabase
  // mirror fallback like the dates have, and the old refresh both (a) only ran
  // when a cycle was written and (b) re-fetched from Monday - a read-after-write
  // race that could return the pre-flip value.
  //
  // We KNOW the per-row truth here, so patch each covered row directly instead
  // of re-reading Monday. Deterministic, instant, honest per-row (only flip the
  // fields whose Monday write actually succeeded), and covers the no-cycle case.
  try {
    if (boardsCache) {
      const targetSet = new Set(targetItemIds)
      const patchRow = (c: MondayClient): MondayClient => {
        if (!targetSet.has(c.mondayItemId)) return c
        const next: MondayClient = { ...c }
        if (adminOkById.get(c.mondayItemId)) next.administration = ADMIN_LABELS.invoiceSend
        const nc = newCycleById.get(c.mondayItemId)
        if (nc) {
          next.cycleStartDate = nc
          next.nextInvoiceDate = deriveInvoiceDate(nc) ?? c.nextInvoiceDate
        }
        return next
      }
      await writeCache("monday_boards", {
        onboarding: boardsCache.onboarding.map(patchRow),
        current: boardsCache.current.map(patchRow),
      })
    } else if (newCycleById.size > 0) {
      // Cold cache - fall back to a full fetch so the advanced cycle lands.
      const { onboarding, current } = await fetchBothBoards()
      await writeCache("monday_boards", { onboarding, current })
    }
  } catch (e) {
    console.error(
      "[create-invoice] monday boards cache patch failed:",
      e instanceof Error ? e.message : e,
    )
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
    // Silent - this is just a UI hint, not load-bearing.
  }

  return NextResponse.json({
    ok: true,
    ...result,
    newCycleStartDate: newCycle,
    postSendWarnings,
  })
}
