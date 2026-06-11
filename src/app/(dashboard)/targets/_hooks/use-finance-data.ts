"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import type { FinanceOverview, CostData, ProfitOverview } from "@/types/targets"

/**
 * `startDate`/`endDate` drive the Stripe revenue query at exact day resolution.
 * `year`/`month` drive the costs query - costs come from a Google Sheet with
 * one column per calendar month, so we derive these from the range start.
 */
export function useFinanceData(startDate: string, endDate: string, year: number, month: number) {
  const stripeQuery = useQuery<FinanceOverview>({
    queryKey: ["targets-finance", startDate, endDate],
    queryFn: () => fetch(`/api/targets/finance?startDate=${startDate}&endDate=${endDate}`).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch finance data")
      return r.json()
    }),
    staleTime: 5 * 60 * 1000,
  })

  const costsQuery = useQuery<CostData>({
    queryKey: ["targets-costs", year, month],
    queryFn: () => fetch(`/api/targets/costs?year=${year}&month=${month}`).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch cost data")
      return r.json()
    }),
    staleTime: 15 * 60 * 1000,
  })

  const profit = useMemo<ProfitOverview | null>(() => {
    if (!stripeQuery.data || !costsQuery.data) return null
    const revenue = stripeQuery.data.total.cashCollected
    const costs = costsQuery.data.totalCosts
    const netProfit = revenue - costs
    return {
      revenue,
      costs,
      netProfit,
      margin: revenue > 0 ? netProfit / revenue : 0,
      accountingProfit: stripeQuery.data.total.invoiced - costs,
      cashProfit: netProfit,
    }
  }, [stripeQuery.data, costsQuery.data])

  return {
    finance: stripeQuery.data ?? null,
    costs: costsQuery.data ?? null,
    profit,
    loading: stripeQuery.isLoading || costsQuery.isLoading,
    error: stripeQuery.error?.message || costsQuery.error?.message || null,
  }
}

