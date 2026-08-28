import { format, subDays, startOfMonth, subMonths } from "date-fns"
import { readCache, writeCache } from "@/lib/cache"
import { fetchMondayTargets, getMtdRange } from "@/lib/targets/fetchers"

/**
 * Real-time top-up for the Targets Monday caches.
 *
 * The Targets board is huge - a cold scrape runs ~3 minutes - which is why the
 * dashboard is served from cron-warmed caches rather than fetched live. That
 * makes naive webhook invalidation dangerous: deleting `targets_marketing_monday`
 * would drop the next viewer into a 3-minute cold recompute. So instead of
 * deleting, a Monday status/date/deal change on the targets board schedules THIS
 * re-warm out-of-band (via `after()` in the webhook), which recomputes MTD + the
 * rolling presets and overwrites the caches in place. Viewers always read a warm
 * cache; it's just fresher.
 *
 * Two guards keep the ~3-minute scrape from stampeding when many rows change in
 * quick succession (a setter bulk-updating statuses, a Zapier import):
 *  - a cache-based debounce lock (`targets_rewarm_lock`) so at most one re-warm
 *    runs per window regardless of how many events fire;
 *  - the in-process board-items cache inside fetchMondayTargets, which paginates
 *    the board once and re-aggregates each preset from memory.
 *
 * Freshness floor is therefore ~one scrape (a couple of minutes) after a change,
 * not seconds - true sub-second real-time would need surgical patching of the
 * cached aggregates (a bigger project). This closes the gap from "up to 30 min
 * stale" (cron interval) to "fresh within a scrape of the change".
 */
const REWARM_LOCK_KEY = "targets_rewarm_lock"
// Debounce window. Slightly longer than a typical cold scrape so overlapping
// re-warms don't stack under a burst of edits. The 30-min cron is the backstop.
const REWARM_DEBOUNCE_MS = 2 * 60 * 1000

/** Mirror use-date-range.ts / refresh-targets cron exactly so the keys line up
 *  with what the client requests and what the cron warms. All end at yesterday. */
function presetRanges(now: Date): Array<{ start: string; end: string }> {
  const fmt = (d: Date) => format(d, "yyyy-MM-dd")
  const yesterday = fmt(subDays(now, 1))
  return [
    { start: fmt(subDays(now, 7)), end: yesterday },
    { start: fmt(subDays(now, 14)), end: yesterday },
    { start: fmt(subDays(now, 30)), end: yesterday },
    { start: fmt(startOfMonth(subMonths(now, 2))), end: yesterday },
  ]
}

export async function rewarmTargetsMondayCaches(): Promise<"rewarmed" | "debounced" | "failed"> {
  // Debounce: if a re-warm ran within the window, skip. readCache(key, ttl)
  // returns the value only when it's younger than ttl, so a stale lock reads as
  // null and lets the next change through.
  const recent = await readCache<{ at: number }>(REWARM_LOCK_KEY, REWARM_DEBOUNCE_MS)
  if (recent) return "debounced"
  await writeCache(REWARM_LOCK_KEY, { at: Date.now() })

  try {
    const mtd = getMtdRange()
    const now = new Date()
    // MTD first (the most-viewed range) so its cache is fresh ASAP; the presets
    // then re-aggregate from the same in-process board items fetchMondayTargets
    // cached on the MTD call - no second scrape.
    const mtdResult = await fetchMondayTargets(mtd.startDate, mtd.endDate)
    await writeCache("targets_marketing_monday", mtdResult)

    for (const r of presetRanges(now)) {
      try {
        const res = await fetchMondayTargets(r.start, r.end)
        await writeCache(`targets_monday:${r.start}:${r.end}`, res)
      } catch (e) {
        console.error(`[targets-rewarm] preset ${r.start}:${r.end} failed:`, e)
      }
    }
    return "rewarmed"
  } catch (e) {
    console.error("[targets-rewarm] failed:", e)
    return "failed"
  }
}
