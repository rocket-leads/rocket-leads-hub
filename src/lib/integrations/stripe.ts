import Stripe from "stripe"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

async function getStripe(): Promise<Stripe> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "stripe")
    .single()
  if (!data) throw new Error("Stripe token not configured. Go to Settings → API Tokens.")
  const key = decrypt(data.token_encrypted)
  return new Stripe(key)
}

export type InvoiceRow = {
  id: string
  number: string | null
  amountDue: number
  amountPaid: number
  status: "paid" | "open" | "overdue" | "void" | "draft"
  created: number
  dueDate: number | null
  paidAt: number | null
  invoicePdf: string | null
  hostedUrl: string | null
}

export type BillingData = {
  customerId: string
  customerName: string | null
  customerEmail: string | null
  invoices: InvoiceRow[]
  totalInvoiced: number
  totalPaid: number
  totalOutstanding: number
  avgPaymentDays: number | null
}

function deriveStatus(inv: Stripe.Invoice): InvoiceRow["status"] {
  if (inv.status === "paid") return "paid"
  if (inv.status === "void") return "void"
  if (inv.status === "draft") return "draft"
  if (inv.status === "open") {
    const now = Math.floor(Date.now() / 1000)
    if (inv.due_date && inv.due_date < now) return "overdue"
    return "open"
  }
  return "open"
}

export type BillingSummary = {
  customerId: string
  outstanding: number
  status: "complete" | "open" | "overdue"
}

export type PastInvoice = {
  id: string
  number: string | null
  /** Stripe customer ID — joined to Monday clients on the page so finance
   *  can see "client name" instead of `cus_…`. */
  customerId: string
  amountDue: number
  amountPaid: number
  status: "paid" | "open" | "overdue" | "void" | "draft"
  /** Invoice creation timestamp (Unix seconds). */
  created: number
  /** Invoice due date (Unix seconds), or null when collection is "charge_automatically". */
  dueDate: number | null
  /** When the invoice flipped to paid (Unix seconds), or null. */
  paidAt: number | null
  invoicePdf: string | null
  hostedUrl: string | null
}

/**
 * Pull every Stripe invoice across all customers within the last `daysBack`
 * days. Uses Stripe's global `invoices.list` with a `created[gte]` filter so
 * we don't have to iterate per customer (much cheaper for the dashboard
 * "past invoices" view that needs the union of everyone's history).
 *
 * Pagination handled internally — yields the full list in one return. Stops
 * at 5000 invoices as a safety cap (we'd never legitimately need more for a
 * default 180-day window; misconfiguration would otherwise burn API quota).
 */
