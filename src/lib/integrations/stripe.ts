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
}

export type CreateInvoiceResult = {
  invoiceId: string
  number: string | null
  status: string
  amountDue: number
  hostedUrl: string | null
  invoicePdf: string | null
}

/**
 * Create + finalize + send a Stripe invoice for a customer in one shot.
 * Mirrors the manual workflow finance currently does in the Stripe dashboard:
 *   1. New draft invoice with `collection_method: 'send_invoice'`.
 *   2. One invoice-item per line.
 *   3. Finalize → status moves from draft to open.
 *   4. Send → email goes out via Stripe's hosted template.
 *
 * Best-effort cleanup on failure: if any step after `invoices.create` errors,
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

  // 1. Draft.
  const draft = await stripe.invoices.create({
    customer: input.customerId,
    collection_method: "send_invoice",
    days_until_due: daysUntilDue,
    currency,
    auto_advance: false,
  })

  if (!draft.id) throw new Error("Stripe did not return an invoice id")
  const invoiceId = draft.id

  try {
    // 2. Line items — must use cents, Stripe truncates fractional cents.
    for (const item of items) {
      await stripe.invoiceItems.create({
        customer: input.customerId,
        invoice: invoiceId,
        amount: Math.round(item.amountEuro * 100),
        currency,
        description: item.description.trim(),
      })
    }

    // 3. Finalize and 4. send.
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
      await stripe.invoices.voidInvoice(invoiceId)
    } catch {
      // Best-effort — if we can't void it the draft will still need manual cleanup.
    }
    throw e
  }
}
