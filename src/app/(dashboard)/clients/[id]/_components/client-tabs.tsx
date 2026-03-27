"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CampaignsTab } from "./campaigns-tab"
import { BillingTab } from "./billing-tab"
import { CommunicationTab } from "./communication-tab"
import type { MondayClient } from "@/lib/monday"

type Props = {
  client: MondayClient
  supabaseClientId: string
}

export function ClientTabs({ client }: Props) {
  return (
    <Tabs defaultValue="campaigns">
      <TabsList>
        <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
        <TabsTrigger value="communication">Communication</TabsTrigger>
      </TabsList>

      <TabsContent value="campaigns" className="mt-6">
        <CampaignsTab
          mondayItemId={client.mondayItemId}
          metaAdAccountId={client.metaAdAccountId || null}
          clientBoardId={client.clientBoardId || null}
        />
      </TabsContent>

      <TabsContent value="billing" className="mt-6">
        <BillingTab
          mondayItemId={client.mondayItemId}
          stripeCustomerId={client.stripeCustomerId || null}
        />
      </TabsContent>

      <TabsContent value="communication" className="mt-6">
        <CommunicationTab
          mondayItemId={client.mondayItemId}
          trengoContactId={client.trengoContactId || null}
        />
      </TabsContent>
    </Tabs>
  )
}
