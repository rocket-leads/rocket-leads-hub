import { createAdminClient } from "@/lib/supabase/server"

/**
 * The five external services a client connects to. These keys line up 1:1 with
 * the per-service fields on `ClientHealth` (src/lib/integrations/health.ts) and
 * the `client_connection_overrides.service` column.
 */
export const CONNECTION_SERVICES = ["stripe", "meta", "monday", "trengo", "drive"] as const
export type ConnectionService = (typeof CONNECTION_SERVICES)[number]

export function isConnectionService(value: string): value is ConnectionService {
  return (CONNECTION_SERVICES as readonly string[]).includes(value)
}

/** One override row: was this service explicitly marked "not applicable" for
 *  this client, and why. */
export type ConnectionOverride = {
  notApplicable: boolean
  note: string | null
}

/** Per-service overrides for a single client. Missing service = no override
 *  (the default "unresolved" state). */
export type ClientConnectionOverrides = Partial<Record<ConnectionService, ConnectionOverride>>

function rowsToMap(
  rows: Array<{ service: string; not_applicable: boolean; note: string | null }>,
): ClientConnectionOverrides {
  const out: ClientConnectionOverrides = {}
  for (const r of rows) {
    if (isConnectionService(r.service)) {
      out[r.service] = { notApplicable: r.not_applicable, note: r.note }
    }
  }
  return out
}

/** Load the connection overrides for one client. */
export async function getConnectionOverrides(
  mondayItemId: string,
): Promise<ClientConnectionOverrides> {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("client_connection_overrides")
    .select("service, not_applicable, note")
    .eq("monday_item_id", mondayItemId)
  if (error) {
    console.error(`[connection-overrides] read failed for ${mondayItemId}:`, error.message)
    return {}
  }
  return rowsToMap(data ?? [])
}

/**
 * Load overrides for many clients in one round-trip. Used by the batch audit
 * and the nudge cron so N clients don't fan out into N queries. Returns a map
 * keyed by monday_item_id; clients with no overrides are simply absent.
 */
export async function getConnectionOverridesBatch(
  mondayItemIds: string[],
): Promise<Record<string, ClientConnectionOverrides>> {
  const out: Record<string, ClientConnectionOverrides> = {}
  if (mondayItemIds.length === 0) return out
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("client_connection_overrides")
    .select("monday_item_id, service, not_applicable, note")
    .in("monday_item_id", mondayItemIds)
  if (error) {
    console.error(`[connection-overrides] batch read failed:`, error.message)
    return out
  }
  for (const r of data ?? []) {
    const id = r.monday_item_id as string
    if (!out[id]) out[id] = {}
    if (isConnectionService(r.service)) {
      out[id][r.service] = { notApplicable: r.not_applicable, note: r.note }
    }
  }
  return out
}

/**
 * Set (or clear) the "not applicable" flag for one service on one client.
 * Upserts on the (monday_item_id, service) primary key. Setting
 * `notApplicable = false` with no note leaves a row that reads as "explicitly
 * un-marked" — harmless, and keeps the audit trail of who touched it.
 */
export async function setConnectionOverride(
  mondayItemId: string,
  service: ConnectionService,
  notApplicable: boolean,
  note: string | null,
  setBy: string | null,
): Promise<void> {
  const supabase = await createAdminClient()
  const { error } = await supabase.from("client_connection_overrides").upsert(
    {
      monday_item_id: mondayItemId,
      service,
      not_applicable: notApplicable,
      note: note && note.trim().length > 0 ? note.trim() : null,
      set_by: setBy,
      set_at: new Date().toISOString(),
    },
    { onConflict: "monday_item_id,service" },
  )
  if (error) {
    throw new Error(`setConnectionOverride(${mondayItemId}, ${service}): ${error.message}`)
  }
}
