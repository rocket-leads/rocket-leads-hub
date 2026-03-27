"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ClientsTable } from "./clients-table"
import type { MondayClient } from "@/lib/monday"
import type { BillingSummary } from "@/lib/stripe-client"

type Props = {
  onboarding: MondayClient[]
  current: MondayClient[]
}

export function ClientsOverview({ onboarding, current }: Props) {
  const allClients = useMemo(() => [...onboarding, ...current], [onboarding, current])

  const customerIds = useMemo(
    () => allClients.map((c) => c.stripeCustomerId).filter(Boolean) as string[],
    [allClients]
  )

  const summariesQuery = useQuery<Record<string, BillingSummary>>({
    queryKey: ["billing-summaries", customerIds],
    queryFn: () => {
      const params = new URLSearchParams({ customerIds: customerIds.join(",") })
      return fetch(`/api/billing-summaries?${params}`).then((r) => r.json())
    },
    enabled: customerIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  return (
    <Tabs defaultValue="current">
      <TabsList>
        <TabsTrigger value="current">
          Current Clients
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
            {current.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="onboarding">
          Onboarding
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
            {onboarding.length}
          </span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="current" className="mt-6">
        <ClientsTable clients={current} boardType="current" billingSummaries={summariesQuery.data} />
      </TabsContent>

      <TabsContent value="onboarding" className="mt-6">
        <ClientsTable clients={onboarding} boardType="onboarding" billingSummaries={summariesQuery.data} />
      </TabsContent>
    </Tabs>
  )
}
