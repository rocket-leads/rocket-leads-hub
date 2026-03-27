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
