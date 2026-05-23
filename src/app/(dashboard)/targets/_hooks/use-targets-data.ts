"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { format, startOfMonth } from "date-fns"
import type { MondayTargetsByCountry, MetaTargetsByCountry, MondayTargetsData, MetaTargetsData, CountryKey, DateRange } from "@/types/targets"

function fmt(d: Date) {
  return format(d, "yyyy-MM-dd")
}

/** MTD range (1st of current month → today) — the cron pre-warms this exact
 *  window so it's effectively free to fetch. Used as placeholderData for the
 *  user's selected range, so the page never sits empty while the slow cold
 *  fetch (~2-3min) runs in the background. */
function getMtdRange(): { startDate: string; endDate: string } {
  const now = new Date()
  return { startDate: fmt(startOfMonth(now)), endDate: fmt(now) }
}

export function useTargetsData(
  range: DateRange,
  country: CountryKey = "all",
  closer: string | null = null,
) {
  const queryClient = useQueryClient()
  const startDate = fmt(range.startDate)
  const endDate = fmt(range.endDate)
  // Normalise: empty / "All" → no filter. Keeps the cache key stable for the default view.
  const closerKey = closer && closer !== "All" ? closer : null

  const mtd = getMtdRange()
  const isOnMtd = !closerKey && startDate === mtd.startDate && endDate === mtd.endDate

  // Always-on MTD query — fires in parallel with the selected-range query so
  // the placeholderData below has something to fall back on. When the user is
  // already on MTD, both queries share the same key and dedupe to one fetch.
  const mtdMondayQuery = useQuery<MondayTargetsByCountry>({
    queryKey: ["targets-monday", mtd.startDate, mtd.endDate, "all"],
    queryFn: () =>
      fetch(`/api/targets/monday?startDate=${mtd.startDate}&endDate=${mtd.endDate}`, { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("Failed to fetch Monday data (MTD)")
        return r.json()
      }),
    staleTime: 5 * 60 * 1000,
  })

  const mondayQuery = useQuery<MondayTargetsByCountry>({
    queryKey: ["targets-monday", startDate, endDate, closerKey ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (closerKey) params.set("closer", closerKey)
      // `no-store` defeats any browser/HTTP cache layer that might otherwise
      // collapse `?closer=X` and `?closer=Y` onto the same response — the
      // earlier symptom (data not changing on closer pick) pointed at exactly
      // that. React Query still owns logical caching via queryKey above.
      return fetch(`/api/targets/monday?${params.toString()}`, { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("Failed to fetch Monday data")
        return r.json()
      })
    },
    staleTime: 5 * 60 * 1000,
    // Fall back to the warm MTD data while the selected range fetches. The
    // cold path on /api/targets/monday is ~2-3min for non-MTD ranges; without
    // this, the user stares at skeletons that long. With it: the tiles render
    // MTD numbers instantly (with a "MTD" pill in the UI), then swap to the
    // real numbers as soon as the requested range finishes.
    //
    // Skipped when the user IS on MTD (placeholder == real, so no point) or
    // when a closer filter is active (MTD without closer filter would be
    // misleading as a placeholder for "Anel only").
    placeholderData: () => {
      if (isOnMtd || closerKey) return undefined
      return queryClient.getQueryData<MondayTargetsByCountry>([
        "targets-monday",
        mtd.startDate,
        mtd.endDate,
        "all",
      ])
    },
  })

  const metaQuery = useQuery<MetaTargetsByCountry>({
    queryKey: ["targets-meta", startDate, endDate],
    queryFn: () => fetch(`/api/targets/meta?startDate=${startDate}&endDate=${endDate}`).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch Meta data")
      return r.json()
    }),
    staleTime: 5 * 60 * 1000,
  })

  // Pick the right country slice (no re-fetch needed)
  const monday: MondayTargetsData | null = mondayQuery.data?.[country] ?? null
  const meta: MetaTargetsData | null = metaQuery.data?.[country] ?? null

  // `isPlaceholderData` is true when the tiles are showing MTD instead of the
  // real selected range. UI uses this to tag tiles with a small "MTD" pill so
  // the user can tell the numbers aren't yet authoritative.
  const mondayShowingMtdFallback = mondayQuery.isPlaceholderData

  return {
    monday,
    meta,
    mondayLoading: mondayQuery.isLoading,
    metaLoading: metaQuery.isLoading,
    mondayError: mondayQuery.error?.message ?? null,
    metaError: metaQuery.error?.message ?? null,
    isLoading: mondayQuery.isLoading || metaQuery.isLoading,
    /** True while the Monday tiles are showing MTD-range data as a placeholder
     *  for the user's actual selected range (still loading in background). */
    mondayShowingMtdFallback,
    // Also expose the MTD slice itself so a banner / reference line can use it
    // without re-deriving from the query cache.
    mondayMtd: (mtdMondayQuery.data?.[country] ?? null) as MondayTargetsData | null,
    mtdLoading: mtdMondayQuery.isLoading,
  }
}
