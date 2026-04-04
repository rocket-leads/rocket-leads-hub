"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { RefreshCw, BarChart3, CreditCard, MessageCircle, Settings2 } from "lucide-react"
import { CampaignsTab } from "./campaigns-tab"
import { BillingTab } from "./billing-tab"
import { CommunicationTab } from "./communication-tab"
import { ClientSettingsTab } from "./client-settings-tab"
import { Card, CardContent } from "@/components/ui/card"
import type { MondayClient } from "@/lib/integrations/monday"
import type { ClientAccess } from "@/lib/clients/access"

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
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isRefreshing, setIsRefreshing] = useState(false)

  const tabs = [
    ...(access.canViewCampaigns ? [{ id: "campaigns", label: "Campaigns", icon: BarChart3 }] : []),
    ...(access.canViewBilling ? [{ id: "billing", label: "Billing", icon: CreditCard }] : []),
    ...(access.canViewCommunication ? [{ id: "communication", label: "Communication", icon: MessageCircle }] : []),
    { id: "settings", label: "Settings", icon: Settings2 },
  ]

  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? "campaigns")

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
      <div className="flex items-center justify-between border-b border-border/40">
        <div className="flex items-center gap-0">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`relative flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all duration-150 ${
                activeTab === id
                  ? "text-foreground"
                  : "text-muted-foreground/60 hover:text-foreground"
              }`}
              onClick={() => setActiveTab(id)}
            >
              <Icon className={`h-4 w-4 transition-colors ${activeTab === id ? "text-primary" : ""}`} />
              {label}
              {activeTab === id && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        <button
          className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 transition-all mb-1"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
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

      {activeTab === "settings" && (
        <ClientSettingsTab
          mondayItemId={client.mondayItemId}
          metaAdAccountId={client.metaAdAccountId || null}
        />
      )}
    </div>
  )
}
