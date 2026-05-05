import { createAdminClient } from "@/lib/supabase/server"
import {
  fetchClientById,
  setItemColumnValue,
  setItemColumnValueRaw,
} from "@/lib/integrations/monday"
import { syncClientToSupabase } from "./sync"
import { deriveInvoiceDate } from "./billing-cycle"

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

const STATUS_FIELDS = ["campaign_status", "country", "contact_channel"] as const

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
    }
  } else if (STATUS_SET.has(update.fieldKey) && "label" in update) {
    // Empty label clears the status — Monday accepts `{ label: "" }` as a reset.
    await setItemColumnValueRaw(boardType, mondayItemId, update.fieldKey, {
      label: update.label,
    })
  } else if (PERSON_SET.has(update.fieldKey) && "personIds" in update) {
    await setItemColumnValueRaw(boardType, mondayItemId, update.fieldKey, {
      personsAndTeams: update.personIds.map((id) => ({ id, kind: "person" })),
    })
  } else {
    throw new Error(`Unsupported field update for "${update.fieldKey}"`)
  }

  const refreshed = await fetchClientById(mondayItemId)
  if (refreshed) await syncClientToSupabase(refreshed)
}