export async function fetchAllRecentInvoices(daysBack: number): Promise<PastInvoice[]> {
  const stripe = await getStripe()
  const since = Math.floor((Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000)
  const out: PastInvoice[] = []
  const HARD_CAP = 5000

  let startingAfter: string | undefined
  let hasMore = true
  while (hasMore && out.length < HARD_CAP) {
    const page = await stripe.invoices.list({
      created: { gte: since },
      limit: 100,
      expand: ["data.status_transitions"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const inv of page.data) {
      // Drafts are noise on the past-invoices view — finance hasn't sent them
      // yet, so they don't belong in the "what's gone out" list.
      if (inv.status === "draft") continue
      const customerId =
        typeof inv.customer === "string"
          ? inv.customer
          : (inv.customer as { id?: string } | null)?.id ?? ""
      if (!customerId) continue
      out.push({
        id: inv.id ?? "",
        number: inv.number,
        customerId,
        amountDue: inv.amount_due / 100,
        amountPaid: inv.amount_paid / 100,
        status: deriveStatus(inv),
        created: inv.created,
        dueDate: inv.due_date ?? null,
        paidAt: (inv.status_transitions as Stripe.Invoice.StatusTransitions)?.paid_at ?? null,
        invoicePdf: inv.invoice_pdf ?? null,
        hostedUrl: inv.hosted_invoice_url ?? null,
      })
    }
    hasMore = page.has_more
    startingAfter = page.data[page.data.length - 1]?.id
    if (!startingAfter) break
  }

  // Most-recent first — matches what finance expects to see at the top.
  out.sort((a, b) => b.created - a.created)
  return out
}

/**
 * Refresh BillingSummary for a list of Stripe customer IDs in parallel,
 * returning the resulting map. Used by the hourly Stripe-refresh cron and
 * the manual Refresh button on /billing so payment state never goes stale
 * by more than an hour. Concurrency capped to 5 — Stripe rate-limits at
 * ~25 req/s but we want to leave headroom for other Stripe traffic.
 *
 * Caller is responsible for writing the cache; this only produces data.
 * Per-customer failures are logged and skipped (those entries are absent
 * from the returned map, so the cache write only updates resolved ones).
 */
export async function refreshBillingSummaries(
  customerIds: string[],
): Promise<{ summaries: Record<string, BillingSummary>; failed: number }> {
  const summaries: Record<string, BillingSummary> = {}
  let failed = 0
  const queue = [...customerIds]
  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift()
      if (!id) return
      try {
        summaries[id] = await fetchBillingSummary(id)
      } catch (e) {
        failed++
        console.error(`refreshBillingSummaries(${id}) failed:`, e instanceof Error ? e.message : e)
      }
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker))
  return { summaries, failed }
}

export async function fetchBillingSummary(customerId: string): Promise<BillingSummary> {
  const stripe = await getStripe()
  const now = Math.floor(Date.now() / 1000)

  const openInvoices = await stripe.invoices.list({ customer: customerId, status: "open", limit: 100 })
  const all = [...openInvoices.data]
  let hasMore = openInvoices.has_more
  let startingAfter = openInvoices.data[openInvoices.data.length - 1]?.id
  while (hasMore && startingAfter) {
    const page = await stripe.invoices.list({ customer: customerId, status: "open", limit: 100, starting_after: startingAfter })
    all.push(...page.data)
    hasMore = page.has_more
    startingAfter = page.data[page.data.length - 1]?.id
  }

  const outstanding = all.reduce((sum, inv) => sum + inv.amount_due / 100, 0)
  const hasOverdue = all.some((inv) => inv.due_date && inv.due_date < now)
  const status = outstanding === 0 ? "complete" : hasOverdue ? "overdue" : "open"

  return { customerId, outstanding, status }
}

/** Single overdue invoice, pre-trimmed to what the weekly-update block needs:
 *  the amount the client still owes, the Stripe-hosted payment page so they
 *  can settle directly, and a human-readable invoice label. */
export type OverdueInvoice = {
  id: string
  number: string | null
  amountDue: number
  dueDate: number | null
  hostedUrl: string | null
}

/**
 * Every still-open invoice past its due date for the given customer.
 * Sorted oldest-first so the message lists them in escalation order
 * (most overdue at the top).
 *
 * Used by the weekly-update composer to always include a "betaal hier"
 * block when a client has overdue invoices — Roy 2026-05-23: AMs were
 * not consistently chasing these themselves, so it goes in the update
 * by default with one payment link per invoice.
 *
 * Best-effort: returns [] on any Stripe failure so the rest of the
 * weekly-update pipeline still runs.
 */
export async function fetchOverdueInvoices(
  customerId: string,
): Promise<OverdueInvoice[]> {
  try {
    const stripe = await getStripe()
    const now = Math.floor(Date.now() / 1000)

    const out: OverdueInvoice[] = []
    let startingAfter: string | undefined
    let hasMore = true
    while (hasMore) {
      const page = await stripe.invoices.list({
        customer: customerId,
        status: "open",
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
      for (const inv of page.data) {
        if (!inv.due_date || inv.due_date >= now) continue
        out.push({
          id: inv.id ?? "",
          number: inv.number,
          amountDue: inv.amount_due / 100,
          dueDate: inv.due_date ?? null,
          hostedUrl: inv.hosted_invoice_url ?? null,
        })
      }
      hasMore = page.has_more
      startingAfter = page.data[page.data.length - 1]?.id
      if (!startingAfter) break
    }
    out.sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0))
    return out
  } catch {
    return []
  }
}

/** Bulgaria VAT rate. RL Ltd. is BG-registered (BG208169940) so customers
 *  without a registered EU tax ID get charged at this rate. Customers WITH a
 *  valid tax ID get reverse-charge (0%).
 *
 *  Used ONLY by the local preview computation so Finance can see the expected
 *  totals before approving. The actual invoice send uses Stripe `automatic_tax`
 *  which computes the rate (and reverse-charge eligibility) from the BG origin
 *  + customer address + tax IDs on file. The two should match by construction;
 *  if they ever drift, Stripe's number is authoritative. */
const BG_VAT_RATE = 0.20

// Keywords that identify ad budget line items on Stripe invoices
const AD_BUDGET_KEYWORDS = [
  "advertentiebudget",
  "advertising budget",
  "adspend",
  "ad spend",
  "ad budget",
  "mediabudget",
  "media budget",
]

function isAdBudgetLineItem(description: string | null): boolean {
  if (!description) return false
  const lower = description.toLowerCase()
  return AD_BUDGET_KEYWORDS.some((kw) => lower.includes(kw))
}

export type AdBudgetInvoiced = {
  totalInvoiced: number
  lineItems: Array<{
    invoiceNumber: string | null
    date: number
    description: string
    amount: number
  }>
}

export async function fetchInvoicedAdBudget(customerId: string): Promise<AdBudgetInvoiced> {
  const stripe = await getStripe()

  const lineItems: AdBudgetInvoiced["lineItems"] = []
  let totalInvoiced = 0

  // Fetch all non-draft invoices and inspect their line items
  let hasMore = true
  let startingAfter: string | undefined

  while (hasMore) {
    const page = await stripe.invoices.list({
      customer: customerId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })

    for (const inv of page.data) {
      if (inv.status === "draft" || inv.status === "void") continue

      for (const line of inv.lines?.data ?? []) {
        const desc = line.description ?? ""
        if (isAdBudgetLineItem(desc)) {
          const amount = line.amount / 100
          totalInvoiced += amount
          lineItems.push({
            invoiceNumber: inv.number,
            date: inv.created,
            description: desc,
            amount,
          })
        }
      }
    }

    hasMore = page.has_more
    startingAfter = page.data[page.data.length - 1]?.id
  }

  lineItems.sort((a, b) => b.date - a.date)
  return { totalInvoiced, lineItems }
}

export async function fetchBillingData(customerId: string): Promise<BillingData> {
  const stripe = await getStripe()

  const [customer, invoicesPage] = await Promise.all([
    stripe.customers.retrieve(customerId),
    stripe.invoices.list({ customer: customerId, limit: 100, expand: ["data.status_transitions"] }),
  ])

  if (customer.deleted) throw new Error("Stripe customer not found.")

  const allInvoices: Stripe.Invoice[] = [...invoicesPage.data]
  let hasMore = invoicesPage.has_more
  let startingAfter = invoicesPage.data[invoicesPage.data.length - 1]?.id

  while (hasMore && startingAfter) {
    const page = await stripe.invoices.list({
      customer: customerId,
      limit: 100,
      starting_after: startingAfter,
      expand: ["data.status_transitions"],
    })
    allInvoices.push(...page.data)
    hasMore = page.has_more
    startingAfter = page.data[page.data.length - 1]?.id
  }

  const invoices: InvoiceRow[] = allInvoices
    .filter((inv) => inv.status !== "draft")
    .map((inv) => ({
      id: inv.id,
      number: inv.number,
      amountDue: inv.amount_due / 100,
      amountPaid: inv.amount_paid / 100,
      status: deriveStatus(inv),
      created: inv.created,
      dueDate: inv.due_date ?? null,
      paidAt: (inv.status_transitions as Stripe.Invoice.StatusTransitions)?.paid_at ?? null,
      invoicePdf: inv.invoice_pdf ?? null,
      hostedUrl: inv.hosted_invoice_url ?? null,
    }))
    .sort((a, b) => b.created - a.created)

  const totalInvoiced = invoices
    .filter((i) => i.status !== "void")
    .reduce((sum, i) => sum + i.amountDue, 0)

  const totalPaid = invoices
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + i.amountPaid, 0)

  const totalOutstanding = invoices
    .filter((i) => i.status === "open" || i.status === "overdue")
    .reduce((sum, i) => sum + i.amountDue, 0)

  const paidWithDates = invoices.filter((i) => i.status === "paid" && i.paidAt)
  const avgPaymentDays =
    paidWithDates.length > 0
      ? paidWithDates.reduce((sum, i) => sum + (i.paidAt! - i.created) / 86400, 0) /
        paidWithDates.length
      : null

  return {
    customerId,
    customerName: (customer as Stripe.Customer).name ?? null,
    customerEmail: (customer as Stripe.Customer).email ?? null,
    invoices,
    totalInvoiced,
    totalPaid,
    totalOutstanding,
    avgPaymentDays: avgPaymentDays ? Math.round(avgPaymentDays) : null,
  }
}

