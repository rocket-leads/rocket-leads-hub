"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { ChevronRight, ExternalLink, FilePlus, Link2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Panel } from "@/components/ui/panel"
import { StatusEditCell } from "@/app/(dashboard)/clients/_components/status-edit-cell"
import { PersonEditCell } from "@/app/(dashboard)/clients/_components/person-edit-cell"
import type { ClientStatus } from "@/lib/clients/status"
import type { InvoiceReadiness } from "@/app/api/billing/invoice-readiness/[id]/route"
import { NextInvoiceDateCell } from "./next-invoice-date-cell"
import { CreateInvoiceDialog } from "./create-invoice-dialog"
import { InvoiceReadinessCell } from "./invoice-readiness-cell"
import { AgreementAmountCell } from "./agreement-amount-cell"
import { BillingHoldToggle } from "./billing-hold-toggle"
import { AdminEditCell } from "./admin-edit-cell"
import { combinedClientName } from "@/lib/billing/sibling-name"

/**
 * A billable group - one or more Monday rows that share a Stripe customer.
 * Each Monday row IS one campaign; when several share a customer (e.g.
 * "O2 Plus | B2B" + "O2 Plus | B2C"), they're billed on a single invoice.
 *
 * - Single-sibling groups behave like the old per-row entries.
 * - Multi-sibling groups expand to show the per-campaign breakdown.
 *
 * `primary` is the sibling with the earliest `nextInvoiceDate` - used for
 * bucketing into Overdue / Today / This week. Siblings may legitimately
 * disagree on dates when each campaign is its own business with its own
 * start date, so divergent dates are not flagged as an error.
 *
 * `readiness` is the AI invoice-readiness verdict to display on the parent
 * row. For single-sibling groups it's the primary's own. For multi-sibling
 * groups it's the worst verdict across siblings (hold > check > send) with
 * each sibling's reason concatenated, so the at-a-glance pill reflects the
 * full group's invoiceability - not just the primary campaign.
 */
export type BillingGroup = {
  /** stripeCustomerId, or `unlinked-{mondayItemId}` for ungrouped rows. */
  groupKey: string
  primary: UpcomingInvoice
  /** All sibling rows including `primary`. Length ≥ 1. */
  siblings: UpcomingInvoice[]
  totalFee: number
  totalAdBudget: number
  readiness: InvoiceReadiness | null
}

export type UpcomingInvoice = {
  mondayItemId: string
  name: string
  /** When finance sends the invoice. Always derived as `cycleStartDate - 7d`,
   *  read-only in the UI - edit the cycle to move the invoice. */
  nextInvoiceDate: string
  /** When the new billing cycle starts for the client. Manual source of truth;
   *  changing this here writes both Monday columns in lockstep. */
  cycleStartDate: string
  stripeCustomerId: string | null
  /** Service fee (sum of platform fees + follow-up fee from the agreement).
   *  Was previously called "MRR" - renamed to "Fee" because finance reads it
   *  as "what we charge for managing the campaign", not "monthly recurring
   *  revenue projection". The number is the same. */
  fee: number
  /** Total ad budget across the agreement's campaigns. Only meaningful when
   *  the client runs ads via Rocket Leads' own ad account - otherwise the
   *  client is paying Meta directly and we don't invoice it. */
  adBudget: number
  /** True when the client's Meta ad account ID matches Rocket Leads'. When
   *  false, the ad-budget cell renders as "-" and the create-invoice dialog
   *  omits the ad-budget line - surfacing it would just confuse finance. */
  usesRocketLeadsAdAccount: boolean
  /** Hub-canonical campaign status (live / onboarding / on_hold / churned).
   *  On Hold + Churned are filtered out server-side because they don't get
   *  invoiced; the column shows live vs onboarding so finance can spot which
   *  ones are still in setup. */
  campaignStatus: ClientStatus
  /** Account manager name from Monday - drives the editable AM cell on the
   *  Billing page so finance can see who owns the client at a glance. Same
   *  source as the AM column on the Clients overview. */
  accountManager: string
  /** Stripe is the source of truth for payment state. Monday's "Administration"
   *  column is ignored here on purpose - it gets out of sync. Null when the
   *  client has no Stripe customer linked OR the billing summary cache hasn't
   *  resolved them yet. */
  paymentStatus: "complete" | "open" | "overdue" | null
  /** Total € outstanding across all open Stripe invoices for this customer.
   *  Useful context when finance is scheduling the *next* invoice - chase
   *  unpaid first if there's already a balance. */
  outstanding: number
  /** AI verdict on whether finance should send the invoice today. Pre-loaded
   *  from the `invoice_readiness` cache; null when not yet computed for this
   *  client (the cell falls back to a "Run AI check" affordance). */
  readiness: InvoiceReadiness | null
  /** Deep link to this client's Monday item, built server-side from the row's
   *  parent board id. Null when the board config isn't loaded - UI hides the
   *  "Open in Monday" link in that case rather than render a broken URL. */
  mondayItemUrl: string | null
  /** Manual billing-hold flag from `clients.billing_hold`. Held rows render
   *  in a dedicated "On Hold" bucket above the time-based ones and stay
   *  parked there across refreshes until finance toggles them off. */
  billingHold: boolean
  /** Optional note finance attached when holding (e.g. "wachten op refund").
   *  Shown next to the hold pill so context isn't lost on handoff. */
  billingHoldReason: string | null
  /** Raw value from Monday's "Administration" status column (`status_16`).
   *  Translated for display by `viewAdministration` - original Dutch label
   *  is preserved on the tooltip for finance traceability. */
  administration: string
}

