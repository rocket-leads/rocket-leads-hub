import { createAdminClient } from "@/lib/supabase/server"
import type { MondayClient } from "@/lib/integrations/monday"
import { seedDefaultAgreementIfMissing } from "./agreement"

/**
 * Fast variant of `syncClientToSupabase` - only ensures a `clients` row
 * exists for this Monday item and returns its Supabase UUID. Used by
 * latency-sensitive paths (client slide-over) where we just need the
 * id to power downstream queries; the full sync of all Monday fields
 * can happen in the background via `syncClientToSupabase` itself.
 *
 * 1 round-trip in the common case (SELECT id). Falls back to 2 round
 * trips for first-time-seen clients (SELECT, then INSERT). Idempotent
 * and safe to call concurrently with the full sync.
 */
export async function ensureClientId(client: MondayClient): Promise<string> {
  const supabase = await createAdminClient()
  const { data: existing } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", client.mondayItemId)
    .single()
  if (existing) return existing.id

  // Brand-new client. Insert just enough to get an id back; the full
  // sync (column values, agreement seed) is the caller's responsibility
  // to fire afterwards via `syncClientToSupabase`.
  const { data, error } = await supabase
    .from("clients")
    .insert({
      monday_item_id: client.mondayItemId,
      monday_board_type: client.boardType,
      name: client.name,
    })
    .select("id")
    .single()
  if (error || !data) {
    throw new Error(`ensureClientId failed: ${error?.message ?? "unknown"}`)
  }
  return data.id
}

export async function syncClientToSupabase(client: MondayClient): Promise<string> {
  const supabase = await createAdminClient()

  // Monday returns dates as `YYYY-MM-DD` text; treat anything else as unset
  // rather than risk feeding Postgres a malformed value.
  const dateOrNull = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)

  const syncFields = {
    monday_board_type: client.boardType,
    monday_client_board_id: client.clientBoardId || null,
    name: client.name,
    meta_ad_account_id: client.metaAdAccountId || null,
    stripe_customer_id: client.stripeCustomerId || null,
    google_drive_folder_id: client.googleDriveId || null,
    cycle_start_date: dateOrNull(client.cycleStartDate),
    next_invoice_date: dateOrNull(client.nextInvoiceDate),
    updated_at: new Date().toISOString(),
  }

  // Try update first - preserves columns like column_mapping_override and monday_active
  const { data: existing } = await supabase
    .from("clients")
    .select("id, trengo_contact_ids, monday_board_type")
    .eq("monday_item_id", client.mondayItemId)
    .single()

  // A client crossing onboarding → current-clients board IS go-live - the
  // precise New-Business vs MRR boundary. We stamp it as a SEPARATE best-effort
  // write after the main sync (below), never inline: the `went_live_at` column
  // may not exist yet on a lagging migration, and a failed write there must not
  // break the whole client sync.
  const crossedToLive =
    !!existing && client.boardType === "current" && existing.monday_board_type === "onboarding"

  // trengo_contact_ids is a UNION, never an overwrite: the Hub's "Link to
  // client" button appends extra contact ids (a client can have several Trengo
  // contacts — duplicates, a churned-and-recreated number, etc.), and a plain
  // sync from Monday's single-value column would wipe those every cycle. Keep
  // any existing ids and add Monday's. Roy 2026-07-22.
  const mondayId = client.trengoContactId?.trim()
  const unionContactIds = Array.from(
    new Set([
      ...(((existing?.trengo_contact_ids as string[] | null) ?? [])),
      ...(mondayId ? [mondayId] : []),
    ]),
  )

  let clientId: string
  if (existing) {
    const { error } = await supabase
      .from("clients")
      .update({ ...syncFields, trengo_contact_ids: unionContactIds })
      .eq("monday_item_id", client.mondayItemId)
    if (error) throw new Error(`Supabase sync failed: ${error.message}`)
    clientId = existing.id
  } else {
    const { data, error } = await supabase
      .from("clients")
      .insert({
        monday_item_id: client.mondayItemId,
        ...syncFields,
        trengo_contact_ids: mondayId ? [mondayId] : [],
      })
      .select("id")
      .single()
    if (error) throw new Error(`Supabase sync failed: ${error.message}`)
    clientId = data!.id
  }

  // Stamp go-live on the onboarding → current transition. Best-effort + isolated:
  //  - `.is("went_live_at", null)` means we never overwrite an existing date, so
  //    we don't need to read the column first.
  //  - errors are swallowed - a missing column (migration not yet applied) or any
  //    blip must not break the sync. Falls back to board-membership classification.
  if (crossedToLive) {
    try {
      await supabase
        .from("clients")
        .update({ went_live_at: new Date().toISOString() })
        .eq("monday_item_id", client.mondayItemId)
        .is("went_live_at", null)
    } catch (e) {
      console.error("went_live_at stamp failed:", e)
    }
  }

  // Seed a default agreement on first sync (or first sync after the feature
  // shipped). Idempotent: never overwrites an existing row, so manual edits
  // via the UI are always preserved. Failures here are intentionally swallowed
  // - a broken seed shouldn't block the client from loading.
  try {
    await seedDefaultAgreementIfMissing(client, clientId)
  } catch (e) {
    console.error("Agreement seed failed:", e)
  }

  return clientId
}