export type CreateInvoiceInput = {
  customerId: string
  /** One line per service. Amounts are expected in EUR (e.g. 450 for €450.00),
   *  converted to cents on the way into Stripe. Empty array → throws. */
  items: Array<{ description: string; amountEuro: number }>
  /** Days from today until the invoice is due. Defaults to 7 — matches the
   *  standard Rocket Leads payment term. */
  daysUntilDue?: number
  currency?: string
  /** Billing cycle start date (`YYYY-MM-DD`) that this invoice covers. When
   *  set, every line item is tagged with Stripe's `period.start`/`period.end`
   *  (cycle_start → cycle_start + 1 month - 1 day) and the line description
   *  gets a "(26 May – 25 Jun 2026)" suffix so the customer can see exactly
   *  which period they're paying for. Omit when finance doesn't have a
   *  cycle yet — the invoice just won't carry a period block. */
  cycleStartDate?: string | null
}

export type CreateInvoiceResult = {
  invoiceId: string
  number: string | null
  status: string
  amountDue: number
  hostedUrl: string | null
  invoicePdf: string | null
}

/** Preview snapshot for the Finance approval screen — fetched read-only
 *  from Stripe (customer + tax IDs) and computed locally from the form's
 *  line items. NO draft is created; Stripe sees nothing until the user
 *  approves and the actual send fires. All amounts in EUR. */
