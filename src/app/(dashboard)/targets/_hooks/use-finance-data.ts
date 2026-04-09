"use client"

import { useQuery } from "@tanstack/react-query"
import { format, startOfMonth, getDaysInMonth } from "date-fns"
import type { FinanceOverview, CostData, ProfitOverview } from "@/types/targets"
import { useMemo } from "react"

function getMonthKey(year: number, month: number): string {
  const names = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]
  return `${names[month - 1]}-${String(year).slice(2)}`
}

export function useFinanceData(year: number, month: number) {
  const lastDay = getDaysInMonth(new Date(year, month - 1))
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  const monthKey = getMonthKey(year, month)

  const stripeQuery = useQuery<FinanceOverview>({
    queryKey: ["targets-finance", startDate, endDate],
    queryFn: () => fetch(`/api/targets/finance?startDate=${startDate}&endDate=${endDate}`).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch finance data")
      return r.json()
    }),
    staleTime: 5 * 60 * 1000,
  })

  const costsQuery = useQuery<CostData>({
    queryKey: ["targets-costs", monthKey],
    queryFn: () => fetch(`/api/targets/sheets?sheet=profits&month=${monthKey}`).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch cost data")
      return r.json()
    }),
    staleTime: 15 * 60 * 1000,
  })

  const profit = useMemo<ProfitOverview | null>(() => {
    if (!stripeQuery.data || !costsQuery.data) return null
    const revenue = stripeQuery.data.cashCollected
    const costs = costsQuery.data.totalCosts
    const netProfit = revenue - costs
    return {
      revenue,
      costs,
      netProfit,
      margin: revenue > 0 ? netProfit / revenue : 0,
      accountingProfit: stripeQuery.data.invoiced - costs,
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

export function useMonthSelector() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const label = useMemo(() => {
    return format(new Date(year, month - 1), "MMM yyyy")
  }, [year, month])

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1

  const goToPrev = () => {
    if (month === 1) { setYear((y) => y - 1); setMonth(12) }
    else setMonth((m) => m - 1)
  }

  const goToNext = () => {
    if (isCurrentMonth) return
    if (month === 12) { setYear((y) => y + 1); setMonth(1) }
    else setMonth((m) => m + 1)
  }

  return { year, month, label, isCurrentMonth, goToPrev, goToNext }
}

// Need to import useState
import { useState } from "react"
