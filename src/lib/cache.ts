import { createAdminClient } from "@/lib/supabase/server"

const DEFAULT_CACHED_FETCH_TTL_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Read from cache. By default returns data regardless of age — used for
 * cron-managed caches (monday_boards, kpi_summaries, etc.) where the cron
 * keeps data fresh and we never want to block on live API calls.
 *
 * Pass `ttlMs` to enforce a max age; entries older than that return null.
 */
export async function readCache<T>(key: string, ttlMs?: number): Promise<T | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("cache_store")
    .select("data, updated_at")
    .eq("key", key)
    .single()

  if (!data) return null
  if (ttlMs !== undefined && data.updated_at) {
    const age = Date.now() - new Date(data.updated_at).getTime()
    if (age > ttlMs) return null
  }
  return data.data as T
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  const supabase = await createAdminClient()
  await supabase
    .from("cache_store")
    .upsert({ key, data: value, updated_at: new Date().toISOString() }, { onConflict: "key" })
}

/**
 * Read cache first, fall back to live fetch when missing or older than ttlMs.
 * Cache writes are fire-and-forget. If the fetcher throws, the error
 * propagates and nothing is cached — callers should handle errors *outside*
 * cachedFetch so a transient failure never poisons the cache with an empty
 * result.
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_CACHED_FETCH_TTL_MS,
): Promise<T> {
  const cached = await readCache<T>(key, ttlMs)
  if (cached !== null) return cached

  const fresh = await fetcher()
  void writeCache(key, fresh)
  return fresh
}
