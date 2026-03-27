"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { AdBudgetBalance as AdBudgetBalanceType } from "@/app/api/clients/[id]/ad-budget-balance/route"

type Props = {
  mondayItemId: string
  metaAdAccountId: string
  stripeCustomerId: string
}

function fmt(n: number) {
  return `€${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function AdBudgetBalance({ mondayItemId, metaAdAccountId, stripeCustomerId }: Props) {
  const query = useQuery<AdBudgetBalanceType>({
    queryKey: ["ad-budget-balance", mondayItemId],
    queryFn: async () => {
      const p = new URLSearchParams({ stripeCustomerId, adAccountId: metaAdAccountId })
      const r = await fetch(`/api/clients/${mondayItemId}/ad-budget-balance?${p}`)
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? "Failed to load ad budget balance")
      return data
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  })

  if (query.isLoading) {
    return <Skeleton className="h-28 w-full" />
  }

  if (query.isError || !query.data) {
    return null
  }

  const { invoicedTotal, actualSpendTotal, balance } = query.data
  const isOverspent = balance < 0

  return (
    <Card className={isOverspent ? "border-red-500/40" : "border-green-500/40"}>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">Ad Budget Balance</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Invoiced</p>
            <p className="text-lg font-bold">{fmt(invoicedTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Actual spend</p>
            <p className="text-lg font-bold">{fmt(actualSpendTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Balance</p>
            <p className={`text-lg font-bold ${isOverspent ? "text-red-400" : "text-green-400"}`}>
              {isOverspent ? "" : "+"}{fmt(balance)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