export type InvoiceDraftPreview = {
  customer: {
    name: string | null
    email: string | null
    address: {
      line1: string | null
      line2: string | null
      postal_code: string | null
      city: string | null
      country: string | null
    } | null
    taxExempt: "none" | "exempt" | "reverse" | null
    /** All registered tax IDs for this customer (BTW, VAT, etc.). One entry
     *  per ID — Stripe allows multiples. Used by the preview to show "BTW
     *  NL123456789" so finance can verify the right number is on the invoice. */
    taxIds: Array<{ type: string; value: string }>
  }
  /** Period suffix appended to each line description on the actual invoice
   *  (e.g. "(3 Jun – 2 Jul 2026)"). Null when there's no cycle yet. */
  periodLabel: string | null
  lineItems: Array<{ description: string; amount: number }>
  subtotal: number
  /** Expected tax for this invoice, computed locally to mirror what Stripe
   *  `automatic_tax` will calculate on send: 0 if the customer has a valid
   *  EU tax ID (reverse charge), else 20% BG VAT on the subtotal. Stripe is
   *  the source of truth at send-time; this is a preview-side estimate. */
  tax: number
  total: number
  daysUntilDue: number
}

/**
 * Read-only preview for the Finance approval screen. Fetches the Stripe
 * customer + tax IDs (no mutation) and computes the line-item totals from
 * the form input so Finance can verify recipient + amounts + BTW status
 * BEFORE anything touches Stripe. No draft is created; nothing exists in
 * Stripe until the actual send fires after approval.
 *
 * Tax handling: the actual send uses Stripe `automatic_tax` so Stripe
 * computes the rate from the BG origin + customer address + tax IDs. The
 * preview mirrors the same rules locally — 0% with a valid EU tax ID,
 * else 20% BG VAT — so Finance sees an accurate total before approving.
 */
