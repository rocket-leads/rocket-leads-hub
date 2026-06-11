import { createClient as createSupabaseClient } from "@supabase/supabase-js"

/**
 * Server-side cache-invalidation broadcaster. Pairs with the client-side
 * `useRealtimeInvalidation` hook so crons + webhooks can tell open
 * browser tabs "hey, this query is now stale, refetch" without polling.
 *
 * Why broadcast over row-level Realtime:
 *   - The Hub uses NextAuth, not Supabase Auth. We can't easily pipe a
 *     Supabase JWT into the browser client, so listening to row-changes
 *     under RLS is fiddly.
 *   - Broadcast channels are auth-free + lightweight: the server picks
 *     the message, the client just invalidates the matching React Query
 *     key. Decouples "data changed" from "what changed exactly".
 *
 * Usage (server):
 *   import { broadcastInvalidate } from "@/lib/realtime/broadcast"
 *   await broadcastInvalidate(["kpi-summaries"])
 *
 * Usage (client):
 *   useRealtimeInvalidation()  // mount once at the root of the app
 *
 * Channel name is intentionally a constant - one channel for everything,
 * filtered client-side by queryKey. Cheaper than a channel per table and
 * easier to scope-creep into.
 */
export const HUB_CHANNEL = "hub:invalidate"

let broadcaster: ReturnType<typeof createSupabaseClient> | null = null

function getBroadcaster() {
  if (broadcaster) return broadcaster
  // Use anon key for broadcasts - they're public-ish (any open Hub tab
  // can listen) and the payload is just a queryKey, no secrets.
  broadcaster = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      realtime: { params: { eventsPerSecond: 10 } },
    },
  )
  return broadcaster
}

/**
 * Broadcast a React Query invalidation to every open Hub tab. `queryKey`
 * matches the same array shape you pass to `useQuery({ queryKey: [...] })`.
 * Safe to call from cron routes, webhook receivers, server actions -
 * anywhere that mutates data the UI is showing.
 *
 * Failures are swallowed (and logged) so a broken broadcaster never takes
 * down the underlying write path. Realtime is best-effort by design.
 */
export async function broadcastInvalidate(
  queryKey: ReadonlyArray<unknown>,
): Promise<void> {
  try {
    const ch = getBroadcaster().channel(HUB_CHANNEL)
    await ch.send({ type: "broadcast", event: "invalidate", payload: { queryKey } })
  } catch (e) {
    console.error("[broadcastInvalidate] failed:", e instanceof Error ? e.message : e)
  }
}
