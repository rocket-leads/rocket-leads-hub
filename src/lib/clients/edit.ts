import { createAdminClient } from "@/lib/supabase/server"
import {
  fetchClientById,
  setItemColumnValue,
  setItemColumnValueRaw,
  type MondayClient,
} from "@/lib/integrations/monday"
import { syncClientToSupabase } from "./sync"
import { deriveInvoiceDate } from "./billing-cycle"
import { readCache, writeCache } from "@/lib/cache"

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
  // The cycle-start drives the invoice date — see updateClientField below for
  // the dual-write that keeps Monday's `date_mm3297df` in lockstep with this.
  "cycle_start_date",
  // Kept editable for legacy paths and admin overrides, but the canonical
  // flow is to edit `cycle_start_date` and let the derived value flow.
  "next_invoice_date",
] as const

const STATUS_FIELDS = ["campaign_status", "country", "contact_channel", "administration"] as const

const PERSON_FIELDS = ["account_manager", "campaign_manager", "appointment_setter"] as const

export type SimpleFieldKey = (typeof SIMPLE_FIELDS)[number]
export type StatusFieldKey = (typeof STATUS_FIELDS)[number]
export type PersonFieldKey = (typeof PERSON_FIELDS)[number]

export type ClientFieldUpdate =
  | { fieldKey: SimpleFieldKey; value: string }
  | { fieldKey: StatusFieldKey; label: string }
  | { fieldKey: PersonFieldKey; personIds: number[] }

const SIMPLE_SET = new Set<string>(SIMPLE_FIELDS)
const STATUS_SET = new Set<string>(STATUS_FIELDS)
const PERSON_SET = new Set<string>(PERSON_FIELDS)

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
      // invoice at send time — so their cycles HAVE to be in lockstep or
      // we'd unintentionally produce two separate invoices a few days apart.
      // Propagate the same cycle/invoice dates to every sibling. Errors on
      // any one sibling don't block the others — finance can rerun later.
      await syncCycleToSiblings(mondayItemId, update.value, derivedInvoice)
    }
  } else if (STATUS_SET.has(update.fieldKey) && "label" in update) {
    // Empty label clears the status — Monday accepts `{ label: "" }` as a reset.
    await setItemColumnValueRaw(boardType, mondayItemId, update.fieldKey, {
      label: update.label,
    })
    // Auto-sync: when the campaign flips to "On hold" the Administration column
    // should follow as "On hold" too — billing is paused, finance shouldn't be
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

  // Bypass cache on this read — we just wrote to Monday and the 5-minute
  // cached value is stale by definition. Without the bypass, the cache patch
  // below would re-poison `monday_boards` with the pre-edit snapshot and the
  // status pill / cycle date would visibly snap back to the old value on
  // `router.refresh()`.
  const refreshed = await fetchClientById(mondayItemId, { bypassCache: true })
  if (refreshed) {
    await syncClientToSupabase(refreshed)
    // Patch the `monday_boards` cache so the next page render — kicked off by
    // the caller's router.refresh() — sees the new value instead of the
    // pre-edit snapshot the cron last wrote.
    await patchMondayBoardsCache(refreshed)
  }
}

/**
 * Patch a single client into the `monday_boards` cache so the next page
 * render sees the up-to-date row without waiting for the daily cron tick.
 * Exported so the Monday webhook receiver can call it when a column changes
 * upstream (status edit in Monday, AM swap, etc.) — same code path the
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
    // Cache patching is best-effort — a failed write only means the user
    // sees stale state until the next cron tick or manual refresh.
    console.error("monday_boards cache patch failed:", e instanceof Error ? e.message : e)
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
 * Per-sibling failures are logged but don't throw — finance can hit Refresh
 * to re-attempt the sync via a follow-up edit. The target row is already
 * updated by the time we get here.
 */
async function syncCycleToSiblings(
  sourceMondayItemId: string,
  cycleStartDate: string,
  derivedInvoiceDate: string,
): Promise<void> {
  const supabase = await createAdminClient()

  // Resolve the source's Stripe customer. Empty/null = no siblings to sync —
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
