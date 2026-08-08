"use client"

import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { format } from "date-fns"
import type {
  MondayTargetsByCountry, MetaTargetsByCountry, MondayTargetsData, MetaTargetsData,
  CountryKey, PlatformKey, GoogleAdsSpend, DateRange,
} from "@/types/targets"

function fmt(d: Date) {
  return format(d, "yyyy-MM-dd")
}

const EMPTY_META: MetaTargetsData = { spend: 0, impressions: 0, clicks: 0, cpc: 0, cpm: 0, ctr: 0 }

export function useTargetsData(
  range: DateRange,
  country: CountryKey = "all",
  closer: string | null = null,
  platform: PlatformKey = "all",
) {
  const startDate = fmt(range.startDate)
  const endDate = fmt(range.endDate)
  // Normalise: empty / "All" → no filter. Keeps the cache key stable for the default view.
  const closerKey = closer && closer !== "All" ? closer : null
  const platformKey = platform !== "all" ? platform : null
  const filtered = !!closerKey || !!platformKey

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
    staleTime: 30 * 60 * 1000,
    // Keep the previous range's data on screen while the new range loads, so a
    // date switch updates in place instead of flashing skeletons.
    placeholderData: keepPreviousData,
  })

  const metaQuery = useQuery<MetaTargetsByCountry>({
    queryKey: ["targets-meta", startDate, endDate],
    queryFn: () => fetch(`/api/targets/meta?startDate=${startDate}&endDate=${endDate}`).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch Meta data")
      return r.json()
    }),
    staleTime: 30 * 60 * 1000,
    // Keep the previous range's data on screen while the new range loads, so a
    // date switch updates in place instead of flashing skeletons.
    placeholderData: keepPreviousData,
  })

  // Google Ads spend (from the Actual sheet) - country-agnostic single total.
  const googleAdsQuery = useQuery<GoogleAdsSpend>({
    queryKey: ["targets-google-ads", startDate, endDate],
    queryFn: () => fetch(`/api/targets/google-ads?startDate=${startDate}&endDate=${endDate}`).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch Google Ads spend")
      return r.json()
    }),
    staleTime: 30 * 60 * 1000,
    // Keep the previous range's data on screen while the new range loads, so a
    // date switch updates in place instead of flashing skeletons.
    placeholderData: keepPreviousData,
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

  return {
    monday,
    meta,
    mondayLoading: mondayQuery.isLoading,
    metaLoading: metaQuery.isLoading || googleAdsQuery.isLoading,
    mondayError: mondayQuery.error?.message ?? null,
    metaError: metaQuery.error?.message ?? null,
    isLoading: mondayQuery.isLoading || metaQuery.isLoading,
    // Platform / spend-source signals for the UI.
    metaSpend,
    googleSpend,
    /** Sheet read failed (e.g. not yet shared with the service account). */
    googleAdsError: googleAdsQuery.data?.error ?? null,
    /** Google spend is being withheld because a single-country filter is active. */
    googleExcludedForCountry,
  }
}
