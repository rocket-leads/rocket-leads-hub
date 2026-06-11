import type { MetaAdAccountHealth } from "@/lib/integrations/meta"

/**
 * Billing-health verdict per client. Two signals merge into one verdict:
 *
 *   1. DIRECT - Meta API `account_status` (disabled / unsettled / grace
 *      period / pending settlement). Hard signal: Meta itself says
 *      there's a payment problem.
 *
 *   2. INDIRECT - actual 7d spend vs expected weekly budget (derived from
 *      `agreement.ad_budget / 4.33`). When actual is dramatically below
 *      expected, the most common cause is a billing error Meta hasn't
 *      labelled at the account level yet (declined card, expired payment
 *      method on a campaign, etc).
 *
 * The "live-but-dark" detector (`detectLiveButDark` in watchlist/categorize)
 * already covers full stop = 0 spend. THIS detector covers partial spend
 * - the case Roy described: "I see only €50 spent all week on a €2k/mo
 * budget, that's almost certainly a billing problem."
 *
 * Pure module - no DB, no fetch. Refresh-cache cron is the impure caller.
 */

export type BillingHealthReason =
  | "ACCOUNT_DISABLED"
  | "UNSETTLED"
  | "PENDING_SETTLEMENT"
  | "GRACE_PERIOD"
  | "UNDERSPEND_SEVERE"
  | "NONE"

export type BillingHealthVerdict = {
  /** True for anything that needs AM action. */
  hasIssue: boolean
  /** "billing_error" = Meta API direct signal (very confident).
   *  "severe_underspend" = inferred from spend vs expected (likely
   *  billing but could also be intentional pause / new account ramp-up). */
  severity: "billing_error" | "severe_underspend" | "ok"
  reason: BillingHealthReason
  /** Short label for AI Note / Watch List insight ("Account disabled - unpaid balance",
   *  "Underspending - €50 spent vs €462 expected (last 7d)"). Always in English; UI/AI
   *  picks Dutch when needed. */
  label: string
  /** Computed weekly budget from agreement.ad_budget. Null when no agreement. */
  expectedWeeklyBudget: number | null
  /** Actual spend across the last 7d window. */
  actualSpendLast7d: number
  /** actualSpendLast7d / expectedWeeklyBudget. Null when expected is null
   *  or zero. Useful for ranking / displaying "spending at 11% of plan". */
  spendRatio: number | null
  /** Meta direct signal - null when fetch failed for this client. */
  metaHealth: MetaAdAccountHealth | null
}

/** Spend below this ratio of expected weekly budget = severe underspend.
 *  Calibrated to mean "you're spending so little, this is almost certainly
 *  not a campaign-tweak decision - something broke." 0.4 = 40% of expected. */
const UNDERSPEND_RATIO_THRESHOLD = 0.4

/** Minimum days of activity in the 7d window required to call underspend.
 *  Stops us flagging brand-new accounts that just went live mid-week - they
 *  always look "underspent" against the prorated weekly budget. */
const UNDERSPEND_MIN_DAYS = 3

/** Minimum expected weekly budget to even check underspend. Clients on
 *  €100/wk plans have so much daily noise that a "low spend week" is
 *  meaningless. Below this we rely on the direct Meta signal only. */
const UNDERSPEND_MIN_EXPECTED_WEEKLY = 150

export type BillingHealthInput = {
  metaHealth: MetaAdAccountHealth | null
  /** From client_agreements.ad_budget. Null when no agreement row exists. */
  monthlyAdBudget: number | null
  actualSpendLast7d: number
  /** Days in the last 7 that had any spend > 0. Lets us tell "underspend
   *  on a paused-then-restarted campaign" (3 active days, low cumulative
   *  spend = OK, ramping up) from "structural underspend" (7 active days
   *  with consistent low daily spend = billing issue). */
  daysWithSpendLast7d: number
}

/** Convert monthly budget → weekly. 4.33 weeks/month is the industry
 *  convention (52 / 12). Close enough for budget-comparison purposes. */
function monthlyToWeekly(monthly: number): number {
  return monthly / 4.33
}