export async function fetchInvoicePreview(input: CreateInvoiceInput): Promise<InvoiceDraftPreview> {
  const items = input.items.filter((i) => i.description.trim() && i.amountEuro > 0)
  if (items.length === 0) {
    throw new Error("At least one line item with a description and amount is required.")
  }

  const stripe = await getStripe()
  const daysUntilDue = Math.max(0, Math.trunc(input.daysUntilDue ?? 7))
  const period = resolveBillingPeriod(input.cycleStartDate ?? null)

  const [customer, taxIds] = await Promise.all([
    stripe.customers.retrieve(input.customerId),
    stripe.customers.listTaxIds(input.customerId, { limit: 10 }),
  ])
  if (customer.deleted) {
    throw new Error("Stripe customer is deleted")
  }

  const lineItems = items.map((item) => ({
    description: period ? `${item.description.trim()} (${period.label})` : item.description.trim(),
    amount: item.amountEuro,
  }))
  const subtotal = lineItems.reduce((sum, l) => sum + l.amount, 0)
  // BTW handling — mirrors what Stripe `automatic_tax` will charge on send:
  //   - Customer has a registered tax ID (BTW number) → reverse charge, 0%.
  //   - No tax ID on file → RL is BG-registered, charges 20% BG VAT.
  // Stripe is the source of truth at send-time; this local computation is
  // for the preview so Finance can see the expected total before approving.
  const hasTaxId = (taxIds.data?.length ?? 0) > 0
  const tax = hasTaxId ? 0 : Math.round(subtotal * BG_VAT_RATE * 100) / 100
  const total = subtotal + tax

  return {
    customer: {
      name: customer.name ?? null,
      email: customer.email ?? null,
      address: customer.address
        ? {
            line1: customer.address.line1 ?? null,
            line2: customer.address.line2 ?? null,
            postal_code: customer.address.postal_code ?? null,
            city: customer.address.city ?? null,
            country: customer.address.country ?? null,
          }
        : null,
      taxExempt: (customer.tax_exempt as "none" | "exempt" | "reverse" | null) ?? null,
      taxIds: (taxIds.data ?? []).map((t) => ({
        type: t.type,
        value: t.value ?? "",
      })),
    },
    periodLabel: period?.label ?? null,
    lineItems,
    subtotal,
    tax,
    total,
    daysUntilDue,
  }
}

/**
 * Create + finalize + send a Stripe invoice for a customer in one shot.
 * Mirrors the manual workflow finance does in the Stripe dashboard. Best-
 * effort cleanup on failure: if any step after `invoices.create` errors,
 * the draft is voided so it doesn't sit in Stripe forever as half-built.
 */
