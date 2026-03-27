"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ClientsTable } from "./clients-table"
import type { MondayClient } from "@/lib/monday"

type Props = {
  onboarding: MondayClient[]
  current: MondayClient[]
}

export function ClientsOverview({ onboarding, current }: Props) {
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
        <ClientsTable clients={current} boardType="current" />
      </TabsContent>

      <TabsContent value="onboarding" className="mt-6">
        <ClientsTable clients={onboarding} boardType="onboarding" />
      </TabsContent>
    </Tabs>
  )
}