export function computeBillingHealth(input: BillingHealthInput): BillingHealthVerdict {
  const expectedWeeklyBudget =
    input.monthlyAdBudget && input.monthlyAdBudget > 0
      ? monthlyToWeekly(input.monthlyAdBudget)
      : null

  const spendRatio =
    expectedWeeklyBudget && expectedWeeklyBudget > 0
      ? input.actualSpendLast7d / expectedWeeklyBudget
      : null

  // ─── 1. Direct signal from Meta - wins over everything else ────────────
  if (input.metaHealth?.isBillingIssue) {
    const status = input.metaHealth.accountStatus
    const label = input.metaHealth.accountStatusLabel
    const reason: BillingHealthReason =
      status === 2 ? "ACCOUNT_DISABLED"
        : status === 3 ? "UNSETTLED"
          : status === 8 ? "PENDING_SETTLEMENT"
            : status === 9 ? "GRACE_PERIOD"
              : "ACCOUNT_DISABLED"

    return {
      hasIssue: true,
      severity: "billing_error",
      reason,
      label: `Meta account: ${label}${expectedWeeklyBudget != null ? ` - €${input.actualSpendLast7d.toFixed(0)} spent (7d) vs €${expectedWeeklyBudget.toFixed(0)} expected` : ""}`,
      expectedWeeklyBudget,
      actualSpendLast7d: input.actualSpendLast7d,
      spendRatio,
      metaHealth: input.metaHealth,
    }
  }

  // ─── 2. Indirect signal - severe underspend vs expected weekly ─────────
  if (
    expectedWeeklyBudget != null &&
    expectedWeeklyBudget >= UNDERSPEND_MIN_EXPECTED_WEEKLY &&
    spendRatio != null &&
    spendRatio < UNDERSPEND_RATIO_THRESHOLD &&
    input.daysWithSpendLast7d >= UNDERSPEND_MIN_DAYS
  ) {
    return {
      hasIssue: true,
      severity: "severe_underspend",
      reason: "UNDERSPEND_SEVERE",
      label: `Underspending - €${input.actualSpendLast7d.toFixed(0)} spent (7d) vs €${expectedWeeklyBudget.toFixed(0)} expected (${(spendRatio * 100).toFixed(0)}% of plan). Likely billing error.`,
      expectedWeeklyBudget,
      actualSpendLast7d: input.actualSpendLast7d,
      spendRatio,
      metaHealth: input.metaHealth,
    }
  }

  // ─── 3. All clear ──────────────────────────────────────────────────────
  return {
    hasIssue: false,
    severity: "ok",
    reason: "NONE",
    label: input.metaHealth ? `Meta account: ${input.metaHealth.accountStatusLabel}` : "No Meta health data",
    expectedWeeklyBudget,
    actualSpendLast7d: input.actualSpendLast7d,
    spendRatio,
    metaHealth: input.metaHealth,
  }
}

/** AM-facing template message in NL. Pasted unchanged into the auto-task
 *  body - the AM hits send to their WhatsApp/email line to the client.
 *  Keep this in this module (not the cron) so prompt engineering iterates
 *  alongside the verdict logic. */
export function billingErrorTemplateMessageNL(args: {
  clientFirstName: string
  verdict: BillingHealthVerdict
}): string {
  const { verdict, clientFirstName } = args
  if (verdict.severity === "billing_error") {
    return `Hé ${clientFirstName}, ik zag dat er een betaalprobleem in je Meta ad account staat (${verdict.metaHealth?.accountStatusLabel ?? "betalingsfout"}). De campagnes draaien daardoor op halve kracht en deze week is er maar €${verdict.actualSpendLast7d.toFixed(0)} besteed${verdict.expectedWeeklyBudget != null ? ` (zou ~€${verdict.expectedWeeklyBudget.toFixed(0)} moeten zijn)` : ""}. Kun je vandaag even in Meta Business Manager je betaalmethode updaten? Dan zet ik de campagnes weer op volle snelheid.`
  }
  // severe_underspend - softer phrasing, we're inferring
  return `Hé ${clientFirstName}, ik zag dat we deze week maar €${verdict.actualSpendLast7d.toFixed(0)} hebben kunnen besteden${verdict.expectedWeeklyBudget != null ? ` van de geplande ~€${verdict.expectedWeeklyBudget.toFixed(0)}` : ""}. Dat lijkt op een betaalprobleem in je Meta ad account. Kun je even in Business Manager checken of je betaalmethode nog werkt? Dan kunnen we de campagnes weer op volle snelheid zetten.`
}
