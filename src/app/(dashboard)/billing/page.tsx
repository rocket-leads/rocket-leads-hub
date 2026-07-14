import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { PageHeader } from "@/components/ui/page-header"
import { fetchBothBoards, getBoardConfig, mondayItemUrl, type MondayClient } from "@/lib/integrations/monday"
import type { BillingSummary, PastInvoice } from "@/lib/integrations/stripe"
import type { InvoiceReadiness } from "@/app/api/billing/invoice-readiness/[id]/route"
import { readReadinessMap } from "@/lib/billing/invoice-readiness"
import { agreementMonthly, normalizeAgreement } from "@/lib/clients/agreement"
import { mondayStatusToHub } from "@/lib/clients/status"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import type { BillingGroup, UpcomingInvoice } from "./_components/billing-overview"
import { BillingTabs, type PastInvoiceRow } from "./_components/billing-tabs"
import { RefreshBillingButton } from "./_components/refresh-billing-button"
import { GlobalCreateInvoice } from "./_components/global-create-invoice"
import { combinedClientName } from "@/lib/billing/sibling-name"

/**
 * Finance overview page - open to anyone signed in. Surfaces every client
 * with a `next_invoice_date` set, so finance has one place to see what's
 * coming without clicking into 50 separate Billing tabs.
 *
 * Date sourcing - three layers, in order of trust:
 *   1. Live Monday fetch (canonical: Monday's `date3` column).
 *   2. Monday boards cache (fast path, but may predate the `nextInvoiceDate`
 *      field on MondayClient - empty rows fall through).
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

  // Block pure campaign managers - billing is for AM / Finance / Admin only.
  // Roy 2026-06-11.
  if (session.user.role !== "admin" && !session.user.isFinance) {
    const supabaseAuth = await createAdminClient()
    const { data: roleRows } = await supabaseAuth
      .from("user_column_mappings")
      .select("monday_column_role")
      .eq("user_id", session.user.id)
    const roles = new Set<string>((roleRows ?? []).map((r) => r.monday_column_role as string))
    const isPureCm = roles.has("campaign_manager") && !roles.has("account_manager")
    if (isPureCm) redirect("/watchlist")
  }

  // Layer 1: cache.
  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
  )
  let boards = cached ?? (await fetchBothBoards().catch(() => ({ onboarding: [], current: [] })))
  let allClients = [...boards.onboarding, ...boards.current]

  // If the cache exists but no client carries either billing date, the cache
  // predates the field shapes - fall through to a live Monday fetch so the
  // page isn't stuck waiting on the next cron tick.
  const cacheCarriesDates = allClients.some(
    (c) => DATE_RE.test(c.nextInvoiceDate) || DATE_RE.test(c.cycleStartDate),
  )
  if (cached && !cacheCarriesDates) {
    boards = await fetchBothBoards().catch(() => boards)
    allClients = [...boards.onboarding, ...boards.current]
  }

  // Supabase fallback - fills in dates for rows where the live/cache source
  // didn't carry the date (e.g. Monday API hiccup, cache pre-dates the new
  // `cycleStartDate` field). Cheap query, indexed on both columns.
  // Also pulls the manual billing-hold flag in the same round-trip.
  const supabase = await createAdminClient()
  const { data: supaRows } = await supabase
    .from("clients")
    .select(
      "monday_item_id, next_invoice_date, cycle_start_date, billing_hold, billing_hold_reason",
    )
  const supaDates = new Map<string, { invoice: string; cycle: string }>()
  const billingHoldByMondayId = new Map<string, { hold: boolean; reason: string | null }>()
  for (const r of supaRows ?? []) {
    const inv = (r.next_invoice_date as string | null) ?? ""
    const cyc = (r.cycle_start_date as string | null) ?? ""
    supaDates.set(r.monday_item_id as string, {
      invoice: DATE_RE.test(inv) ? inv : "",
      cycle: DATE_RE.test(cyc) ? cyc : "",
    })
    if (r.billing_hold) {
      billingHoldByMondayId.set(r.monday_item_id as string, {
        hold: true,
        reason: (r.billing_hold_reason as string | null) ?? null,
      })
    }
  }

  type ScheduledClient = MondayClient & {
    _invoice: string
    _cycle: string
    _status: ReturnType<typeof mondayStatusToHub>
  }
  // Don't annotate the variable - let inference keep the narrower `_status`
  // type produced by the type-guard filter below, otherwise the narrowing is
  // widened back to `ClientStatus | null` and the .map can't satisfy
  // `UpcomingInvoice.campaignStatus: ClientStatus`.
  const scheduled = allClients
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
    // - On Hold + Churned drop off - those clients aren't billed this period.
    //   Live + Onboarding remain (Onboarding clients still get their first
    //   invoice on the date set in Monday).
    .filter((c): c is typeof c & { _status: "live" | "onboarding" } =>
      DATE_RE.test(c._invoice) && (c._status === "live" || c._status === "onboarding"),
    )
    .sort((a, b) => a._invoice.localeCompare(b._invoice))

  // Look up MRR / ad budget for the scheduled set in one round-trip. We need
  // the Supabase clients.id to join client_agreements, so this is two queries:
  // monday_item_id → clients.id, then clients.id → flat agreement columns.
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
        .select(
          "client_id, ad_budget, platforms, platform_fees, follow_up, follow_up_fee",
        )
        .in("client_id", Array.from(mondayIdById.keys()))
      for (const a of agreements ?? []) {
        const mondayItemId = mondayIdById.get(a.client_id as string)
        if (!mondayItemId) continue
        const agreement = normalizeAgreement(a)
        moneyByMondayId.set(mondayItemId, {
          mrr: agreementMonthly(agreement),
          adBudget: agreement.ad_budget,
        })
      }
    }
  }

  // Stripe is the source of truth for payment state - Monday's "Administration"
  // column drifts out of sync, so we read the dedicated `billing_summaries`
  // cache (refreshed by the same cron that syncs next_invoice_date back here).
  const billingCache = (await readCache<Record<string, BillingSummary>>("billing_summaries")) ?? {}

  // Last-refreshed timestamp from the manual Refresh button + the hourly
  // Stripe-summaries cron. Drives the "Last updated X ago" hint so finance
  // can see freshness at a glance.
  const lastRefreshedAt = (await readCache<string>("billing_refreshed_at")) ?? null

  // Past invoices - global Stripe list refreshed hourly + on manual refresh.
  // Join customerId → client name from the Monday cache so the table reads
  // human (not "cus_…"). Multiple Monday rows can share one Stripe customer
  // (multi-campaign clients like O2 Plus | B2B + B2C); we collect ALL siblings
  // and derive a clean shared name via the same prefix logic the Future tab
  // uses, so a past invoice for that customer reads as "O2 Plus" rather than
  // whichever sibling happened to be iterated last.
  const pastInvoicesRaw = (await readCache<PastInvoice[]>("past_invoices")) ?? []
  const clientsByStripeId = new Map<string, { mondayItemId: string; name: string }[]>()
  for (const c of allClients) {
    if (c.stripeCustomerId) {
      const list = clientsByStripeId.get(c.stripeCustomerId) ?? []
      list.push({ mondayItemId: c.mondayItemId, name: c.name })
      clientsByStripeId.set(c.stripeCustomerId, list)
    }
  }
  const pastInvoices: PastInvoiceRow[] = pastInvoicesRaw.map((inv) => {
    const linked = clientsByStripeId.get(inv.customerId)
    if (!linked || linked.length === 0) {
      return { ...inv, clientName: null, clientMondayItemId: null }
    }
    const clientName =
      linked.length === 1
        ? linked[0].name
        : combinedClientName(linked.map((l) => l.name))
    // Link to the first sibling - they can navigate from there if they want
    // a different campaign within the same Stripe customer.
    return {
      ...inv,
      clientName,
      clientMondayItemId: linked[0].mondayItemId,
    }
  })

  // AI invoice-readiness verdicts - pre-computed by /api/billing/invoice-readiness.
  // Cache miss = the row renders a "Run AI check" affordance and the inline
  // cell fetches on demand, populating the cache for subsequent loads.
  // Uses `readReadinessMap` (not raw readCache) so legacy "AI failed" entries
  // - which were stored as verdict="check"+confidence=30 before the error
  // verdict existed - get upgraded to verdict="error" at read time.
  const readinessCache = await readReadinessMap()

  // Board config feeds Monday item URL construction. Null means we couldn't
  // load it (Supabase miss / missing key); the URLs will be null and the
  // "Open in Monday" link is hidden rather than rendered broken.
  const boardConfig = await getBoardConfig()

  const rows: UpcomingInvoice[] = scheduled.map((c) => {
    const money = moneyByMondayId.get(c.mondayItemId)
    const summary = c.stripeCustomerId ? billingCache[c.stripeCustomerId] : undefined
    const heldEntry = billingHoldByMondayId.get(c.mondayItemId)
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
      accountManager: c.accountManager,
      paymentStatus: summary?.status ?? null,
      outstanding: summary?.outstanding ?? 0,
      readiness: readinessCache[c.mondayItemId] ?? null,
      mondayItemUrl: mondayItemUrl(c.mondayItemId, c.boardType, boardConfig),
      billingHold: !!heldEntry,
      billingHoldReason: heldEntry?.reason ?? null,
      administration: c.administration,
    }
  })

  // Group Monday rows that share a Stripe customer into a single billable
  // entity. Multi-row groups (e.g. "O2 Plus | B2B" + "O2 Plus | B2C") get one
  // consolidated invoice; rows without a Stripe customer become singleton
  // groups using a synthetic key so the rest of the pipeline can treat them
  // uniformly.
  const groups: BillingGroup[] = groupBillingRows(rows)

  // Distinct admin labels currently in use anywhere on the boards - feeds the
  // editable Admin cell's popover so finance can pick any value Monday
  // already accepts. Discovered from real data (not a hardcoded list) so a
  // new Monday option becomes available the moment a single client uses it,
  // without a Hub deploy. Sorted alphabetically for a stable menu order.
  const adminOptions = Array.from(
    new Set(allClients.map((c) => c.administration).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b))

  return (
    <div>
      <PageHeader
        title="Billing"
        actions={
          <div className="flex items-center gap-2">
            <GlobalCreateInvoice />
            <RefreshBillingButton lastRefreshedAt={lastRefreshedAt} />
          </div>
        }
      />
      <BillingTabs futureGroups={groups} pastInvoices={pastInvoices} adminOptions={adminOptions} />
    </div>
  )
}

/**
 * Build BillingGroups from the flat scheduled-row list.
 *
 * Bundling rule: rows bundle into one group only when they share BOTH a
 * Stripe customer AND the same `nextInvoiceDate`. Same customer + different
 * dates = separate groups (e.g. HeroLeads has 3 campaigns on the same Stripe
 * customer but each with its own start date - finance bills them as 3
 * separate invoices). The invoice date is therefore the de-facto bundling
 * signal: align dates to bundle, diverge dates to split.
 *
 * Rows without a Stripe customer each become their own group (synthetic
 * `unlinked-{mondayItemId}` key) so the table still renders them.
 */
