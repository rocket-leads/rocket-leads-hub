import { resolveStripeCustomer } from "./stripe"
import { resolveMondayBoard } from "./monday"
import { resolveMetaAdAccount } from "./meta"
import { resolveTrengoContact } from "./trengo"
import { resolveDriveFolder } from "./google-drive"
import type { MondayClient } from "./monday"
import { readCache, writeCache } from "@/lib/cache"

/**
 * Per-service health state for one client. Drives the 6-dot statusbar on
 * the Clients tab + the audit-mode "Broken connections" filter.
 *
 *  `ok`        - ID set and resolved cleanly
 *  `broken`    - ID set but resolve returned null OR threw (transport/auth)
 *  `missing`   - ID empty AND service is required (Stripe / Meta / Trengo)
 *  `not_used`  - ID empty AND service is optional (Monday / Drive)
 *                Visually neutral, never counts as broken in the audit
 *                roll-up - Roy 2026-06-09: optional services empty means
 *                the client opted out, not a broken connection.
 *  `warning`   - Resolved but the entity has a warning status
 *                (e.g. Meta ad account "Pending risk review", non-billing)
 */
export type ServiceHealthState = "ok" | "broken" | "missing" | "not_used" | "warning"

export type ServiceHealth = {
  state: ServiceHealthState
  /** Resolved name when state is `ok`/`warning`/`broken` - for tooltip use. */
  name?: string
  /** Human-readable error reason when state is `broken`. Surfaces as the
   *  hover tooltip on the broken dot so the AM doesn't have to open the
   *  panel to know what's wrong. */
  error?: string
}

export type ClientHealth = {
  mondayItemId: string
  stripe: ServiceHealth
  meta: ServiceHealth
  monday: ServiceHealth
  trengo: ServiceHealth
  drive: ServiceHealth
  /** Aggregated `broken` count for the row badge + audit filter. Counts
   *  `broken` + `missing` (required-and-empty) - does NOT count `not_used`
   *  or `warning`. */
  brokenCount: number
}

const HEALTH_CACHE_TTL_MS = 60 * 60 * 1000
const HEALTH_CACHE_KEY = (mondayItemId: string) => `integrations_health:${mondayItemId}`

/**
 * Resolve a single ID against an external system, normalising into a
 * ServiceHealth tile. `id` empty + `required` false → `not_used`. `id`
 * empty + required → `missing`. Resolver returns null → `broken`.
 * Resolver throws → `broken` with the error message.
 *
 * Each resolver call is wrapped in its own try/catch so one slow/down
 * service doesn't take down the whole client's audit.
 */
async function resolveService(
  id: string,
  required: boolean,
  resolver: (id: string) => Promise<{ name: string; status?: "ok" | "warning" | "error" } | null>,
): Promise<ServiceHealth> {
  if (!id || id.trim().length === 0) {
    return { state: required ? "missing" : "not_used" }
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
  options: { bypassCache?: boolean } = {},
): Promise<ClientHealth> {
  if (!options.bypassCache) {
    const cached = await readCache<ClientHealth>(HEALTH_CACHE_KEY(client.mondayItemId), HEALTH_CACHE_TTL_MS)
    if (cached) return cached
  }

  const [stripe, meta, monday, trengo, drive] = await Promise.all([
    resolveService(client.stripeCustomerId, true, resolveStripeCustomer),
    resolveService(client.metaAdAccountId, true, resolveMetaAdAccount),
    resolveService(client.clientBoardId, false, resolveMondayBoard),
    resolveService(client.trengoContactId, true, resolveTrengoContact),
    resolveService(client.googleDriveId, false, resolveDriveFolder),
  ])

  // Aggregate: only `broken` and `missing` count. `warning` is informational,
  // `not_used` is intentional. Roy 2026-06-09: optional services empty must
  // never inflate the broken-count badge.
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

  async function worker() {
    while (queue.length > 0) {
      const client = queue.shift()
      if (!client) return
      try {
        out[client.mondayItemId] = await computeClientHealth(client, options)
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
