import { createAdminClient } from "@/lib/supabase/server"

/**
 * Read from cache. Always returns data if it exists — no TTL expiry.
 * The cron job keeps data fresh; we never block the user waiting for live API calls.
 */
export async function readCache<T>(key: string): Promise<T | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("cache_store")
    .select("data, updated_at")
    .eq("key", key)
    .single()

  if (!data) return null
  return data.data as T
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  const supabase = await createAdminClient()
  await supabase
    .from("cache_store")
    .upsert({ key, data: value, updated_at: new Date().toISOString() }, { onConflict: "key" })
}

/**
 * Write-through cache: returns cached data if fresh, otherwise calls fetcher,
 * caches the result, and returns it. Cache writes are fire-and-forget.
 */
/**
 * Read cache first, fall back to live fetch only if no cache exists.
 * Cache writes are fire-and-forget.
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = await readCache<T>(key)
  if (cached !== null) return cached

  const fresh = await fetcher()
  void writeCache(key, fresh)
  return fresh
}
