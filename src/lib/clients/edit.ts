import { createAdminClient } from "@/lib/supabase/server"
import {
  clientItemCacheKey,
  fetchClientById,
  setItemColumnValue,
  setItemColumnValueRaw,
  type MondayClient,
} from "@/lib/integrations/monday"
import { syncClientToSupabase } from "./sync"
import { deriveInvoiceDate } from "./billing-cycle"
import { readCache, writeCache } from "@/lib/cache"
import { mondayStatusToHub, hubStatusToMondayLabel } from "./status"
import { resolveWizardState, missingCriticalSteps } from "./onboarding"
import { fetchStoredSteps } from "./onboarding-state"

const SIMPLE_FIELDS = [
  "company_name",
  "first_name",
  "ad_budget",
  "service_fee",
  "meta_ad_account_id",
  "stripe_customer_id",
  "trengo_contact_id",
  "client_board_id",
  "google_drive_id",
  "kick_off_date",
  // Client contact details, Monday-canonical (board_config keys `email` +
  // `phone`). Used by the Co-pilot calendar-invite flow as the invitee
  // address, and by the Trengo send paths for WhatsApp template targeting.
  "email",
  "phone",
  // The cycle-start drives the invoice date - see updateClientField below for
  // the dual-write that keeps Monday's `date_mm3297df` in lockstep with this.
  "cycle_start_date",
  // Kept editable for legacy paths and admin overrides, but the canonical
  // flow is to edit `cycle_start_date` and let the derived value flow.
  "next_invoice_date",
] as const

const STATUS_FIELDS = ["campaign_status", "country", "contact_channel", "administration"] as const

const PERSON_FIELDS = ["account_manager", "campaign_manager", "appointment_setter"] as const

// Fields that live only in Supabase - no Monday column behind them. Writes go
// straight to the `clients` table, no Monday mutation, no cache patch on the
// `monday_boards` snapshot (which is keyed off Monday columns). See the
// 20240046 migration for the rationale on `next_ad_budget_invoice_date`.
const SUPABASE_ONLY_FIELDS = ["next_ad_budget_invoice_date"] as const

export type SimpleFieldKey = (typeof SIMPLE_FIELDS)[number]
export type StatusFieldKey = (typeof STATUS_FIELDS)[number]
export type PersonFieldKey = (typeof PERSON_FIELDS)[number]
export type SupabaseOnlyFieldKey = (typeof SUPABASE_ONLY_FIELDS)[number]

/**
 * Person updates carry both IDs (what Monday needs in the mutation) and
 * the display names (what the cache patch writes in-place). With names in
 * the payload we can skip the read-after-write entirely and avoid Monday's
 * person-column eventual-consistency window - see the comment above
 * `patchCacheWithKnownValue` for the full rationale.
 */
export type ClientFieldUpdate =
  | { fieldKey: SimpleFieldKey; value: string }
  | { fieldKey: StatusFieldKey; label: string }
  | { fieldKey: PersonFieldKey; personIds: number[]; personNames?: string[] }
  | { fieldKey: SupabaseOnlyFieldKey; value: string }

const SIMPLE_SET = new Set<string>(SIMPLE_FIELDS)
const STATUS_SET = new Set<string>(STATUS_FIELDS)
const PERSON_SET = new Set<string>(PERSON_FIELDS)
const SUPABASE_ONLY_SET = new Set<string>(SUPABASE_ONLY_FIELDS)

/**
 * Apply a single field update to a client, identified by Monday item ID
 * (matches the URL convention used by the rest of `/api/clients/[id]/*`).
 * Looks up the board type via Supabase, writes back to Monday with the right
 * mutation for the column type, then re-syncs the cached columns back into
 * Supabase. Throws on failure so callers can surface a clear error.
 */
