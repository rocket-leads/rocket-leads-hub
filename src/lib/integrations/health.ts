import { resolveStripeCustomer } from "./stripe"
import { resolveMondayBoard } from "./monday"
import { resolveMetaAdAccount } from "./meta"
import { resolveTrengoContact } from "./trengo"
import { resolveDriveFolder } from "./google-drive"
import type { MondayClient } from "./monday"
import { readCache, writeCache, deleteCache } from "@/lib/cache"
import {
  getConnectionOverridesBatch,
  type ClientConnectionOverrides,
  type ConnectionService,
} from "@/lib/clients/connection-overrides"

/**
 * Per-service health state for one client. Drives the 5-dot statusbar on
 * the Clients tab + the audit-mode "Broken connections" filter.
 *
 *  `ok`              - ID set and resolved cleanly
 *  `broken`          - ID set but resolve returned null OR threw (transport/auth)
 *  `missing`         - ID empty and NOT marked N/A. The "unresolved" default:
 *                      either link it or explicitly mark it not-applicable.
 *                      Roy 2026-07-30: this now fires for optional services
 *                      (Monday / Drive) too - an empty optional ID used to hide
 *                      as a calm dot, so "forgot" and "not applicable" looked
 *                      identical. Now the only way to a calm dot is an explicit
 *                      N/A mark (see `not_applicable`).
 *  `not_applicable`  - ID empty and an admin explicitly marked the service N/A
 *                      for this client (client_connection_overrides). Renders as
 *                      a struck dash (–); never counts as broken, never nudged.
 *  `warning`         - Resolved but the entity has a warning status
 *                      (e.g. Meta ad account "Pending risk review", non-billing)
 */
export type ServiceHealthState = "ok" | "broken" | "missing" | "not_applicable" | "warning"

export type ServiceHealth = {
  state: ServiceHealthState
  /** Resolved name when state is `ok`/`warning`/`broken` - for tooltip use. */
  name?: string
  /** Human-readable error reason when state is `broken`. Surfaces as the
   *  hover tooltip on the broken dot so the AM doesn't have to open the
   *  panel to know what's wrong. */
  error?: string
  /** Optional reason captured when a service is marked `not_applicable`
   *  ("client uses their own CRM"). Shown in the dot tooltip. */
  note?: string
}

export type ClientHealth = {
  mondayItemId: string
  stripe: ServiceHealth
  meta: ServiceHealth
  monday: ServiceHealth
  trengo: ServiceHealth
  drive: ServiceHealth
  /** Aggregated needs-attention count for the row badge + audit filter. Counts
   *  `broken` + `missing` - does NOT count `not_applicable` (explicit opt-out)
   *  or `warning` (cosmetic). */
  brokenCount: number
}

const HEALTH_CACHE_TTL_MS = 60 * 60 * 1000
const HEALTH_CACHE_KEY = (mondayItemId: string) => `integrations_health:${mondayItemId}`

/**
 * Drop the cached health snapshot for one client so the next audit recomputes.
 * Call after anything that changes a client's connection verdict without going
 * through the 1h TTL - e.g. toggling an N/A override.
 */
export async function invalidateClientHealth(mondayItemId: string): Promise<void> {
  await deleteCache(HEALTH_CACHE_KEY(mondayItemId))
}

/**
 * Resolve a single ID against an external system, normalising into a
 * ServiceHealth tile.
 *
 *   id empty + marked N/A       → `not_applicable` (struck dash, calm)
 *   id empty + NOT marked N/A   → `missing` (link it or mark N/A)
 *   resolver returns null       → `broken`
 *   resolver throws             → `broken` with the error message
 *
 * The required/optional distinction no longer changes the empty-state colour -
 * intent is now explicit via the N/A override, not inferred. An empty optional
 * service (Monday / Drive) is `missing` until an admin either links it or marks
 * it not-applicable. That's the whole point: it surfaces the "AM forgot" case
 * that used to hide.
 *
 * Each resolver call is wrapped in its own try/catch so one slow/down
 * service doesn't take down the whole client's audit.
 */
