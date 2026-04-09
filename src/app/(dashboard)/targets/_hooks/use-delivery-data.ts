"use client"

import { useQuery } from "@tanstack/react-query"
import type { DeliveryOverview } from "@/types/targets"

export function useDeliveryData(startDate: string, endDate: string) {
  const query = useQuery<DeliveryOverview>({
    queryKey: ["targets-delivery", startDate, endDate],
    queryFn: () => fetch(`/api/targets/delivery?startDate=${startDate}&endDate=${endDate}`).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch delivery data")
      return r.json()
    }),
    staleTime: 5 * 60 * 1000,
  })

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
  }
}