export async function updateClientField(
  mondayItemId: string,
  update: ClientFieldUpdate,
): Promise<void> {
  const supabase = await createAdminClient()
  const { data: client, error } = await supabase
    .from("clients")
    .select("monday_board_type")
    .eq("monday_item_id", mondayItemId)
    .single()

  if (error || !client) {
    throw new Error(
      `Client ${mondayItemId} not synced to Supabase yet. Open the clients page once to trigger the initial sync.`,
    )
  }

  const boardType = client.monday_board_type as "onboarding" | "current"

  if (SUPABASE_ONLY_SET.has(update.fieldKey) && "value" in update) {
    // Hub-only field - no Monday column behind it, so this is a Supabase
    // write only. We also short-circuit the cache-patch + re-sync that
    // Monday-backed fields go through: the `monday_boards` cache is keyed
    // off Monday columns, and `syncClientToSupabase` re-mirrors only the
    // Monday-derived fields - neither touches this column.
    await writeSupabaseOnlyField(mondayItemId, update.fieldKey as SupabaseOnlyFieldKey, update.value)
    return
  }

  if (SIMPLE_SET.has(update.fieldKey) && "value" in update) {
    await setItemColumnValue(boardType, mondayItemId, update.fieldKey, update.value)
    // Cycle start drives the invoice date. Whenever cycle changes (incl. clearing
    // it), recompute the invoice date and write that to Monday too so the two
    // columns there can never drift. Empty cycle → empty invoice.
    if (update.fieldKey === "cycle_start_date") {
      const derivedInvoice = deriveInvoiceDate(update.value) ?? ""
      await setItemColumnValue(boardType, mondayItemId, "next_invoice_date", derivedInvoice)
      // Sibling sync: if multiple Monday rows share a Stripe customer (e.g.
      // "O2 Plus | B2B" and "O2 Plus | B2C"), they're consolidated into one
      // invoice at send time - so their cycles HAVE to be in lockstep or
      // we'd unintentionally produce two separate invoices a few days apart.
      // Propagate the same cycle/invoice dates to every sibling. Errors on
      // any one sibling don't block the others - finance can rerun later.
      await syncCycleToSiblings(mondayItemId, update.value, derivedInvoice)
    }
  } else if (STATUS_SET.has(update.fieldKey) && "label" in update) {
    // Critical-items gate (Onboarding → Live). Fires when an AM (or
    // any caller) tries to promote a client from "onboarding" Hub
    // status to "Live". Any critical wizard step still open blocks
    // the write. Other status transitions (Live → Live re-write,
    // OnHold → Live, Churned → Live) skip the gate - those clients
    // already passed it once.
    if (
      update.fieldKey === "campaign_status" &&
      update.label === hubStatusToMondayLabel("live")
    ) {
      const snapshot = await fetchClientById(mondayItemId)
      if (snapshot) {
        const currentHubStatus = mondayStatusToHub(snapshot.campaignStatus, boardType)
        if (currentHubStatus === "onboarding") {
          const stored = await fetchStoredSteps(mondayItemId)
          const states = resolveWizardState(snapshot, stored)
          const missing = missingCriticalSteps(states)
          if (missing.length > 0) {
            throw new Error(
              `Cannot promote to Live - ${missing.length} critical onboarding step(s) still open: ` +
                missing.map((m) => m.key).join(", "),
            )
          }
        }
      }
    }

    // Empty label clears the status - Monday accepts `{ label: "" }` as a reset.
    await setItemColumnValueRaw(boardType, mondayItemId, update.fieldKey, {
      label: update.label,
    })
    // Auto-sync: when the campaign flips to "On hold" the Administration column
    // should follow as "On hold" too - billing is paused, finance shouldn't be
    // chasing a held client. The two columns share the same label by design
    // so finance can scan either one. Single Monday write, same boardType, no
    // extra refetch needed because the cache patch below picks both up.
    if (update.fieldKey === "campaign_status" && update.label === "On hold") {
      try {
        await setItemColumnValueRaw(boardType, mondayItemId, "administration", {
          label: "On hold",
        })
      } catch (e) {
        console.error(
          `[edit] on_hold → admin On-hold sync failed for ${mondayItemId}:`,
          e instanceof Error ? e.message : e,
        )
      }
    }
  } else if (PERSON_SET.has(update.fieldKey) && "personIds" in update) {
    await setItemColumnValueRaw(boardType, mondayItemId, update.fieldKey, {
      personsAndTeams: update.personIds.map((id) => ({ id, kind: "person" })),
    })
  } else {
    throw new Error(`Unsupported field update for "${update.fieldKey}"`)
  }

  // Patch the cache with what WE wrote - not with a Monday re-read.
  //
  // Why this matters: Monday's REST/GraphQL has read-after-write eventual
  // consistency, worst for `people` columns where the column.text join can
  // take 1-2s to settle. If we re-fetch immediately and write that back to
  // the cache, the cache momentarily holds the PRE-edit value. The client's
  // React Query invalidate (fired right after the PATCH returns) then reads
  // that stale cache and resets the optimistic state to "Unassigned" -
  // exactly Roy's "springt gelijk naar unassigned" symptom.
  //
  // By patching the cache with the value we know we wrote, the next render
  // sees the right thing immediately. The Monday webhook will fire a
  // second-or-so later and patch the cache again with Monday's actual
  // state - if our write succeeded as expected, that's an identical patch;
  // if Monday silently rejected something, the webhook's value wins and the
  // UI corrects itself.
  const patchedCachedClient = await patchCacheWithKnownValue(mondayItemId, update)
  if (patchedCachedClient) {
    // Best-effort Supabase mirror. Errors get swallowed - the per-client
    // sync runs again on the next page view through the existing ensureClientId
    // path so a transient Supabase blip doesn't block the Monday write.
    void syncClientToSupabase(patchedCachedClient).catch((e) => {
      console.error("[edit] supabase mirror after edit failed:", mondayItemId, e instanceof Error ? e.message : e)
    })
  }
}

