"use client"

import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import type { MondayTargetsByCountry, MetaTargetsByCountry, MondayTargetsData, MetaTargetsData, CountryKey, DateRange } from "@/types/targets"

function fmt(d: Date) {
  return format(d, "yyyy-MM-dd")
}

export function useTargetsData(range: DateRange, country: CountryKey = "all") {
  const startDate = fmt(range.startDate)
  const endDate = fmt(range.endDate)

  const mondayQuery = useQuery<MondayTargetsByCountry>({
    queryKey: ["targets-monday", startDate, endDate],
    queryFn: () => fetch(`/api/targets/monday?startDate=${startDate}&endDate=${endDate}`).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch Monday data")
      return r.json()
    }),
    staleTime: 5 * 60 * 1000,
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

  return {
    monday,
    meta,
    mondayLoading: mondayQuery.isLoading,
    metaLoading: metaQuery.isLoading,
    mondayError: mondayQuery.error?.message ?? null,
    metaError: metaQuery.error?.message ?? null,
    isLoading: mondayQuery.isLoading || metaQuery.isLoading,
  }
}
