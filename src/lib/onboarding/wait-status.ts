import { fetchClientById } from "@/lib/integrations/monday"
import { fetchOnboardingPaymentStatus } from "@/lib/integrations/stripe"
import { listFolderFiles } from "@/lib/integrations/google-drive"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Wait-on-client poll for the onboarding wizard's Stap 4.
 *
 * The step is non-blocking from the AM's side - they just watch three
 * client-side actions flip from red to green:
 *
 *   1. Drive content    - client uploaded files into `Content van klant/`
 *                          subfolder created during auto-setup. Threshold:
 *                          ≥1 file in the subfolder.
 *   2. Meta BM linked   - client connected their Business Manager via the
 *                          Embedded Signup link (Sprint 6) OR completed the
 *                          manual partner-invite flow off the placeholder
 *                          guide page. We detect this as `metaAdAccountId`
 *                          being set on Monday - proxy signal that an AM
 *                          (or future Embedded Signup callback) confirmed
 *                          the partnership.
 *   3. Payment received - any paid invoice on the linked Stripe customer.
 *                          Reuses `fetchOnboardingPaymentStatus`.
 *
 * Stap 4 marks itself done when ALL three are green. The wizard's
 * existing `derive` on wait_on_client uses the same signals so the step
 * auto-completes without AM action.
 */

export type WaitStatus = {
  driveContent: {
    detected: boolean
    fileCount: number
    /** Folder ID we checked. Null when auto-setup hasn't yet captured
     *  the `Content van klant/` subfolder ID - UI shows "checking…". */
    folderId: string | null
  }
  metaBmLinked: {
    detected: boolean
    /** The actual ad account ID once linked. */
    adAccountId: string | null
  }
  payment: {
    detected: boolean
    lastPaidAt: number | null
    lastPaidAmount: number | null
    hasCustomerId: boolean
  }
  allGreen: boolean
}

export async function fetchWaitStatus(args: {
  mondayItemId: string
}): Promise<WaitStatus> {
  const supabase = await createAdminClient()

  // Pull all the inputs in parallel - none of them depend on each other.
  const [client, kickoffRow, paymentStatus] = await Promise.all([
    fetchClientById(args.mondayItemId).catch(() => null),
    supabase
      .from("client_onboarding_tasks")
      .select("content")
      .eq("monday_item_id", args.mondayItemId)
      .eq("task_key", "kickoff_live")
      .maybeSingle()
      .then((r) => r.data),
    // Pull Stripe payment via the same helper Stap 1 uses, so the
    // signals never disagree. fetchClientById is null-safe-resolved
    // before this lands, so we do the Stripe call only when we have a
    // customer ID below.
    Promise.resolve(null),
  ])

  const stripeCustomerId = client?.stripeCustomerId ?? ""
  const payment = stripeCustomerId
    ? await fetchOnboardingPaymentStatus(stripeCustomerId)
    : { hasPaid: false, lastPaidAt: null, lastPaidAmount: null }

  // ── Drive content detection ──
  // The "Content van klant" subfolder ID was captured during auto-setup
  // in Stap 1. Pulling it from there avoids a Drive folder-tree walk
  // every poll tick.
  const autoSetup =
    (kickoffRow?.content as
      | { autoSetup?: { drive?: { subfolders?: Record<string, { id: string }> } } }
      | null) ?? null
  const clientContentFolderId =
    autoSetup?.autoSetup?.drive?.subfolders?.clientContent?.id ?? null

  let driveDetected = false
  let driveFileCount = 0
  if (clientContentFolderId) {
    try {
      const files = await listFolderFiles(clientContentFolderId)
      driveFileCount = files.length
      driveDetected = driveFileCount > 0
    } catch (e) {
      // Drive hiccup - treat as not-yet-detected rather than throwing.
      // Next poll will retry; the UI shows the previous value until
      // then via React Query staleness.
      console.error(
        `[wait-status] Drive list failed for ${clientContentFolderId}:`,
        e instanceof Error ? e.message : e,
      )
    }
  }

  // ── Manual klant-action signals (Roy 2026-06-11) ──
  // Both Drive content and Meta partnership are now AM-confirmed
  // checkboxes in Stap 1, not auto-detected. Wait-status reads them
  // from kickoff_live content. "RL ad account" toggle counts as
  // Meta-done since we're not waiting on klant in that path.
  const kickoffContent = kickoffRow?.content as
    | {
        metaConnected?: { confirmedAt?: string }
        clientContentUploaded?: { confirmedAt?: string }
        useRlAdAccount?: boolean
      }
    | null
    | undefined
  const metaDetected =
    Boolean(kickoffContent?.metaConnected?.confirmedAt) ||
    Boolean(kickoffContent?.useRlAdAccount)
  const adAccountId = client?.metaAdAccountId ?? ""

  // Override the Drive detection — manual signal trumps the file-count
  // poll. AM confirmation is the canonical truth; the poll is just a
  // nudge surface that doesn't gate the wait step anymore.
  if (kickoffContent?.clientContentUploaded?.confirmedAt) {
    driveDetected = true
  }

  const allGreen = driveDetected && metaDetected && payment.hasPaid

  return {
    driveContent: {
      detected: driveDetected,
      fileCount: driveFileCount,
      folderId: clientContentFolderId,
    },
    metaBmLinked: {
      detected: metaDetected,
      adAccountId: adAccountId || null,
    },
    payment: {
      detected: payment.hasPaid,
      lastPaidAt: payment.lastPaidAt,
      lastPaidAmount: payment.lastPaidAmount,
      hasCustomerId: stripeCustomerId.length > 0,
    },
    allGreen,
  }
}
