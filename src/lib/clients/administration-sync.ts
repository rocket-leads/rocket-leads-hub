import type { BillingSummary } from "@/lib/integrations/stripe"
import type { ClientStatus } from "@/lib/clients/status"
import { updateClientField } from "@/lib/clients/edit"
import {
  ADMIN_LABELS,
  shouldAutoWriteAdministration,
  type AdminLabel,
} from "./administration"

/**
 * Inputs the reconciler needs to decide whether/what to write to the
 * "Administration" column. All fields normalised to the same shape
 * `MondayClient` already provides - pass the cached client object directly.
 */
export type AdminSyncInput = {
  /** Hub-canonical campaign status (live / on_hold / etc.). Drives the
   *  Unholt branch - held campaigns get an "Unholt" admin flag regardless
   *  of what Stripe says. */
  campaignStatus: ClientStatus | null
  /** Stripe payment state for this customer, from `billing_summaries` cache.
   *  Null when the client isn't linked to a Stripe customer. */
  stripe: Pick<BillingSummary, "status"> | null
  /** YYYY-MM-DD; null when the row has no cycle yet. Used to fire the
   *  "Send invoice" target when the date is today / past. */
  nextInvoiceDate: string | null
  /** Current Monday admin value (raw). Empty when unset. The reconciler
   *  compares against this to decide whether the target value is worth
   *  writing - same-value writes are skipped. */
  currentAdministration: string
  /** ISO date `YYYY-MM-DD` used as "today" for the cycle-reached check.
   *  Passed in (instead of computed inside) so callers + tests share a
   *  clock reference. */
  today: string
}

/**
 * Decide which admin label the Hub should write for a client, given the
 * latest Stripe + campaign + cycle state. Returns `null` when no auto-target
 * applies (no Stripe linkage, no cycle reached, etc.) - caller should leave
 * the column alone.
 *
 * Precedence (top wins):
 *   1. campaign on hold              → Unholt
 *   2. Stripe says overdue           → Overdue
 *   3. Stripe says open              → Invoice sent
 *   4. cycle date reached + no Stripe open invoice → Send invoice
 *   5. Stripe says complete          → Payments complete
 *
 * Rationale: an explicit on-hold beats every other signal (we shouldn't
 * flag a held client as needing an invoice). After that, Stripe's negative
 * signals (overdue/open) take priority over cycle-driven prompts because
 * they reflect what actually happened with money. "Send invoice" only fires
 * when finance hasn't sent anything yet AND the cycle date has arrived.
 * "Payments complete" is the resting state - only set when nothing else is
 * outstanding.
 */
export function targetAdminStatus(input: AdminSyncInput): AdminLabel | null {
  if (input.campaignStatus === "on_hold") return ADMIN_LABELS.onHold

  const stripeStatus = input.stripe?.status ?? null
  if (stripeStatus === "overdue") return ADMIN_LABELS.overdue
  if (stripeStatus === "open") return ADMIN_LABELS.invoiceSend

  // Cycle reached + no live Stripe activity → finance still owes an invoice.
  // Comparing strings works because both sides are `YYYY-MM-DD` and the date
  // shape sorts lexically the same way it sorts chronologically.
  if (input.nextInvoiceDate && input.nextInvoiceDate <= input.today) {
    return ADMIN_LABELS.sendInvoice
  }

  if (stripeStatus === "complete") return ADMIN_LABELS.paymentsComplete
  return null
}

/**
 * Compute the target + write it to Monday if (a) we have a target and (b)
 * the overwrite rules in `shouldAutoWriteAdministration` allow it.
 *
 * Always best-effort - a Monday failure is logged but never thrown. The
 * caller (cron / endpoint) shouldn't fail because the admin column couldn't
 * be reconciled; the next cron tick will retry.
 *
 * Returns the label that was actually written, or null when nothing changed.
 */
export async function reconcileAdministrationForClient(
  mondayItemId: string,
  input: AdminSyncInput,
): Promise<AdminLabel | null> {
  const target = targetAdminStatus(input)
  if (!target) return null
  if (!shouldAutoWriteAdministration(input.currentAdministration, target)) return null

  try {
    await updateClientField(mondayItemId, {
      fieldKey: "administration",
      label: target,
    })
    return target
  } catch (e) {
    console.error(
      `[admin-sync] write failed for ${mondayItemId} (${target}):`,
      e instanceof Error ? e.message : e,
    )
    return null
  }
}

/**
 * Force-write a target label, bypassing the auto-overwrite rules. Used by
 * event-driven callers that know the truth - e.g. after a successful Stripe
 * `createAndSendInvoice` we KNOW the admin should be "Invoice sent", no
 * reason to consult Stripe state again.
 *
 * Returns `{ ok: true }` on success or `{ ok: false, error }` with the
 * underlying Monday error message - callers surface it to finance so they
 * know whether the column is unmapped, the label is unknown, the token's
 * scope is wrong, etc. (Previously this returned a bare boolean and the
 * real reason only showed up in server logs.)
 */
export async function setAdministration(
  mondayItemId: string,
  target: AdminLabel,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updateClientField(mondayItemId, {
      fieldKey: "administration",
      label: target,
    })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(
      `[admin-sync] force-write failed for ${mondayItemId} (${target}):`,
      msg,
    )
    return { ok: false, error: msg }
  }
}
