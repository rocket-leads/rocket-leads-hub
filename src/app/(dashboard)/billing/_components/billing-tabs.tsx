"use client"

import { useState } from "react"
import { CalendarClock, FileText } from "lucide-react"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { BillingOverview, type BillingGroup } from "./billing-overview"
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
  { id: "past", label: "Past invoices", icon: FileText },
]

/**
 * Tabs wrapper for the Billing page - splits the original "what's coming up"
 * view from the "what already went out" view. Future = the upcoming-invoice
 * timeline finance acts on today; Past = the audit/chase view of everything
 * Stripe has on record (paid + open + overdue + void).
 */
export function BillingTabs({
  futureGroups,
  pastInvoices,
  adminOptions,
}: {
  futureGroups: BillingGroup[]
  pastInvoices: PastInvoiceRow[]
  /** Distinct admin labels currently in use across all clients - feeds the
   *  Admin column's edit popover so finance can pick any value Monday already
   *  knows about. */
  adminOptions: string[]
}) {
  const [tab, setTab] = useState<Tab>("future")
  // Tab badges count "what needs action now":
  //   Future = invoices due this week (overdue + today + through Sunday) -
  //     same window as the BillingOverview "Due this week" headline.
  //     Counted on GROUPS not rows, so a multi-campaign client = 1 invoice.
  //     Strict overdue alone reads as "0" most days when finance is on top
  //     of things, which makes the badge feel useless; including the
  //     current-week queue surfaces what's actually on their plate.
  //   Past = Stripe invoices in overdue state - money to chase.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayMs = today.getTime()
  const dayMs = 24 * 60 * 60 * 1000
  const dayOfWeek = today.getDay() // 0 = Sun
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek
  const endOfThisWeekMs = todayMs + daysUntilSunday * dayMs

  const futureSendCount = futureGroups.filter((g) => {
    if (!g.primary.nextInvoiceDate) return false
    const d = new Date(g.primary.nextInvoiceDate)
    d.setHours(0, 0, 0, 0)
    return d.getTime() <= endOfThisWeekMs
  }).length
  const pastOverdueCount = pastInvoices.filter((i) => i.status === "overdue").length

  const tabsWithCounts: TopTab<Tab>[] = TABS.map((t) => ({
    ...t,
    count: t.id === "future" ? futureSendCount : pastOverdueCount,
  }))

  return (
    <div className="space-y-5">
      <TopTabs<Tab> tabs={tabsWithCounts} value={tab} onChange={setTab} />
      {tab === "future" && <BillingOverview groups={futureGroups} adminOptions={adminOptions} />}
      {tab === "past" && <PastInvoicesView invoices={pastInvoices} />}
    </div>
  )
}