/**
 * Apply our just-written value directly to the cached client snapshot,
 * skipping the Monday re-fetch race. Returns the patched client so callers
 * can mirror it to Supabase. Returns null when the client isn't in the
 * `monday_boards` cache yet - the cron will pick them up on its next tick.
 */
async function patchCacheWithKnownValue(
  mondayItemId: string,
  update: ClientFieldUpdate,
): Promise<MondayClient | null> {
  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
  )
  if (!cached) return null

  let patched: MondayClient | null = null

  const applyTo = (c: MondayClient): MondayClient => {
    if (c.mondayItemId !== mondayItemId) return c
    const next: MondayClient = { ...c }
    if (SIMPLE_SET.has(update.fieldKey) && "value" in update) {
      // Map fieldKey → MondayClient property. Anything not listed here is
      // an admin-only Supabase-mirrored field; the cache key doesn't carry
      // it so there's nothing to patch.
      const prop = SIMPLE_TO_CLIENT_PROP[update.fieldKey as SimpleFieldKey]
      if (prop) (next as Record<string, unknown>)[prop] = update.value
      // Cycle drives next-invoice - re-derive so the UI shows the linked
      // value without waiting for a refresh.
      if (update.fieldKey === "cycle_start_date") {
        next.nextInvoiceDate = deriveInvoiceDate(update.value) ?? ""
      }
    } else if (STATUS_SET.has(update.fieldKey) && "label" in update) {
      const prop = STATUS_TO_CLIENT_PROP[update.fieldKey as StatusFieldKey]
      if (prop) (next as Record<string, unknown>)[prop] = update.label
    } else if (PERSON_SET.has(update.fieldKey) && "personIds" in update) {
      const prop = PERSON_TO_CLIENT_PROP[update.fieldKey as PersonFieldKey]
      // personNames is the display value the cell renders. When the caller
      // didn't supply it (legacy callers, scripted edits) we fall back to
      // an empty string - the webhook will fill it in shortly anyway.
      if (prop) (next as Record<string, unknown>)[prop] = (update.personNames ?? []).join(", ")
    }
    patched = next
    return next
  }

  await writeCache("monday_boards", {
    onboarding: cached.onboarding.map(applyTo),
    current: cached.current.map(applyTo),
  })

  // Also patch the per-client item cache (fetchClientById's 5-minute key)
  // so the slide-over's detail fetch picks up the new value immediately.
  if (patched) {
    try {
      await writeCache(clientItemCacheKey(mondayItemId), patched)
    } catch {
      // Per-item cache miss is fine - the next fetchClientById call will
      // re-populate it from Monday (post-consistency window).
    }
  }

  return patched
}

// Maps from API fieldKey → MondayClient property. Anything that maps to
// undefined here lives on the Supabase mirror only (not in the cached
// MondayClient shape) and so doesn't need a cache patch.
const SIMPLE_TO_CLIENT_PROP: Partial<Record<SimpleFieldKey, keyof MondayClient>> = {
  company_name: "companyName",
  first_name: "firstName",
  ad_budget: "adBudget",
  service_fee: "serviceFee",
  meta_ad_account_id: "metaAdAccountId",
  stripe_customer_id: "stripeCustomerId",
  trengo_contact_id: "trengoContactId",
  client_board_id: "clientBoardId",
  google_drive_id: "googleDriveId",
  kick_off_date: "kickOffDate",
  cycle_start_date: "cycleStartDate",
  next_invoice_date: "nextInvoiceDate",
  email: "email",
  phone: "phone",
}

const STATUS_TO_CLIENT_PROP: Partial<Record<StatusFieldKey, keyof MondayClient>> = {
  campaign_status: "campaignStatus",
  contact_channel: "contactChannel",
  // `country` and `administration` aren't on the MondayClient shape today
  // - they're parsed lazily where needed. If we add them later, mirror
  // them here so the cache patch covers them too.
}

const PERSON_TO_CLIENT_PROP: Record<PersonFieldKey, keyof MondayClient> = {
  account_manager: "accountManager",
  campaign_manager: "campaignManager",
  appointment_setter: "appointmentSetter",
}

/**
 * Patch a single client into the `monday_boards` cache so the next page
 * render sees the up-to-date row without waiting for the daily cron tick.
 * Exported so the Monday webhook receiver can call it when a column changes
 * upstream (status edit in Monday, AM swap, etc.) - same code path the
 * in-Hub edit uses, keeping both edit-paths byte-equivalent.
 */