type Bucket = {
  key: "needs_attention" | "hold" | "overdue" | "today" | "this_week" | "next_week"
  label: string
  hint: string
  tone: string
  groups: BillingGroup[]
}

function fmtEuro(amount: number): string {
  return `€${amount.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

/**
 * Bucket each group into a time-window so finance sees what needs action
 * today vs what's just on the radar. Pure date math against the user's local
 * "today" - server tz drift won't bump groups into the wrong bucket because
 * we compute everything from `new Date()` on the client. The `primary` row
 * carries the bucketing date (siblings agree post-sync).
 */
function bucketGroups(groups: BillingGroup[]): Bucket[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayMs = today.getTime()
  const dayMs = 24 * 60 * 60 * 1000

  // "This week" = up to (and including) the coming Sunday - what most people
  // mean when they say "deze week". "Next week" = the seven days after that.
  const dayOfWeek = today.getDay() // 0 = Sun
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek
  const endOfThisWeek = todayMs + daysUntilSunday * dayMs
  const endOfNextWeek = endOfThisWeek + 7 * dayMs

  const buckets: Record<Bucket["key"], BillingGroup[]> = {
    needs_attention: [],
    hold: [],
    overdue: [],
    today: [],
    this_week: [],
    next_week: [],
  }

  // Held groups go to the Hold bucket regardless of their invoice date - the
  // whole point of holding is to override the time-based buckets. A group
  // counts as held when ANY sibling has billing_hold=true; finance pinning
  // the parent should also park its sub-campaigns.
  //
  // Otherwise: clients more than 2 weeks out are intentionally dropped from
  // the overview. After a successful invoice send, `create-invoice` advances
  // cycle_start by a month → next_invoice_date jumps +1 month → the client
  // is now ~3 weeks out and falls off the page. That's the desired UX: "out
  // of overview as soon as the invoice is sent". Re-appears in `next_week`
  // when its next cycle approaches.
  for (const group of groups) {
    const isHeld = group.siblings.some((s) => s.billingHold)
    if (isHeld) {
      buckets.hold.push(group)
      continue
    }

    // "Needs attention" - Live client without a `cycleStartDate` filled in.
    // The cycle drives `nextInvoiceDate` (cycle - 7d); without it there's
    // nothing to bucket against and nothing to auto-advance after a send,
    // so finance has to manually set one before any of the other flows
    // work. Different problem from Overdue (which is "cycle is set, date
    // has passed"), so they belong in separate buckets. Roy 2026-06-03.
    const isLive = group.primary.campaignStatus === "live"
    const cycleStart = group.primary.cycleStartDate
    const cycleMissing = !cycleStart || Number.isNaN(new Date(cycleStart).getTime())
    if (isLive && cycleMissing) {
      buckets.needs_attention.push(group)
      continue
    }

    const invoiceDate = new Date(group.primary.nextInvoiceDate)
    if (Number.isNaN(invoiceDate.getTime())) continue // no usable date and not flagged above → nothing to bucket
    invoiceDate.setHours(0, 0, 0, 0)
    const ms = invoiceDate.getTime()
    if (ms < todayMs) buckets.overdue.push(group)
    else if (ms === todayMs) buckets.today.push(group)
    else if (ms <= endOfThisWeek) buckets.this_week.push(group)
    else if (ms <= endOfNextWeek) buckets.next_week.push(group)
    // else: > 2 weeks out → not actionable yet, hidden.
  }

  const all: Bucket[] = [
    // Needs attention sits at the top - Live clients without a cycle start
    // date set. Nothing else can run (invoice date can't derive, auto-
    // advance after send has no anchor) until finance fills it in.
    { key: "needs_attention", label: "Needs attention", hint: "Live client · no cycle start date set", tone: "text-red-500", groups: buckets.needs_attention },
    { key: "hold", label: "On hold", hint: "Manually parked by finance", tone: "text-violet-500", groups: buckets.hold },
    { key: "overdue", label: "Overdue", hint: "Past their next-invoice date", tone: "text-red-500", groups: buckets.overdue },
    { key: "today", label: "Today", hint: "Send today", tone: "text-amber-500", groups: buckets.today },
    { key: "this_week", label: "This week", hint: "Through Sunday", tone: "text-foreground", groups: buckets.this_week },
    { key: "next_week", label: "Next week", hint: "On the radar", tone: "text-muted-foreground", groups: buckets.next_week },
  ]
  return all.filter((b) => b.groups.length > 0)
}

export function BillingOverview({
  groups,
  adminOptions,
}: {
  groups: BillingGroup[]
  /** Distinct labels finance can pick from in the inline Admin cell. */
  adminOptions: string[]
}) {
  const buckets = bucketGroups(groups)

  if (buckets.length === 0) {
    return (
      <Panel className="p-8">
        <div className="text-center text-sm text-muted-foreground">
          <p>No upcoming invoices scheduled.</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Set a next-invoice date on a client&apos;s Billing tab to see it here.
          </p>
        </div>
      </Panel>
    )
  }

  // Headline numbers across the whole page so finance has a one-glance summary.
  // All aggregations operate on GROUPS (= invoices), not Monday rows, so a
  // multi-campaign client counts once for "scheduled clients" + summed fee.
  const totalFee = groups.reduce((s, g) => s + g.totalFee, 0)
  const dueThisWeek = buckets
    .filter((b) => b.key === "overdue" || b.key === "today" || b.key === "this_week")
    .reduce((s, b) => s + b.groups.length, 0)
  // Stripe-derived: total € unpaid across all scheduled clients, and how many
  // of them have an overdue balance. Outstanding is stored on the primary
  // (it's a customer-level number from Stripe, identical across siblings).
  const totalOutstanding = groups.reduce((s, g) => s + g.primary.outstanding, 0)
  const overdueCount = groups.filter((g) => g.primary.paymentStatus === "overdue").length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryStat label="Scheduled clients" value={String(groups.length)} />
        <SummaryStat label="Due this week" value={String(dueThisWeek)} tone={dueThisWeek > 0 ? "amber" : undefined} />
        <SummaryStat label="Total fee" value={fmtEuro(totalFee)} hint="Sum of service fees across scheduled clients" />
        <SummaryStat
          label="Outstanding (Stripe)"
          value={fmtEuro(totalOutstanding)}
          hint={overdueCount > 0 ? `${overdueCount} overdue` : "Across all scheduled clients"}
          tone={overdueCount > 0 ? "red" : totalOutstanding > 0 ? "amber" : undefined}
        />
      </div>

      {buckets.map((bucket) => (
        <Panel key={bucket.key} className="overflow-hidden">
          <div className="px-5 pt-4 pb-3 flex items-baseline justify-between border-b border-border/40">
            <div>
              <h2 className={`section-title ${bucket.tone}`}>{bucket.label}</h2>
              <p className="text-[11px] text-muted-foreground/60 mt-1">{bucket.hint}</p>
            </div>
            <span className="font-mono text-[11px] text-muted-foreground/60 tabular-nums">
              {bucket.groups.length} {bucket.groups.length === 1 ? "client" : "clients"}
            </span>
          </div>
          <div className="px-3 pb-1.5">
          {/* table-fixed so the column widths below are authoritative and every
              bucket lines its columns up identically (auto-layout let each
              table size independently → drift between groups). */}
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="border-b border-border/40 bg-muted/30 hover:bg-muted/30 [&>th]:h-9">
                <TableHead>Client</TableHead>
                <TableHead className="w-[150px]">Action</TableHead>
                <TableHead className="w-[140px]">Status</TableHead>
                <TableHead className="w-[160px]">Admin</TableHead>
                <TableHead className="w-[140px]">AM</TableHead>
                <TableHead className="w-[160px]">Payment date</TableHead>
                <TableHead className="w-[140px]">Invoice out</TableHead>
                <TableHead className="w-[100px]">Fee</TableHead>
                <TableHead className="w-[110px]">Ad budget</TableHead>
                <TableHead className="w-[160px]">Payment (Stripe)</TableHead>
                <TableHead className="w-[180px]">AI check</TableHead>
                <TableHead className="w-[100px]">Stripe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bucket.groups.map((group) => (
                <BillingGroupRow key={group.groupKey} group={group} adminOptions={adminOptions} />
              ))}
            </TableBody>
          </Table>
          </div>
        </Panel>
      ))}
    </div>
  )
}

/**
 * Per-group state holder. Lifted into its own component so the create-invoice
 * dialog state and the sibling expand state are group-scoped - opening one
 * group's dialog or expanding its siblings doesn't bleed into the others.
 *
 * Single-sibling groups render flat (no chevron). Multi-sibling groups show a
 * combined "client" label (shared prefix or "X campaigns") + chevron to
 * reveal a child sub-table with each campaign's own row data.
 */
function BillingGroupRow({ group, adminOptions }: { group: BillingGroup; adminOptions: string[] }) {
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const isMulti = group.siblings.length > 1
  const { primary } = group

  // Collapsed display: trim a shared prefix off the campaign names so the
  // combined label reads as the parent client instead of the longest name.
  // Falls back to the primary's name if no useful prefix is found.
  const displayName = isMulti
    ? combinedClientName(group.siblings.map((s) => s.name))
    : primary.name

  return (
    <>
      <TableRow className="border-b border-border/40 row-hover">
        <TableCell className="py-2.5">
          <div className="flex items-center gap-1.5">
            {isMulti && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-muted-foreground/60 hover:text-foreground transition-colors"
                aria-label={expanded ? "Collapse campaigns" : "Expand campaigns"}
                title={expanded ? "Hide campaigns" : "Show campaigns"}
              >
                <ChevronRight
                  className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
                />
              </button>
            )}
            <div className="flex flex-col min-w-0">
              {isMulti ? (
                <span className="text-sm font-medium">{displayName}</span>
              ) : (
                <Link
                  href={`/clients/${primary.mondayItemId}`}
                  className="text-sm font-medium hover:text-primary transition-colors"
                >
                  {primary.name}
                </Link>
              )}
              {isMulti && (
                <span className="text-[11px] text-muted-foreground/70 inline-flex items-center">
                  {group.siblings.length} campaigns
                </span>
              )}
            </div>
          </div>
        </TableCell>
        <TableCell className="py-2.5">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={!primary.stripeCustomerId}
              onClick={() => setInvoiceOpen(true)}
              title={
                primary.stripeCustomerId
                  ? isMulti
                    ? `Create one Stripe invoice covering all ${group.siblings.length} campaigns`
                    : "Create + send a Stripe invoice"
                  : "No Stripe customer linked"
              }
            >
              <FilePlus className="h-3.5 w-3.5" />
              Create invoice
            </Button>
            <BillingHoldToggle
              mondayItemId={primary.mondayItemId}
              held={primary.billingHold}
              reason={primary.billingHoldReason}
            />
          </div>
        </TableCell>
        <TableCell className="py-2.5">
          <StatusEditCell
            mondayItemId={primary.mondayItemId}
            status={primary.campaignStatus}
          />
        </TableCell>
        <TableCell className="py-2.5">
          <AdminEditCell
            mondayItemId={primary.mondayItemId}
            value={primary.administration}
            options={adminOptions}
          />
        </TableCell>
        <TableCell className="py-2.5">
          <PersonEditCell
            mondayItemId={primary.mondayItemId}
            fieldKey="account_manager"
            value={primary.accountManager}
          />
        </TableCell>
        <TableCell className="py-2.5">
          {/* Payment date (cycle start) - the single editable source of truth.
              Everything else (invoice-out date, period) derives from this.
              Column stacks the optional "align siblings" action below the date
              so it never collides with the next cell. */}
          <div className="flex flex-col items-start gap-1">
            <NextInvoiceDateCell
              mondayItemId={primary.mondayItemId}
              value={primary.cycleStartDate}
              fieldKey="cycle_start_date"
              placeholder="Set payment date"
            />
            {isMulti && (
              <ApplyDateToSiblingsButton
                mondayItemId={primary.mondayItemId}
                disabled={!primary.cycleStartDate}
                count={group.siblings.length}
              />
            )}
          </div>
        </TableCell>
        <TableCell className="py-2.5 text-xs tabular-nums text-muted-foreground/70">
          {/* Invoice-out date is derived (payment date − 7d) - read-only. The
              invoice goes out 7 days ahead so payment lands before the period. */}
          {primary.nextInvoiceDate ? (
            fmtDate(primary.nextInvoiceDate)
          ) : (
            <span className="text-muted-foreground/40">-</span>
          )}
        </TableCell>
        <TableCell className="py-2.5 text-xs tabular-nums font-medium">
          {/* Multi-sibling groups show the read-only sum here - editing happens
              on the per-sibling sub-rows below so each campaign owns its own
              fee. Single-sibling groups expose the inline editor directly. */}
          {isMulti ? (
            group.totalFee > 0 ? (
              fmtEuro(group.totalFee)
            ) : (
              <span className="text-muted-foreground/40">-</span>
            )
          ) : (
            <AgreementAmountCell
              mondayItemId={primary.mondayItemId}
              field="fee"
              value={primary.fee}
              className="text-foreground font-medium"
            />
          )}
        </TableCell>
        <TableCell className="py-2.5 text-xs tabular-nums text-muted-foreground">
          {isMulti ? (
            group.totalAdBudget > 0 ? (
              fmtEuro(group.totalAdBudget)
            ) : (
              <span className="text-muted-foreground/40">-</span>
            )
          ) : (
            <AgreementAmountCell
              mondayItemId={primary.mondayItemId}
              field="ad_budget"
              value={primary.usesRocketLeadsAdAccount ? primary.adBudget : 0}
              // Always editable, even for clients running on their own ad account.
              // Roy 2026-06-03: typing an amount here implies "RL is now invoicing
              // for ad budget" which only makes sense if ads run through the RL ad
              // account. The PATCH handler auto-flips meta_ad_account_id to the RL
              // account when this field transitions from 0/empty → > 0 for a client
              // not already on RL - so a single edit moves them over without the
              // user having to also touch the ad-account field separately.
              placeholder={primary.usesRocketLeadsAdAccount ? "0" : "-"}
            />
          )}
        </TableCell>
        <TableCell className="py-2.5">
          <PaymentStatusCell
            status={primary.paymentStatus}
            outstanding={primary.outstanding}
            hasStripe={!!primary.stripeCustomerId}
          />
        </TableCell>
        <TableCell className="py-2.5">
          <InvoiceReadinessCell
            mondayItemId={primary.mondayItemId}
            clientName={displayName}
            initial={group.readiness}
            mondayItemUrl={primary.mondayItemUrl}
          />
        </TableCell>
        <TableCell className="py-2.5">
          {primary.stripeCustomerId ? (
            <a
              href={`https://dashboard.stripe.com/customers/${primary.stripeCustomerId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Image
                src="/logos/brands/stripe.svg"
                alt=""
                width={12}
                height={12}
                className="h-3 w-3 object-contain"
                unoptimized
              />
              Open
              <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
          ) : (
            <span className="text-[11px] text-muted-foreground/50">No Stripe</span>
          )}
        </TableCell>
      </TableRow>

      {/* Sibling breakdown - shown only when the user expands a multi-campaign
          group. Indented child rows so it's obvious they belong to the parent. */}
      {isMulti && expanded &&
        group.siblings.map((sib) => (
          <TableRow
            key={`sib-${sib.mondayItemId}`}
            className="border-b border-border/40 bg-muted/20"
          >
            <TableCell className="py-2 pl-10">
              <Link
                href={`/clients/${sib.mondayItemId}`}
                className="text-xs font-medium text-muted-foreground hover:text-primary transition-colors"
              >
                {sib.name}
              </Link>
            </TableCell>
            {/* Action + Status - both already on the parent row */}
            <TableCell colSpan={2} className="py-2" />
            <TableCell className="py-2">
              <AdminEditCell
                mondayItemId={sib.mondayItemId}
                value={sib.administration}
                options={adminOptions}
              />
            </TableCell>
            <TableCell className="py-2">
              <PersonEditCell
                mondayItemId={sib.mondayItemId}
                fieldKey="account_manager"
                value={sib.accountManager}
              />
            </TableCell>
            <TableCell className="py-2">
              {/* Each campaign owns its own payment date - editable inline so a
                  HeroLeads-style split (separate dates) can be maintained. */}
              <NextInvoiceDateCell
                mondayItemId={sib.mondayItemId}
                value={sib.cycleStartDate}
                fieldKey="cycle_start_date"
                placeholder="Set payment date"
              />
            </TableCell>
            <TableCell className="py-2 text-[11px] tabular-nums text-muted-foreground/70">
              {sib.nextInvoiceDate ? fmtDate(sib.nextInvoiceDate) : "-"}
            </TableCell>
            <TableCell className="py-2 text-[11px] tabular-nums">
              <AgreementAmountCell
                mondayItemId={sib.mondayItemId}
                field="fee"
                value={sib.fee}
              />
            </TableCell>
            <TableCell className="py-2 text-[11px] tabular-nums text-muted-foreground">
              <AgreementAmountCell
                mondayItemId={sib.mondayItemId}
                field="ad_budget"
                value={sib.usesRocketLeadsAdAccount ? sib.adBudget : 0}
                // Sibling-row cells follow the same edit-always rule as the
                // primary row above (see comment there).
                placeholder={sib.usesRocketLeadsAdAccount ? "0" : "-"}
              />
            </TableCell>
            {/* Payment + AI check + Stripe - all on the parent row */}
            <TableCell colSpan={3} className="py-2" />
          </TableRow>
        ))}

      {invoiceOpen && primary.stripeCustomerId && (
        <CreateInvoiceDialog
          mondayItemId={primary.mondayItemId}
          stripeCustomerId={primary.stripeCustomerId}
          clientName={displayName}
          fee={primary.fee}
          adBudget={primary.adBudget}
          usesRocketLeadsAdAccount={primary.usesRocketLeadsAdAccount}
          cycleStartDate={primary.cycleStartDate || null}
          siblingCampaigns={
            isMulti
              ? group.siblings.map((s) => ({
                  name: s.name,
                  fee: s.fee,
                  adBudget: s.adBudget,
                  usesRocketLeadsAdAccount: s.usesRocketLeadsAdAccount,
                }))
              : undefined
          }
          onClose={() => setInvoiceOpen(false)}
        />
      )}
    </>
  )
}