function groupBillingRows(rows: UpcomingInvoice[]): BillingGroup[] {
  const byCustomer = new Map<string, UpcomingInvoice[]>()
  for (const row of rows) {
    const key = row.stripeCustomerId
      ? `stripe:${row.stripeCustomerId}:${row.nextInvoiceDate}`
      : `unlinked:${row.mondayItemId}`
    const list = byCustomer.get(key) ?? []
    list.push(row)
    byCustomer.set(key, list)
  }

  const groups: BillingGroup[] = []
  for (const [groupKey, siblings] of byCustomer) {
    siblings.sort((a, b) => a.nextInvoiceDate.localeCompare(b.nextInvoiceDate))
    const primary = siblings[0]
    const totalFee = siblings.reduce((s, r) => s + r.fee, 0)
    // Only count ad budget when the campaign actually runs through our ad
    // account - otherwise the client pays Meta directly and we don't bill it.
    const totalAdBudget = siblings.reduce(
      (s, r) => s + (r.usesRocketLeadsAdAccount ? r.adBudget : 0),
      0,
    )
    const readiness = aggregateGroupReadiness(siblings)
    groups.push({
      groupKey,
      primary,
      siblings,
      totalFee,
      totalAdBudget,
      readiness,
    })
  }

  // Sort groups by their primary's invoice date so the surrounding bucketing
  // logic doesn't depend on insertion order.
  groups.sort((a, b) => a.primary.nextInvoiceDate.localeCompare(b.primary.nextInvoiceDate))
  return groups
}

