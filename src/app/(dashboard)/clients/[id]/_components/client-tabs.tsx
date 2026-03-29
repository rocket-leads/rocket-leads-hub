"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { RefreshCw, BarChart3, CreditCard, MessageCircle } from "lucide-react"
import { CampaignsTab } from "./campaigns-tab"
import { BillingTab } from "./billing-tab"
import { CommunicationTab } from "./communication-tab"
import { Card, CardContent } from "@/components/ui/card"
import type { MondayClient } from "@/lib/integrations/monday"
import type { ClientAccess } from "@/lib/clients/access"

type Props = {
  client: MondayClient
  supabaseClientId: string
  access: ClientAccess
}

const TABS = [
  { id: "campaigns", label: "Campaigns", icon: BarChart3, accessKey: "canViewCampaigns" as const },
  { id: "billing", label: "Billing", icon: CreditCard, accessKey: "canViewBilling" as const },
  { id: "communication", label: "Communication", icon: MessageCircle, accessKey: "canViewCommunication" as const },
]

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
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isRefreshing, setIsRefreshing] = useState(false)

  const availableTabs = TABS.filter((t) => access[t.accessKey])
  const [activeTab, setActiveTab] = useState(availableTabs[0]?.id ?? "campaigns")

  async function handleRefresh() {
    setIsRefreshing(true)
    router.refresh()
    await queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey
        return Array.isArray(key) && key.length >= 2 && key[1] === client.mondayItemId
      },
    })
    setIsRefreshing(false)
  }

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 border-b border-border">
          {availableTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab(id)}
            >
              <Icon className={`h-4 w-4 ${activeTab === id ? "text-primary" : ""}`} />
              {label}
              {activeTab === id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          ))}
        </div>

        <button
          className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Content */}
      {activeTab === "campaigns" && (
        access.canViewCampaigns ? (
          <CampaignsTab
            mondayItemId={client.mondayItemId}
            metaAdAccountId={client.metaAdAccountId || null}
            clientBoardId={client.clientBoardId || null}
            stripeCustomerId={client.stripeCustomerId || null}
          />
        ) : <NoAccess />
      )}

      {activeTab === "billing" && (
        access.canViewBilling ? (
          <BillingTab
            mondayItemId={client.mondayItemId}
            stripeCustomerId={client.stripeCustomerId || null}
          />
        ) : <NoAccess />
      )}

      {activeTab === "communication" && (
        access.canViewCommunication ? (
          <CommunicationTab
            mondayItemId={client.mondayItemId}
            trengoContactId={client.trengoContactId || null}
          />
        ) : <NoAccess />
      )}
    </div>
  )
}
