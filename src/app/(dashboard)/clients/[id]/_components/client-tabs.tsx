"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
// Card/CardContent used for Communication placeholder below
import { CampaignsTab } from "./campaigns-tab"
import { BillingTab } from "./billing-tab"
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
        <Card>
          <CardHeader>
            <CardTitle>Communication</CardTitle>
            <CardDescription>Trengo messages — coming in next step</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {client.trengoContactId ? (
              <p>Trengo Contact: <span className="font-mono text-foreground">{client.trengoContactId}</span></p>
            ) : (
              <p className="text-yellow-500">No Trengo Contact ID linked in Monday.com</p>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
