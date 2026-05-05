import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import type { BillingSummary } from "@/lib/integrations/stripe"
import {
  normalizeCampaigns,
  totalAdBudget,
  totalMRR,
} from "@/lib/clients/agreement"
import { mondayStatusToHub } from "@/lib/clients/status"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import { BillingOverview, type UpcomingInvoice } from "./_components/billing-overview"
import { SyncFromMondayButton } from "./_components/sync-from-monday-button"

/**
 * Finance overview page — open to anyone signed in. Surfaces every client
 * with a `next_invoice_date` set, so finance has one place to see what's
 * coming without clicking into 50 separate Billing tabs.
 *
 * Date sourcing — three layers, in order of trust:
 *   1. Live Monday fetch (canonical: Monday's `date3` column).
 *   2. Monday boards cache (fast path, but may predate the `nextInvoiceDate`
 *      field on MondayClient — empty rows fall through).
 *   3. Supabase `clients.next_invoice_date` mirror (only populated when a
 *      client page is visited or a date is set via the Hub UI; misses any
 *      client whose detail page hasn't been opened since the tracker shipped).
 *
 * We try the cache first for speed, and ALSO read the Supabase mirror as a
 * belt-and-suspenders fallback. If the cache returns no dates at all (stale
 * cache from before the field landed), we transparently re-fetch live from
 * Monday so the page is correct even on first load post-deploy.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function BillingPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")

  // Layer 1: cache.
  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
  )
  let boards = cached ?? (await fetchBothBoards().catch(() => ({ onboarding: [], current: [] })))
  let allClients = [...boards.onboarding, ...boards.current]

  // If the cache exists but no client carries either billing date, the cache
  // predates the field shapes — fall through to a live Monday fetch so the
  // page isn't stuck waiting on the next cron tick.
  const cacheCarriesDates = allClients.some(
    (c) => DATE_RE.test(c.nextInvoiceDate) || DATE_RE.test(c.cycleStartDate),
  )
  if (cached && !cacheCarriesDates) {
    boards = await fetchBothBoards().catch(() => boards)
    allClients = [...boards.onboarding, ...boards.current]
  }

  // Supabase fallback — fills in dates for rows where the live/cache source
  // didn't carry the date (e.g. Monday API hiccup, cache pre-dates the new
  // `cycleStartDate` field). Cheap query, indexed on both columns.
  const supabase = await createAdminClient()
  const { data: supaRows } = await supabase
    .from("clients")
    .select("monday_item_id, next_invoice_date, cycle_start_date")
    .or("next_invoice_date.not.is.null,cycle_start_date.not.is.null")
  const supaDates = new Map<string, { invoice: string; cycle: string }>()
  for (const r of supaRows ?? []) {
    const inv = (r.next_invoice_date as string | null) ?? ""
    const cyc = (r.cycle_start_date as string | null) ?? ""
    supaDates.set(r.monday_item_id as string, {
      invoice: DATE_RE.test(inv) ? inv : "",
      cycle: DATE_RE.test(cyc) ? cyc : "",
    })
  }

  type ScheduledClient = MondayClient & {
    _invoice: string
    _cycle: string
    _status: ReturnType<typeof mondayStatusToHub>
  }
  const scheduled: ScheduledClient[] = allClients
    .map((c) => {
      const fallback = supaDates.get(c.mondayItemId)
      const invoice =
        (DATE_RE.test(c.nextInvoiceDate) ? c.nextInvoiceDate : "") ||
        (fallback?.invoice ?? "")
      const cycle =
        (DATE_RE.test(c.cycleStartDate) ? c.cycleStartDate : "") ||
        (fallback?.cycle ?? "")
      const status = mondayStatusToHub(c.campaignStatus, c.boardType)
      return { ...c, _invoice: invoice, _cycle: cycle, _status: status }
    })
    // Filter conditions:
    // - must have an invoice date (else there's nothing for finance to send)
    // - On Hold + Churned drop off — those clients aren't billed this period.
    //   Live + Onboarding remain (Onboarding clients still get their first
    //   invoice on the date set in Monday).
    .filter((c) => DATE_RE.test(c._invoice))
    .filter((c) => c._status === "live" || c._status === "onboarding")
    .sort((a, b) => a._invoice.localeCompare(b._invoice))

  // Look up MRR / ad budget for the scheduled set in one round-trip. We need
  // the Supabase clients.id to join client_agreements, so this is two queries:
  // monday_item_id → clients.id, then clients.id → campaigns.
  const mondayIds = scheduled.map((c) => c.mondayItemId)
  const moneyByMondayId = new Map<string, { mrr: number; adBudget: number }>()

  if (mondayIds.length > 0) {
    const { data: clientRows } = await supabase
      .from("clients")
      .select("id, monday_item_id")
      .in("monday_item_id", mondayIds)
    const mondayIdById = new Map<string, string>()
    for (const row of clientRows ?? []) {
      mondayIdById.set(row.id as string, row.monday_item_id as string)
    }
    if (mondayIdById.size > 0) {
      const { data: agreements } = await supabase
        .from("client_agreements")
        .select("client_id, campaigns")
        .in("client_id", Array.from(mondayIdById.keys()))
      for (const a of agreements ?? []) {
        const mondayItemId = mondayIdById.get(a.client_id as string)
        if (!mondayItemId) continue
        const campaigns = normalizeCampaigns(a.campaigns)
        moneyByMondayId.set(mondayItemId, {
          mrr: totalMRR(campaigns),
          adBudget: totalAdBudget(campaigns),
        })
      }
    }
  }

  // Stripe is the source of truth for payment state — Monday's "Administration"
  // column drifts out of sync, so we read the dedicated `billing_summaries`
  // cache (refreshed by the same cron that syncs next_invoice_date back here).
  const billingCache = (await readCache<Record<string, BillingSummary>>("billing_summaries")) ?? {}

  const rows: UpcomingInvoice[] = scheduled.map((c) => {
    const money = moneyByMondayId.get(c.mondayItemId)
    const summary = c.stripeCustomerId ? billingCache[c.stripeCustomerId] : undefined
    return {
      mondayItemId: c.mondayItemId,
      name: c.name,
      nextInvoiceDate: c._invoice,
      cycleStartDate: c._cycle,
      stripeCustomerId: c.stripeCustomerId || null,
      fee: money?.mrr ?? 0,
      adBudget: money?.adBudget ?? 0,
      usesRocketLeadsAdAccount: isRocketLeadsAdAccount(c.metaAdAccountId),
      campaignStatus: c._status,
      paymentStatus: summary?.status ?? null,
      outstanding: summary?.outstanding ?? 0,
    }
  })

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-heading font-semibold tracking-tight leading-tight">
            Billing
          </h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            Upcoming invoices grouped by when they need to go out. The invoice
            date is always 7 days before the new cycle starts — edit a
            client&apos;s cycle to move both dates in lockstep.
          </p>
        </div>
        <SyncFromMondayButton />
      </div>
      <BillingOverview rows={rows} />
    </div>
  )
}