export async function patchMondayBoardsCache(refreshed: MondayClient): Promise<void> {
  try {
    const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>("monday_boards")
    if (!cached) return
    const replace = (list: MondayClient[]) =>
      list.map((c) => (c.mondayItemId === refreshed.mondayItemId ? refreshed : c))
    await writeCache("monday_boards", {
      onboarding: replace(cached.onboarding),
      current: replace(cached.current),
    })
  } catch (e) {
    // Cache patching is best-effort - a failed write only means the user
    // sees stale state until the next cron tick or manual refresh.
    console.error("monday_boards cache patch failed:", e instanceof Error ? e.message : e)
  }
}

/**
 * Write a Hub-only client field directly to Supabase. Also propagates to
 * sibling rows that share a `stripe_customer_id`, so multi-campaign clients
 * (B2B + B2C under one Stripe customer) keep one cadence per billable.
 *
 * Empty string clears the column (DATE → null). Treats anything that isn't
 * `YYYY-MM-DD` as a clear - same convention `syncClientToSupabase` uses for
 * the Monday-mirrored dates.
 */
async function writeSupabaseOnlyField(
  mondayItemId: string,
  fieldKey: SupabaseOnlyFieldKey,
  value: string,
): Promise<void> {
  const supabase = await createAdminClient()
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null

  const { data: source, error: srcErr } = await supabase
    .from("clients")
    .select("stripe_customer_id")
    .eq("monday_item_id", mondayItemId)
    .single()
  if (srcErr || !source) {
    throw new Error(`Client ${mondayItemId} not found in Supabase`)
  }

  const { error: updateErr } = await supabase
    .from("clients")
    .update({ [fieldKey]: normalized, updated_at: new Date().toISOString() })
    .eq("monday_item_id", mondayItemId)
  if (updateErr) {
    throw new Error(`Failed to update ${fieldKey}: ${updateErr.message}`)
  }

  const stripeCustomerId = source.stripe_customer_id as string | null
  if (!stripeCustomerId) return

  // Sibling sync - same rationale as `syncCycleToSiblings` for the fee
  // cycle. Per-sibling failures are logged but don't bubble up; the
  // primary row is already saved.
  const { error: sibErr } = await supabase
    .from("clients")
    .update({ [fieldKey]: normalized, updated_at: new Date().toISOString() })
    .eq("stripe_customer_id", stripeCustomerId)
    .neq("monday_item_id", mondayItemId)
  if (sibErr) {
    console.error(
      `Sibling sync for ${fieldKey} failed (Stripe ${stripeCustomerId}):`,
      sibErr.message,
    )
  }
}

/**
 * Find all OTHER Monday rows that share this client's Stripe customer ID and
 * write the same cycle/invoice dates to them. This is the auto-sync that
 * keeps multi-campaign clients (B2B + B2C, etc.) on a single invoice cadence.
 *
 * Called immediately after the target row's dates are written, so the target
 * is excluded by `monday_item_id`. Source-of-truth for "who shares a Stripe
 * customer" is Supabase's mirrored `stripe_customer_id` column on `clients`.
 *
 * Per-sibling failures are logged but don't throw - finance can hit Refresh
 * to re-attempt the sync via a follow-up edit. The target row is already
 * updated by the time we get here.
 */
async function syncCycleToSiblings(
  sourceMondayItemId: string,
  cycleStartDate: string,
  derivedInvoiceDate: string,
): Promise<void> {
  const supabase = await createAdminClient()

  // Resolve the source's Stripe customer. Empty/null = no siblings to sync -
  // the row isn't billable yet, so cycle drift between siblings can't bite.
  const { data: source } = await supabase
    .from("clients")
    .select("stripe_customer_id")
    .eq("monday_item_id", sourceMondayItemId)
    .maybeSingle()

  const stripeCustomerId = source?.stripe_customer_id as string | null | undefined
  if (!stripeCustomerId) return

  const { data: siblings } = await supabase
    .from("clients")
    .select("monday_item_id, monday_board_type")
    .eq("stripe_customer_id", stripeCustomerId)
    .neq("monday_item_id", sourceMondayItemId)

  if (!siblings || siblings.length === 0) return

  for (const sib of siblings) {
    const sibId = sib.monday_item_id as string
    const sibBoardType = sib.monday_board_type as "onboarding" | "current"
    try {
      await setItemColumnValue(sibBoardType, sibId, "cycle_start_date", cycleStartDate)
      await setItemColumnValue(sibBoardType, sibId, "next_invoice_date", derivedInvoiceDate)
      const refreshed = await fetchClientById(sibId, { bypassCache: true })
      if (refreshed) await syncClientToSupabase(refreshed)
    } catch (e) {
      console.error(
        `Sibling cycle sync failed for ${sibId} (Stripe ${stripeCustomerId}):`,
        e instanceof Error ? e.message : e,
      )
    }
  }
}

