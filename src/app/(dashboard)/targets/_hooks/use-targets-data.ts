"use client"

import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import type { MondayTargetsData, MetaTargetsData, DateRange } from "@/types/targets"

function fmt(d: Date) {
  return format(d, "yyyy-MM-dd")
}

export function useTargetsData(range: DateRange) {
  const startDate = fmt(range.startDate)
  const endDate = fmt(range.endDate)

  const mondayQuery = useQuery<MondayTargetsData>({
    queryKey: ["targets-monday", startDate, endDate],
    queryFn: () => fetch(`/api/targets/monday?startDate=${startDate}&endDate=${endDate}`).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch Monday data")
      return r.json()
    }),
    staleTime: 5 * 60 * 1000,
  })

  const metaQuery = useQuery<MetaTargetsData>({
    queryKey: ["targets-meta", startDate, endDate],
    queryFn: () => fetch(`/api/targets/meta?startDate=${startDate}&endDate=${endDate}`).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch Meta data")
      return r.json()
    }),
    staleTime: 5 * 60 * 1000,
  })

  return {
    monday: mondayQuery.data ?? null,
    meta: metaQuery.data ?? null,
    mondayLoading: mondayQuery.isLoading,
    metaLoading: metaQuery.isLoading,
    mondayError: mondayQuery.error?.message ?? null,
    metaError: metaQuery.error?.message ?? null,
    isLoading: mondayQuery.isLoading || metaQuery.isLoading,
  }
}