/**
 * Mirrors the PaymentInline pill from the client header so the same payment
 * state reads identically across the app. Driven by Stripe via the
 * `billing_summaries` cache - Monday's "Administration" column is intentionally
 * not consulted here because Stripe is the source of truth for payments.
 */
function PaymentStatusCell({
  status,
  outstanding,
  hasStripe,
}: {
  status: UpcomingInvoice["paymentStatus"]
  outstanding: number
  hasStripe: boolean
}) {
  if (!hasStripe || status === null) {
    return <span className="text-[11px] text-muted-foreground/40">-</span>
  }
  if (status === "complete") {
    return (
      <span className="st-label live">
        <span className="sd" />
        Paid up
      </span>
    )
  }
  // Open / overdue: 187N bare status label + a mono € suffix for the amount.
  const tone = status === "overdue" ? "error" : "warn"
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`st-label ${tone}`}>
        <span className="sd" />
        {status === "overdue" ? "Overdue" : "Open"}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{fmtEuro(outstanding)}</span>
    </span>
  )
}

/**
 * Opt-in "align all campaigns onto this payment date" action, shown on
 * multi-campaign groups. Replaces the old automatic sibling force-sync:
 * finance clicks it deliberately when a client's campaigns SHOULD share one
 * invoice cadence, instead of every date edit silently dragging siblings
 * along (which broke separately-invoiced clients like HeroLeads).
 */
function ApplyDateToSiblingsButton({
  mondayItemId,
  disabled,
  count,
}: {
  mondayItemId: string
  disabled: boolean
  count: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function apply() {
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${mondayItemId}/apply-cycle-siblings`, {
        method: "POST",
      })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={apply}
      disabled={disabled || busy}
      title={
        disabled
          ? "Set a payment date first"
          : `Apply this payment date to all ${count} campaigns of this client`
      }
      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-foreground transition-colors disabled:opacity-40 whitespace-nowrap"
    >
      {busy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Link2 className="h-2.5 w-2.5" />}
      Align dates
    </button>
  )
}

function SummaryStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: "amber" | "red"
}) {
  const valueTone =
    tone === "red" ? "text-[color:var(--st-error)]" : tone === "amber" ? "text-[color:var(--st-warn)]" : ""
  return (
    <div className="rev-card">
      <div className="rc-label">{label}</div>
      <div className="rc-row">
        <span className={`rc-value ${valueTone}`}>{value}</span>
      </div>
      {hint && <div className="rc-sub">{hint}</div>}
    </div>
  )
}