export async function createAndSendInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
  const items = input.items.filter((i) => i.description.trim() && i.amountEuro > 0)
  if (items.length === 0) {
    throw new Error("At least one line item with a description and amount is required.")
  }

  const stripe = await getStripe()
  const currency = (input.currency ?? "eur").toLowerCase()
  const daysUntilDue = Math.max(0, Math.trunc(input.daysUntilDue ?? 7))
  const period = resolveBillingPeriod(input.cycleStartDate ?? null)

  // Stripe `automatic_tax` handles VAT end-to-end: it looks up the customer's
  // tax IDs + address, applies BG origin rules (RL is BG-registered,
  // BG208169940), and produces 0% reverse-charge for valid EU tax IDs or 20%
  // BG VAT otherwise. The tax shows up on the finalized invoice as a tax
  // amount, NOT a separate line item — same way it appears when finance
  // creates an invoice in the Stripe dashboard with automatic tax on.
  const draft = await stripe.invoices.create({
    customer: input.customerId,
    collection_method: "send_invoice",
    days_until_due: daysUntilDue,
    currency,
    auto_advance: false,
    automatic_tax: { enabled: true },
  })
  if (!draft.id) throw new Error("Stripe did not return an invoice id")
  const invoiceId = draft.id

  try {
    for (const item of items) {
      const description = period
        ? `${item.description.trim()} (${period.label})`
        : item.description.trim()
      const amountCents = Math.round(item.amountEuro * 100)
      await stripe.invoiceItems.create({
        customer: input.customerId,
        invoice: invoiceId,
        amount: amountCents,
        currency,
        description,
        ...(period
          ? { period: { start: period.unixStart, end: period.unixEnd } }
          : {}),
      })
    }

    await stripe.invoices.finalizeInvoice(invoiceId)
    const sent = await stripe.invoices.sendInvoice(invoiceId)

    return {
      invoiceId,
      number: sent.number,
      status: sent.status ?? "open",
      amountDue: (sent.amount_due ?? 0) / 100,
      hostedUrl: sent.hosted_invoice_url ?? null,
      invoicePdf: sent.invoice_pdf ?? null,
    }
  } catch (e) {
    // Roll back the draft so half-built invoices don't pile up.
    try {
      await stripe.invoices.del(invoiceId)
    } catch {
      // Best-effort — if we can't delete it the draft will still need manual cleanup.
    }
    throw e
  }
}

/**
 * Compute the billing period covered by an invoice given its cycle start.
 * The Rocket Leads cadence is monthly, so the period runs from cycle_start
 * to the day BEFORE the next cycle start — i.e. 26 May → 25 Jun (not 26 Jun)
 * so two consecutive periods don't visually overlap on the customer's bank
 * statement.
 *
 * Returns null when the cycle string is empty or malformed. Caller checks
 * for null and omits the period block in that case.
 */
function resolveBillingPeriod(
  cycleStartDate: string | null,
): { unixStart: number; unixEnd: number; label: string } | null {
  if (!cycleStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(cycleStartDate)) return null
  const [y, m, d] = cycleStartDate.split("-").map(Number)
  // UTC math — same approach as `addMonthsIso` in clients/billing-cycle.ts.
  const startUtcMs = Date.UTC(y, m - 1, d)
  // End = same-day next month, then -1 day → "25 Jun" for a 26 May cycle.
  // Clamp the day to the target month's last day so 31 Jan + 1mo - 1d
  // becomes 27/28 Feb (not 30 Feb).
  const totalMonths = m - 1 + 1
  const endYear = y + Math.floor(totalMonths / 12)
  const endMonthIdx = ((totalMonths % 12) + 12) % 12
  const lastDayNextMonth = new Date(Date.UTC(endYear, endMonthIdx + 1, 0)).getUTCDate()
  const endDay = Math.min(d, lastDayNextMonth)
  const endUtcMs = Date.UTC(endYear, endMonthIdx, endDay) - 24 * 60 * 60 * 1000

  // Stripe expects period boundaries in Unix seconds (not ms).
  const unixStart = Math.floor(startUtcMs / 1000)
  const unixEnd = Math.floor(endUtcMs / 1000)

  // Human-readable label for the description suffix. Year is shown once at
  // the end so "26 May – 25 Jun 2026" reads cleanly; falls back to two-year
  // form when the period straddles a year boundary (e.g. Dec → Jan).
  const startDate = new Date(startUtcMs)
  const endDate = new Date(endUtcMs)
  const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear()
  const fmt = (date: Date, withYear: boolean) =>
    date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: withYear ? "numeric" : undefined,
      timeZone: "UTC",
    })
  const label = sameYear
    ? `${fmt(startDate, false)} – ${fmt(endDate, true)}`
    : `${fmt(startDate, true)} – ${fmt(endDate, true)}`

  return { unixStart, unixEnd, label }
}