/**
 * Combine sibling AI invoice-readiness verdicts into a single group-level
 * verdict. The at-a-glance pill on the parent row should reflect the WORST
 * sibling - if "O2 Plus | B2C" is on hold (e.g. quality issues in updates),
 * the group reads as "Hold" even when "O2 Plus | B2B" looks fine on its own.
 *
 * - No siblings have readiness yet → null (cell renders "Run AI check").
 * - Single sibling with readiness → pass it through unchanged.
 * - Multi-sibling: pick the worst verdict (hold > check > send) as the group
 *   verdict. Reasons are concatenated, prefixed with the sibling's
 *   distinguishing suffix (e.g. "B2B: ..." / "B2C: ...") so the popover shows
 *   why each campaign got the verdict it did. Updates from all siblings get
 *   merged for the popover's update list - finance sees the full picture.
 */
function aggregateGroupReadiness(siblings: UpcomingInvoice[]): InvoiceReadiness | null {
  const withReadiness = siblings.filter(
    (s): s is UpcomingInvoice & { readiness: InvoiceReadiness } => !!s.readiness,
  )
  if (withReadiness.length === 0) return null
  if (withReadiness.length === 1) return withReadiness[0].readiness

  // Worst-first sort. "error" ranks below "send" so any real verdict from a
  // sibling trumps an errored one - error only surfaces if all siblings failed.
  const order = { error: -1, send: 0, check: 1, hold: 2 } as const
  withReadiness.sort((a, b) => order[b.readiness.verdict] - order[a.readiness.verdict])
  const worst = withReadiness[0].readiness

  // Per-sibling reason, prefixed with the campaign's distinguishing suffix
  // (the unique tail after the common parent name) so the popover reads as a
  // breakdown rather than a wall of duplicated text.
  const allNames = withReadiness.map((s) => s.name)
  const sharedPrefix = combinedClientName(allNames)
  const reason = withReadiness
    .map((s) => {
      const suffix =
        sharedPrefix.length >= 3 && s.name.startsWith(sharedPrefix)
          ? s.name.slice(sharedPrefix.length).replace(/^[\s|\-:·]+/, "").trim() || s.name
          : s.name
      return `${suffix}: ${s.readiness.reason}`
    })
    .join("\n\n")

  // Merge updates across siblings so finance can see everything that fed the
  // verdicts in one place. Don't dedupe - same sibling shouldn't have dupes
  // and cross-sibling overlap is rare (different Monday boards).
  const updates = withReadiness.flatMap((s) => s.readiness.updates)

  // Most-recent computedAt + lastUpdateAt across siblings - the popover shows
  // the freshest signal we have.
  const computedAt = withReadiness
    .map((s) => s.readiness.computedAt)
    .sort()
    .reverse()[0]
  const lastUpdateAt =
    withReadiness
      .map((s) => s.readiness.lastUpdateAt)
      .filter((d): d is string => !!d)
      .sort()
      .reverse()[0] ?? null

  return {
    verdict: worst.verdict,
    confidence: worst.confidence,
    reason,
    updates,
    lastUpdateAt,
    computedAt,
  }
}
