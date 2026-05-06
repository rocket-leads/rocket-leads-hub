"use client"

import { useState } from "react"
import { CalendarClock, Receipt } from "lucide-react"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { BillingOverview, type UpcomingInvoice } from "./billing-overview"
import { PastInvoicesView } from "./past-invoices-view"
import type { PastInvoice } from "@/lib/integrations/stripe"

/** Past-invoice row enriched with the client name + Monday id so the table
 *  can render a clickable client cell + show "Unknown customer" when the
 *  Stripe customer id isn't linked to any Monday client (gracefully). */
export type PastInvoiceRow = PastInvoice & {
  clientName: string | null
  clientMondayItemId: string | null
}

type Tab = "future" | "past"

const TABS: TopTab<Tab>[] = [
  { id: "future", label: "Future invoices", icon: CalendarClock },
  { id: "past", label: "Past invoices", icon: Receipt },
]

/**
 * Tabs wrapper for the Billing page — splits the original "what's coming up"
 * view from the "what already went out" view. Future = the upcoming-invoice
 * timeline finance acts on today; Past = the audit/chase view of everything
 * Stripe has on record (paid + open + overdue + void).
 */
export function BillingTabs({
  futureRows,
  pastInvoices,
}: {
  futureRows: UpcomingInvoice[]
  pastInvoices: PastInvoiceRow[]
}) {
  const [tab, setTab] = useState<Tab>("future")
  // Tab badges count overdue only — finance is triaging "what needs chasing
  // today", not "how many invoices exist". For Future = clients past their
  // next-invoice date (same rule as the Overdue section in BillingOverview).
  // For Past = Stripe invoices in overdue state.
  const todayMs = (() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  })()
  const futureOverdueCount = futureRows.filter((r) => {
    if (!r.nextInvoiceDate) return false
    const d = new Date(r.nextInvoiceDate)
    d.setHours(0, 0, 0, 0)
    return d.getTime() < todayMs
  }).length
  const pastOverdueCount = pastInvoices.filter((i) => i.status === "overdue").length

  const tabsWithCounts: TopTab<Tab>[] = TABS.map((t) => ({
    ...t,
    count: t.id === "future" ? futureOverdueCount : pastOverdueCount,
  }))

  return (
    <div className="space-y-5">
      <TopTabs<Tab> tabs={tabsWithCounts} value={tab} onChange={setTab} />
      {tab === "future" && <BillingOverview rows={futureRows} />}
      {tab === "past" && <PastInvoicesView invoices={pastInvoices} />}
    </div>
  )
}
