"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { format, startOfMonth } from "date-fns"
import type {
  MondayTargetsByCountry, MetaTargetsByCountry, MondayTargetsData, MetaTargetsData,
  CountryKey, PlatformKey, GoogleAdsSpend, DateRange,
} from "@/types/targets"

function fmt(d: Date) {
  return format(d, "yyyy-MM-dd")
}

/** MTD range (1st of current month → today) - the cron pre-warms this exact
 *  window so it's effectively free to fetch. Used as placeholderData for the
 *  user's selected range, so the page never sits empty while the slow cold
 *  fetch (~2-3min) runs in the background. */
function getMtdRange(): { startDate: string; endDate: string } {
  const now = new Date()
  return { startDate: fmt(startOfMonth(now)), endDate: fmt(now) }
}

const EMPTY_META: MetaTargetsData = { spend: 0, impressions: 0, clicks: 0, cpc: 0, cpm: 0, ctr: 0 }

export function useTargetsData(
  range: DateRange,
  country: CountryKey = "all",
  closer: string | null = null,
  platform: PlatformKey = "all",
) {
  const queryClient = useQueryClient()
  const startDate = fmt(range.startDate)
  const endDate = fmt(range.endDate)
  // Normalise: empty / "All" → no filter. Keeps the cache key stable for the default view.
  const closerKey = closer && closer !== "All" ? closer : null
  const platformKey = platform !== "all" ? platform : null
  const filtered = !!closerKey || !!platformKey

  const mtd = getMtdRange()
  const isOnMtd = !filtered && startDate === mtd.startDate && endDate === mtd.endDate

  // Always-on MTD query - fires in parallel with the selected-range query so
  // the placeholderData below has something to fall back on. When the user is
  // already on MTD, both queries share the same key and dedupe to one fetch.
  const mtdMondayQuery = useQuery<MondayTargetsByCountry>({
    queryKey: ["targets-monday", mtd.startDate, mtd.endDate, "all", "all"],
    queryFn: () =>
      fetch(`/api/targets/monday?startDate=${mtd.startDate}&endDate=${mtd.endDate}`, { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("Failed to fetch Monday data (MTD)")
        return r.json()
      }),
    staleTime: 5 * 60 * 1000,
  })

  const mondayQuery = useQuery<MondayTargetsByCountry>({
    queryKey: ["targets-monday", startDate, endDate, closerKey ?? "all", platformKey ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (closerKey) params.set("closer", closerKey)
      if (platformKey) params.set("platform", platformKey)
      // `no-store` defeats any browser/HTTP cache layer that might otherwise
      // collapse `?closer=X`/`?platform=Y` variants onto the same response.
      // React Query still owns logical caching via queryKey above.
      return fetch(`/api/targets/monday?${params.toString()}`, { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("Failed to fetch Monday data")
        return r.json()
      })
    },
    staleTime: 5 * 60 * 1000,
    // Fall back to the warm MTD data while the selected range fetches. Skipped
    // when the user IS on MTD (placeholder == real) or when any filter is active
    // (an unfiltered MTD slice would be misleading as a placeholder for a scoped view).
    placeholderData: () => {
      if (isOnMtd || filtered) return undefined
      return queryClient.getQueryData<MondayTargetsByCountry>([
        "targets-monday",
        mtd.startDate,
        mtd.endDate,
        "all",
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

  // Google Ads spend (from the Actual sheet) - country-agnostic single total.
  const googleAdsQuery = useQuery<GoogleAdsSpend>({
    queryKey: ["targets-google-ads", startDate, endDate],
    queryFn: () => fetch(`/api/targets/google-ads?startDate=${startDate}&endDate=${endDate}`).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch Google Ads spend")
      return r.json()
    }),
    staleTime: 5 * 60 * 1000,
  })

  // Pick the right country slice (no re-fetch needed). Monday is already
  // platform-filtered server-side via the query param above.
  const monday: MondayTargetsData | null = mondayQuery.data?.[country] ?? null
  const metaCountry: MetaTargetsData | null = metaQuery.data?.[country] ?? null

  // ── Blended ad spend across platforms ──────────────────────────────────────
  // Meta spend is per-country (campaign-name heuristic). Google spend has no
  // country attribution (single sheet total), so it only counts on the "all"
  // country view. The dashboard reads everything off `meta.spend`, so we fold
  // the platform + country rules into that one figure and every cost metric
  // (CBC/CTC/CPD, ROAS, the hero) follows automatically.
  const metaSpend = metaCountry?.spend ?? 0
  const googleSpend = googleAdsQuery.data?.spend ?? 0
  const googleCounts = country === "all" ? googleSpend : 0
  let effectiveSpend: number
  if (platform === "google") effectiveSpend = googleCounts
  else if (platform === "meta") effectiveSpend = metaSpend
  else effectiveSpend = metaSpend + googleCounts

  // Impressions/clicks/CTR are Meta-only; blank them under a Google-only view so
  // they don't misrepresent Google (the Marketing tab keys off spend regardless).
  const metaBase = platform === "google" ? EMPTY_META : (metaCountry ?? EMPTY_META)
  const meta: MetaTargetsData | null =
    metaCountry || googleSpend > 0 || platform === "google"
      ? { ...metaBase, spend: effectiveSpend }
      : null

  // Google spend exists but is hidden because a single-country filter is active
  // (Google has no country attribution) - surface a note in the UI.
  const googleExcludedForCountry = platform !== "meta" && country !== "all" && googleSpend > 0

  // `isPlaceholderData` is true when the tiles are showing MTD instead of the
  // real selected range. UI uses this to tag tiles with a small "MTD" pill.
  const mondayShowingMtdFallback = mondayQuery.isPlaceholderData

  return {
    monday,
    meta,
    mondayLoading: mondayQuery.isLoading,
    metaLoading: metaQuery.isLoading || googleAdsQuery.isLoading,
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
    // Platform / spend-source signals for the UI.
    metaSpend,
    googleSpend,
    /** Sheet read failed (e.g. not yet shared with the service account). */
    googleAdsError: googleAdsQuery.data?.error ?? null,
    /** Google spend is being withheld because a single-country filter is active. */
    googleExcludedForCountry,
  }
}
