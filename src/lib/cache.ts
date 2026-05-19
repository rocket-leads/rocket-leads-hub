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
  const { error } = await supabase
    .from("cache_store")
    .upsert({ key, data: value, updated_at: new Date().toISOString() }, { onConflict: "key" })
  if (error) {
    // Was previously swallowed — that's how kpi_daily silently disappeared from
    // cache_store while the rest of the cron's writes succeeded, leaving
    // /clients to live-fetch Meta + Monday on every page load.
    console.error(`[writeCache] failed to write "${key}":`, error.message)
    throw new Error(`writeCache(${key}): ${error.message}`)
  }
}

/**
 * Bulk variant — one Supabase round-trip for many keys. Used by the cron to
 * write per-client cache entries (`kpi_daily:<id>`, `client_top_ads:<id>`,
 * etc.) without paying one HTTP per client. Same conflict policy as the
 * single-key writer.
 *
 * `now` defaults to the call moment so all entries written by one batch share
 * an updated_at timestamp — makes "how stale is the per-client cache?" simple
 * to reason about (read any entry, they're all the same age).
 */
export async function writeCacheBatch(
  entries: Array<{ key: string; value: unknown }>,
  now: string = new Date().toISOString(),
): Promise<void> {
  if (entries.length === 0) return
  const supabase = await createAdminClient()
  const rows = entries.map((e) => ({ key: e.key, data: e.value, updated_at: now }))
  const { error } = await supabase.from("cache_store").upsert(rows, { onConflict: "key" })
  if (error) {
    console.error(`[writeCacheBatch] failed to write ${entries.length} keys:`, error.message)
    throw new Error(`writeCacheBatch(${entries.length}): ${error.message}`)
  }
}

/**
 * Drop a single cache entry. Fire-and-forget by callers in most cases; the
 * primary use is bursting a cached read after a write so the next read sees
 * the fresh value (e.g. after PATCHing a Monday item we kill the matching
 * `monday_client_item:*` entry).
 */
export async function deleteCache(key: string): Promise<void> {
  const supabase = await createAdminClient()
  const { error } = await supabase.from("cache_store").delete().eq("key", key)
  if (error) console.error(`[deleteCache] failed to delete "${key}":`, error.message)
}

/**
 * Read cache first, fall back to live fetch when missing or older than ttlMs.
 * Cache writes are fire-and-forget. If the fetcher throws, the error
 * propagates and nothing is cached — callers should handle errors *outside*
 * cachedFetch so a transient failure never poisons the cache with an empty
 * result.
 *
 * Pass `bypass: true` to skip the read and force a live fetch + cache rewrite.
 * Used by the page-level Refresh button so users have an escape hatch when
 * the 10-minute cache is hiding a Monday/Meta change they just made.
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_CACHED_FETCH_TTL_MS,
  options: { bypass?: boolean } = {},
): Promise<T> {
  if (!options.bypass) {
    const cached = await readCache<T>(key, ttlMs)
    if (cached !== null) return cached
  }

  const fresh = await fetcher()
  void writeCache(key, fresh)
  return fresh
}

/** True when (year, month) is strictly before the current calendar month. */
export function isPastCalendarMonth(year: number, month: number): boolean {
  const now = new Date()
  const curYear = now.getFullYear()
  const curMonth = now.getMonth() + 1
  return year < curYear || (year === curYear && month < curMonth)
}

/**
 * If the date range covers exactly one full calendar month (day 1 → last day of that month),
 * returns its {year, month}. Otherwise null. Used to decide whether the request maps
 * cleanly to a single historical-month cache entry.
 */
export function getRangeCalendarMonth(startDate: string, endDate: string): { year: number; month: number } | null {
  const startMatch = startDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const endMatch = endDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!startMatch || !endMatch) return null

  const startYear = parseInt(startMatch[1], 10)
  const startMonth = parseInt(startMatch[2], 10)
  const startDay = parseInt(startMatch[3], 10)
  const endYear = parseInt(endMatch[1], 10)
  const endMonth = parseInt(endMatch[2], 10)
  const endDay = parseInt(endMatch[3], 10)

  if (startYear !== endYear || startMonth !== endMonth) return null
  if (startDay !== 1) return null
  const lastDay = new Date(startYear, startMonth, 0).getDate()
  if (endDay !== lastDay) return null

  return { year: startYear, month: startMonth }
}

/**
 * Read-through cache for *historical* (closed) calendar months. The data for
 * a past month is treated as immutable, so we cache it forever under the key
 * `<baseKey>:YYYY-MM`. Pass `forceRefresh: true` to bypass the cache and
 * rewrite it (e.g. when someone backfills a past month in the source sheet).
 *
 * Pass a `validate` predicate to detect stale schema — when an entry was
 * cached with an older shape (missing newly-added fields). Returning false
 * treats the entry as a cache miss and triggers a fresh fetch + write.
 */
export async function cachedHistoricalMonth<T>(
  baseKey: string,
  year: number,
  month: number,
  fetcher: () => Promise<T>,
  options: { forceRefresh?: boolean; validate?: (cached: T) => boolean } = {},
): Promise<T> {
  const key = `${baseKey}:${year}-${String(month).padStart(2, "0")}`
  if (!options.forceRefresh) {
    const cached = await readCache<T>(key)
    if (cached !== null && (options.validate ? options.validate(cached) : true)) {
      return cached
    }
  }
  const fresh = await fetcher()
  void writeCache(key, fresh)
  return fresh
}
