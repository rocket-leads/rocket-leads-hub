import { createAdminClient } from "@/lib/supabase/server"

const DEFAULT_MAX_AGE_MS = 35 * 60 * 1000 // 35 minutes — slightly longer than the 30-min cron interval

export async function readCache<T>(key: string, maxAgeMs = DEFAULT_MAX_AGE_MS): Promise<T | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("cache_store")
    .select("data, updated_at")
    .eq("key", key)
    .single()

  if (!data) return null

  const age = Date.now() - new Date(data.updated_at).getTime()
  if (age > maxAgeMs) return null

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
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): Promise<T> {
  const cached = await readCache<T>(key, maxAgeMs)
  if (cached !== null) return cached

  const fresh = await fetcher()
  // Fire-and-forget — don't slow down the response
  void writeCache(key, fresh)
  return fresh
}