async function resolveService(
  id: string,
  override: ClientConnectionOverrides[ConnectionService] | undefined,
  resolver: (id: string) => Promise<{ name: string; status?: "ok" | "warning" | "error" } | null>,
): Promise<ServiceHealth> {
  if (!id || id.trim().length === 0) {
    if (override?.notApplicable) {
      return { state: "not_applicable", note: override.note ?? undefined }
    }
    return { state: "missing" }
  }
  try {
    const entity = await resolver(id)
    if (!entity) return { state: "broken", error: "Not found" }
    // Resolver-side status - Meta uses this for Disabled accounts, Drive for
    // trashed folders. Either way: the link works, but the entity itself is
    // in a bad state and silently breaks downstream features.
    if (entity.status === "error") return { state: "broken", name: entity.name, error: "Entity in error state" }
    if (entity.status === "warning") return { state: "warning", name: entity.name }
    return { state: "ok", name: entity.name }
  } catch (e) {
    // Service is down or auth broke. We can't distinguish "broken link" from
    // "API hiccup" without more state - surface as broken with the error so
    // the AM has a hint, but the audit roll-up should be re-fetched later.
    return { state: "broken", error: e instanceof Error ? e.message : "Verify failed" }
  }
}

/**
 * Compute the per-service health snapshot for one client. Runs all 5
 * resolves in parallel. ~500ms-2s total depending on how many services
 * are linked + how slow the slowest API is (typically Meta or Monday).
 *
 * Results are cached for 1 hour in `cache_store` so the Clients tab opens
 * fast on subsequent visits - the audit-modus is for "find broken links
 * across all clients", not "real-time monitoring". A manual Refresh
 * button bypasses the cache.
 */
export async function computeClientHealth(
  client: MondayClient,
  options: { bypassCache?: boolean; overrides?: ClientConnectionOverrides } = {},
): Promise<ClientHealth> {
  if (!options.bypassCache) {
    const cached = await readCache<ClientHealth>(HEALTH_CACHE_KEY(client.mondayItemId), HEALTH_CACHE_TTL_MS)
    if (cached) return cached
  }

  // Overrides drive the empty-state colour (missing vs not_applicable). When the
  // caller didn't preload them (single-client path), fetch for this one client.
  const overrides =
    options.overrides ?? (await getConnectionOverridesBatch([client.mondayItemId]))[client.mondayItemId] ?? {}

  const [stripe, meta, monday, trengo, drive] = await Promise.all([
    resolveService(client.stripeCustomerId, overrides.stripe, resolveStripeCustomer),
    resolveService(client.metaAdAccountId, overrides.meta, resolveMetaAdAccount),
    resolveService(client.clientBoardId, overrides.monday, resolveMondayBoard),
    resolveService(client.trengoContactId, overrides.trengo, resolveTrengoContact),
    resolveService(client.googleDriveId, overrides.drive, resolveDriveFolder),
  ])

  // Aggregate: only `broken` and `missing` count. `warning` is informational,
  // `not_applicable` is an explicit opt-out. Neither inflates the badge.
  const services = [stripe, meta, monday, trengo, drive]
  const brokenCount = services.filter(
    (s) => s.state === "broken" || s.state === "missing",
  ).length

  const health: ClientHealth = {
    mondayItemId: client.mondayItemId,
    stripe,
    meta,
    monday,
    trengo,
    drive,
    brokenCount,
  }

  // Best-effort cache write - a Supabase blip here just means the next
  // load takes the slow path again. Never block the response.
  void writeCache(HEALTH_CACHE_KEY(client.mondayItemId), health).catch((e) => {
    console.error(
      `[health] cache write failed for ${client.mondayItemId}:`,
      e instanceof Error ? e.message : e,
    )
  })

  return health
}

/**
 * Batch the per-client health computation across N clients with a fixed
 * concurrency cap so we don't hammer any one external API. Per-client
 * failures are caught - a missing client gets a synthetic "all broken"
 * row rather than failing the whole batch, so the UI can still render
 * the 99 working ones.
 */
export async function computeBatchClientHealth(
  clients: MondayClient[],
  options: { bypassCache?: boolean; concurrency?: number } = {},
): Promise<Record<string, ClientHealth>> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 6, 10))
  const out: Record<string, ClientHealth> = {}
  const queue = [...clients]

  // One round-trip for every client's overrides, rather than one per client
  // inside computeClientHealth. Passed down so the workers don't re-query.
  const overridesByClient = await getConnectionOverridesBatch(clients.map((c) => c.mondayItemId))

  async function worker() {
    while (queue.length > 0) {
      const client = queue.shift()
      if (!client) return
      try {
        out[client.mondayItemId] = await computeClientHealth(client, {
          ...options,
          overrides: overridesByClient[client.mondayItemId] ?? {},
        })
      } catch (e) {
        console.error(
          `[health] failed to compute health for ${client.mondayItemId}:`,
          e instanceof Error ? e.message : e,
        )
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return out
}
