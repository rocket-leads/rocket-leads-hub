"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { MondayClient } from "@/lib/monday"

type Props = {
  client: MondayClient
  supabaseClientId: string
}

export function ClientTabs({ client, supabaseClientId }: Props) {
  return (
    <Tabs defaultValue="campaigns">
      <TabsList>
        <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
        <TabsTrigger value="communication">Communication</TabsTrigger>
      </TabsList>

      <TabsContent value="campaigns" className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Campaigns</CardTitle>
            <CardDescription>Meta Ads performance — coming in next step</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            {client.metaAdAccountId ? (
              <p>
                Ad Account: <span className="font-mono text-foreground">{client.metaAdAccountId}</span>
              </p>
            ) : (
              <p className="text-yellow-500">No Meta Ad Account linked in Monday.com</p>
            )}
            {client.clientBoardId ? (
              <p>
                Client Board ID: <span className="font-mono text-foreground">{client.clientBoardId}</span>
              </p>
            ) : (
              <p className="text-yellow-500">No client board linked in Monday.com</p>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="billing" className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Billing</CardTitle>
            <CardDescription>Stripe invoices — coming in next step</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {client.stripeCustomerId ? (
              <p>
                Stripe Customer: <span className="font-mono text-foreground">{client.stripeCustomerId}</span>
              </p>
            ) : (
              <p className="text-yellow-500">No Stripe Customer ID linked in Monday.com</p>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="communication" className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Communication</CardTitle>
            <CardDescription>Trengo messages — coming in next step</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {client.trengoContactId ? (
              <p>
                Trengo Contact: <span className="font-mono text-foreground">{client.trengoContactId}</span>
              </p>
            ) : (
              <p className="text-yellow-500">No Trengo Contact ID linked in Monday.com</p>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
