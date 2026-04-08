"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCw, BarChart3, CreditCard, MessageCircle, Settings2, User, Briefcase, Wallet, Calendar } from "lucide-react"
import { CampaignsTab } from "./campaigns-tab"
import { BillingTab } from "./billing-tab"
import { CommunicationTab } from "./communication-tab"
import { ClientSettingsTab } from "./client-settings-tab"
import { OptimizationProposal } from "./optimization-proposal"
import { AdBudgetBalance } from "./ad-budget-balance"
import { Card, CardContent } from "@/components/ui/card"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import type { MondayClient } from "@/lib/integrations/monday"
import type { ClientAccess } from "@/lib/clients/access"
import type { MetaCampaign } from "@/lib/integrations/meta"

type CampaignWithSelection = MetaCampaign & { isSelected: boolean }

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

function ClientInfoCard({ icon: Icon, label, value }: { icon: typeof User; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <div className="h-8 w-8 rounded-md bg-muted/50 flex items-center justify-center shrink-0">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 leading-none mb-1">{label}</p>
        <p className="text-sm font-medium tabular-nums leading-none truncate">{value}</p>
      </div>
    </div>
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

  // Query selected campaigns for sidebar components (React Query deduplicates with CampaignsTab)
  const campaignsQuery = useQuery<{ campaigns: CampaignWithSelection[] }>({
    queryKey: ["campaigns", client.mondayItemId],
    queryFn: () =>
      fetch(`/api/clients/${client.mondayItemId}/campaigns?adAccountId=${client.metaAdAccountId}`).then((r) => r.json()),
    enabled: !!client.metaAdAccountId,
  })

  const selectedCampaignIds = useMemo(
    () => (campaignsQuery.data?.campaigns ?? []).filter((c) => c.isSelected).map((c) => c.id),
    [campaignsQuery.data]
  )

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

  const infoItems = [
    client.accountManager && { icon: User, label: "Account Manager", value: client.accountManager },
    client.campaignManager && { icon: Briefcase, label: "Campaign Manager", value: client.campaignManager },
    client.adBudget && {
      icon: Wallet,
      label: "Ad Budget",
      value: client.adBudget.startsWith("€") ? client.adBudget : `€${Number(client.adBudget).toLocaleString()}`,
    },
    client.kickOffDate && { icon: Calendar, label: "Kick-off", value: client.kickOffDate },
  ].filter(Boolean) as { icon: typeof User; label: string; value: string }[]

  const showCampaignsSidebar = activeTab === "campaigns" && (!!client.metaAdAccountId || !!client.clientBoardId) && selectedCampaignIds.length > 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      {/* Left — Main content */}
      <div className="min-w-0 space-y-6">
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
              clientName={client.name}
              boardType={client.boardType}
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

      {/* Right — Sticky sidebar */}
      <div className="hidden lg:block">
        <div className="sticky top-6 space-y-4">
          {/* Client info */}
          {infoItems.length > 0 && (
            <Card>
              <CardContent className="p-1.5 divide-y divide-border/30">
                {infoItems.map(({ icon, label, value }) => (
                  <ClientInfoCard key={label} icon={icon} label={label} value={value} />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Campaign-specific sidebar content */}
          {showCampaignsSidebar && (
            <>
              {isRocketLeadsAdAccount(client.metaAdAccountId) && client.stripeCustomerId && (
                <AdBudgetBalance
                  mondayItemId={client.mondayItemId}
                  metaAdAccountId={client.metaAdAccountId!}
                  stripeCustomerId={client.stripeCustomerId}
                />
              )}
              <OptimizationProposal
                mondayItemId={client.mondayItemId}
                metaAdAccountId={client.metaAdAccountId}
                clientBoardId={client.clientBoardId || null}
                selectedCampaignIds={selectedCampaignIds}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
