import {
  createOnboardingItem,
  fetchClientById,
  clientItemCacheKey,
  type NewOnboardingClientInput,
  type MondayClient,
} from "@/lib/integrations/monday"
import { syncClientToSupabase } from "./sync"
import { readCache, writeCache } from "@/lib/cache"

/**
 * Create a new onboarding client from the Hub. Writes the Monday row, then
 * wires the new client into the same caches the read paths use so it shows
 * up on the overview and opens cleanly in the wizard without waiting for the
 * webhook or the daily cron:
 *
 *   1. `create_item` on the Onboarding board → new Monday item ID
 *   2. Fresh `fetchClientById` snapshot (cache-bypassed)
 *   3. Append to the `monday_boards` overview cache + seed the per-item cache
 *   4. Fire-and-forget Supabase mirror (also seeds the agreement row)
 *
 * Mirrors the cache-patch philosophy of `updateClientField`: patch with what
 * we know we just wrote, then let the Monday webhook reconcile a moment later.
 */
export async function createOnboardingClient(
  input: NewOnboardingClientInput,
): Promise<{ mondayItemId: string }> {
  const name = input.name.trim()
  if (!name) throw new Error("Client name is required.")

  const mondayItemId = await createOnboardingItem({ ...input, name })

  // Pull the canonical snapshot back from Monday so the cached row carries
  // resolved person-column names etc. (the create call only had IDs). A
  // failed fetch isn't fatal - the webhook + cron will populate the row
  // shortly; we just lose the instant-appearance optimization.
  const client = await fetchClientById(mondayItemId, { bypassCache: true }).catch(() => null)
  if (client) {
    await appendToBoardsCache(client)
    try {
      await writeCache(clientItemCacheKey(mondayItemId), client)
    } catch {
      // Per-item cache miss is fine - the wizard's first fetch re-populates it.
    }
    void syncClientToSupabase(client).catch((e) => {
      console.error(
        "[create] supabase mirror failed:",
        mondayItemId,
        e instanceof Error ? e.message : e,
      )
    })
  }

  return { mondayItemId }
}

/**
 * Append a freshly created client to the `monday_boards` onboarding list so
 * the next overview render includes it. No-op when the cache isn't warm yet
 * (the page falls back to a live `fetchBothBoards`) or when the row is
 * already present (idempotent against a racing webhook insert).
 */
async function appendToBoardsCache(client: MondayClient): Promise<void> {
  try {
    const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
      "monday_boards",
    )
    if (!cached) return
    if (cached.onboarding.some((c) => c.mondayItemId === client.mondayItemId)) return
    await writeCache("monday_boards", {
      onboarding: [...cached.onboarding, client],
      current: cached.current,
    })
  } catch (e) {
    console.error("monday_boards append failed:", e instanceof Error ? e.message : e)
  }
}
