"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCw, BarChart3, CreditCard, Settings2, LayoutDashboard, Inbox as InboxIcon, Activity, Sparkles } from "lucide-react"
import { CampaignsTab } from "./campaigns-tab"
import { BillingTab } from "./billing-tab"
import { ClientSettingsTab } from "./client-settings-tab"
import { InboxTab } from "./inbox-tab"
import { HomeTab } from "./home-tab"
import { TimelineTab } from "./timeline-tab"
import { PedroTab } from "./pedro-tab"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import type { CurrentUser } from "@/app/(dashboard)/inbox/_components/inbox-view"
import { Card, CardContent } from "@/components/ui/card"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { MondayClient } from "@/lib/integrations/monday"
import type { ClientAccess } from "@/lib/clients/access"
import type { BillingData, InvoiceRow } from "@/lib/integrations/stripe"

type Props = {
  client: MondayClient
  supabaseClientId: string
  access: ClientAccess
  currentUser: CurrentUser
}

function NoAccess() {
  const locale = useLocale()
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        {t("client.no_access", locale)}
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
  const locale = useLocale()
  const [isRefreshing, setIsRefreshing] = useState(false)
  // Incremented by the Refresh button. Passed to tabs so their queries can
  // include it in the queryKey (forces React Query to refetch) AND propagate
  // `?forceRefresh=1` so the API bypasses the 10-minute `cache_store` entries
  // for Monday board items + Meta insights. Without this, Refresh only
  // invalidates browser-side caches while the server keeps serving stale data.
  const [refreshNonce, setRefreshNonce] = useState(0)

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
    { id: "home", label: t("client.tab.home", locale), icon: LayoutDashboard },
    ...(access.canViewCampaigns ? [{ id: "campaigns", label: t("client.tab.campaigns", locale), icon: BarChart3 }] : []),
    { id: "inbox", label: t("client.tab.inbox", locale), icon: InboxIcon },
    { id: "timeline", label: t("client.tab.timeline", locale), icon: Activity },
    { id: "pedro", label: t("client.tab.pedro", locale), icon: Sparkles },
    ...(access.canViewBilling ? [{ id: "billing", label: t("client.tab.billing", locale), icon: CreditCard, ...(hasOverdueInvoice ? { dot: "red" as const } : {}) }] : []),
    { id: "settings", label: t("client.tab.settings", locale), icon: Settings2 },
  ]

  const [activeTab, setActiveTab] = useState<string>("home")

  // Campaigns query lives in CampaignsTab itself — the previous prefetch here
  // was dead (its result wasn't read at this layer) and cost a 1-3s Meta call
  // on every slide-over open. CampaignsTab fetches on mount when the user
  // actually opens it; the Refresh button still invalidates by mondayItemId
  // prefix and catches it.

  async function handleRefresh() {
    setIsRefreshing(true)
    setRefreshNonce((n) => n + 1)
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
      <TopTabs<string>
        tabs={tabs}
        value={activeTab}
        onChange={setActiveTab}
        rightContent={
          <button
            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 transition-all"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title={t("client.tab.refresh_title", locale)}
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
          refreshNonce={refreshNonce}
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

      {activeTab === "pedro" && (
        <PedroTab mondayItemId={client.mondayItemId} clientName={client.name} />
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
