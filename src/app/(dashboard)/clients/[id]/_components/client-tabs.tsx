"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCw, BarChart3, CreditCard, Settings2, LayoutDashboard, Inbox as InboxIcon, Activity } from "lucide-react"
import { CampaignsTab } from "./campaigns-tab"
import { BillingTab } from "./billing-tab"
import { ClientSettingsTab } from "./client-settings-tab"
import { InboxTab } from "./inbox-tab"
import { HomeTab } from "./home-tab"
import { TimelineTab } from "./timeline-tab"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import type { CurrentUser } from "@/app/(dashboard)/inbox/_components/inbox-view"
import { Card, CardContent } from "@/components/ui/card"
import type { MondayClient } from "@/lib/integrations/monday"
import type { ClientAccess } from "@/lib/clients/access"
import type { MetaCampaign } from "@/lib/integrations/meta"
import type { BillingData, InvoiceRow } from "@/lib/integrations/stripe"

type CampaignWithSelection = MetaCampaign & { isSelected: boolean }

type Props = {
  client: MondayClient
  supabaseClientId: string
  access: ClientAccess
  currentUser: CurrentUser
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

function hasOverdue(invoices: InvoiceRow[] | undefined): boolean {
  return !!invoices?.some((i) => i.status === "overdue")
}

export function ClientTabs({ client, supabaseClientId, access, currentUser }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [regenerateSignal, setRegenerateSignal] = useState(0)

  // Drives the tab notification dot — same queryKey as the header so React
  // Query dedupes the network call.
  const billingQuery = useQuery<Partial<BillingData>>({
    queryKey: ["billing-check", client.mondayItemId],
    queryFn: () =>
      client.stripeCustomerId
        ? fetch(`/api/clients/${client.mondayItemId}/billing?stripeCustomerId=${client.stripeCustomerId}`).then((r) => r.json())
        : Promise.resolve({}),
    enabled: !!client.stripeCustomerId && access.canViewBilling,
    staleTime: 5 * 60 * 1000,
  })

  const hasOverdueInvoice = hasOverdue(billingQuery.data?.invoices)

  const tabs: TopTab<string>[] = [
    { id: "home", label: "Home", icon: LayoutDashboard },
    ...(access.canViewCampaigns ? [{ id: "campaigns", label: "Campaigns", icon: BarChart3 }] : []),
    { id: "inbox", label: "Inbox", icon: InboxIcon },
    { id: "timeline", label: "Timeline", icon: Activity },
    ...(access.canViewBilling ? [{ id: "billing", label: "Billing", icon: CreditCard, ...(hasOverdueInvoice ? { dot: "red" as const } : {}) }] : []),
    { id: "settings", label: "Settings", icon: Settings2 },
  ]

  const [activeTab, setActiveTab] = useState<string>("home")

  // Pre-fetch campaign selection — used by Campaigns tab. Kept here so the
  // Refresh button can invalidate it along with everything else.
  const campaignsQuery = useQuery<{ campaigns: CampaignWithSelection[] }>({
    queryKey: ["campaigns", client.mondayItemId],
    queryFn: () =>
      fetch(`/api/clients/${client.mondayItemId}/campaigns?adAccountId=${client.metaAdAccountId}`).then((r) => r.json()),
    enabled: !!client.metaAdAccountId,
  })

  // Currently unused at this layer but kept for parity with the previous
  // implementation — the Refresh button invalidates by `mondayItemId` prefix.
  useMemo(
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
    setRegenerateSignal((n) => n + 1)
    setIsRefreshing(false)
  }

  return (
    <div className="space-y-6">
      <TopTabs<string>
        tabs={tabs}
        value={activeTab}
        onChange={setActiveTab}
        rightContent={
          <button
            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 transition-all"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh data and regenerate analysis"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        }
      />

      {activeTab === "home" && (
        <HomeTab
          client={client}
          supabaseClientId={supabaseClientId}
          canViewBilling={access.canViewBilling}
          canViewCampaigns={access.canViewCampaigns}
          onNavigateToCampaigns={() => setActiveTab("campaigns")}
          onNavigateToInbox={() => setActiveTab("inbox")}
          onNavigateToBilling={() => setActiveTab("billing")}
        />
      )}

      {activeTab === "campaigns" && (
        access.canViewCampaigns ? (
          <CampaignsTab
            mondayItemId={client.mondayItemId}
            metaAdAccountId={client.metaAdAccountId || null}
            clientBoardId={client.clientBoardId || null}
            clientName={client.name}
            boardType={client.boardType}
            onNavigateToSettings={() => setActiveTab("settings")}
            regenerateSignal={regenerateSignal}
          />
        ) : <NoAccess />
      )}

      {activeTab === "inbox" && (
        <InboxTab
          mondayItemId={client.mondayItemId}
          clientName={client.name}
          currentUser={currentUser}
          trengoContactId={client.trengoContactId || null}
          canViewCommunication={access.canViewCommunication}
        />
      )}

      {activeTab === "timeline" && (
        <TimelineTab mondayItemId={client.mondayItemId} />
      )}

      {activeTab === "billing" && (
        access.canViewBilling ? (
          <BillingTab
            mondayItemId={client.mondayItemId}
            stripeCustomerId={client.stripeCustomerId || null}
            initialNextInvoiceDate={client.nextInvoiceDate || null}
          />
        ) : <NoAccess />
      )}

      {activeTab === "settings" && (
        <ClientSettingsTab client={client} />
      )}
    </div>
  )
}
