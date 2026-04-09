"use client"

import { useQuery } from "@tanstack/react-query"
import type { TargetsConfig } from "@/types/targets"

export function useTargetsConfig() {
  return useQuery<TargetsConfig | null>({
    queryKey: ["targets-config"],
    queryFn: () => fetch("/api/targets/config").then((r) => {
      if (!r.ok) throw new Error("Failed to fetch targets config")
      return r.json()
    }),
    staleTime: 10 * 60 * 1000,
  })
}
