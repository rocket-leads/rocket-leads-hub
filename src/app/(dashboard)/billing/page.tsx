import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/server"
import {
  normalizeCampaigns,
  totalAdBudget,
  totalMRR,
} from "@/lib/clients/agreement"
import { BillingOverview, type UpcomingInvoice } from "./_components/billing-overview"

/**
 * Finance overview page — admin-only for now (sidebar gate enforces this; a
 * direct visit by a non-admin redirects). Surfaces every client with a
 * `next_invoice_date` set, so finance has one place to see what's coming
 * without clicking into 50 separate Billing tabs.
 */
export default async function BillingPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")
  if (session.user.role !== "admin") redirect("/clients")

  const supabase = await createAdminClient()

  const [{ data: clients }, { data: agreements }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, monday_item_id, name, next_invoice_date, stripe_customer_id")
      .not("next_invoice_date", "is", null)
      .order("next_invoice_date", { ascending: true }),
    supabase
      .from("client_agreements")
      .select("client_id, campaigns"),
  ])

  const moneyByClient = new Map<string, { mrr: number; adBudget: number }>()
  for (const a of agreements ?? []) {
    const campaigns = normalizeCampaigns(a.campaigns)
    moneyByClient.set(a.client_id as string, {
      mrr: totalMRR(campaigns),
      adBudget: totalAdBudget(campaigns),
    })
  }

  const rows: UpcomingInvoice[] = (clients ?? []).map((c) => {
    const money = moneyByClient.get(c.id)
    return {
      mondayItemId: c.monday_item_id,
      name: c.name,
      nextInvoiceDate: c.next_invoice_date,
      stripeCustomerId: c.stripe_customer_id,
      mrr: money?.mrr ?? 0,
      adBudget: money?.adBudget ?? 0,
    }
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-heading font-semibold tracking-tight leading-tight">
          Billing
        </h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          Upcoming invoices grouped by when they&apos;re due. The Hub auto-creates
          a finance task on the due date and auto-completes it once the matching
          Stripe invoice is sent.
        </p>
      </div>
      <BillingOverview rows={rows} />
    </div>
  )
}
