"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CampaignsTab } from "./campaigns-tab"
import { BillingTab } from "./billing-tab"
import { CommunicationTab } from "./communication-tab"
import { Card, CardContent } from "@/components/ui/card"
import type { MondayClient } from "@/lib/monday"
import type { ClientAccess } from "@/lib/client-access"

type Props = {
  client: MondayClient
  supabaseClientId: string
  access: ClientAccess
}

function NoAccess() {
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        You do not have access to this section.
      </CardContent>
    </Card>
  )
}

export function ClientTabs({ client, access }: Props) {
  const defaultTab =
    access.canViewCampaigns ? "campaigns" :
    access.canViewBilling ? "billing" :
    "communication"

  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        {access.canViewCampaigns && <TabsTrigger value="campaigns">Campaigns</TabsTrigger>}
        {access.canViewBilling && <TabsTrigger value="billing">Billing</TabsTrigger>}
        {access.canViewCommunication && <TabsTrigger value="communication">Communication</TabsTrigger>}
      </TabsList>

      <TabsContent value="campaigns" className="mt-6">
        {access.canViewCampaigns ? (
          <CampaignsTab
            mondayItemId={client.mondayItemId}
            metaAdAccountId={client.metaAdAccountId || null}
            clientBoardId={client.clientBoardId || null}
          />
        ) : <NoAccess />}
      </TabsContent>

      <TabsContent value="billing" className="mt-6">
        {access.canViewBilling ? (
          <BillingTab
            mondayItemId={client.mondayItemId}
            stripeCustomerId={client.stripeCustomerId || null}
          />
        ) : <NoAccess />}
      </TabsContent>

      <TabsContent value="communication" className="mt-6">
        {access.canViewCommunication ? (
          <CommunicationTab
            mondayItemId={client.mondayItemId}
            trengoContactId={client.trengoContactId || null}
          />
        ) : <NoAccess />}
      </TabsContent>
    </Tabs>
  )
}
