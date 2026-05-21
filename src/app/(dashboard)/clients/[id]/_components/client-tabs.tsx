"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCw, BarChart3, MessageSquare, Settings2, Sparkles } from "lucide-react"
import { CampaignsTab } from "./campaigns-tab"
import { BillingTab } from "./billing-tab"
import { ClientSettingsTab } from "./client-settings-tab"
import { InboxTab } from "./inbox-tab"
import { HomeTab } from "./home-tab"
import { TimelineTab } from "./timeline-tab"
import { PedroTab } from "./pedro-tab"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
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
  /** Hub-only billing fields not stored on Monday. Null when the
   *  placeholder render is still in flight; the BillingTab handles
   *  the missing-data case by showing an empty input. */
  hubBilling: { nextAdBudgetInvoiceDate: string | null } | null
  currentUser: CurrentUser
}

/**
 * Top-level groups. Reduced from 7 flat tabs (Home / Campaigns / Inbox /
 * Timeline / Pedro / Billing / Settings) to 4 groups:
 *
 *   performance   — KPI summary + campaign drill-down (Overview / Campaigns)
 *   conversations — interactive Inbox + read-only Timeline of touchpoints
 *   pedro         — AI insights for this client (single view)
 *   admin         — Billing + per-client Settings
 *
 * Each group with multiple inner views renders a SegmentedTabs pill switcher
 * at the top of its body so the user can flip between them. Single-view
 * groups (Pedro) skip the switcher entirely.
 */
type TopGroup = "performance" | "conversations" | "pedro" | "admin"
type PerformanceView = "overview" | "campaigns"
type ConversationsView = "inbox" | "timeline"
type AdminView = "billing" | "settings"

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

export function ClientTabs({ client, supabaseClientId, access, hubBilling, currentUser }: Props) {
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

  // Tab state — `activeGroup` drives the top strip; the three view states
  // remember which inner view is active inside each group so jumping away
  // and coming back lands on the same sub-tab.
  const [activeGroup, setActiveGroup] = useState<TopGroup>("performance")
  const [performanceView, setPerformanceView] = useState<PerformanceView>("overview")
  const [conversationsView, setConversationsView] = useState<ConversationsView>("inbox")
  // Default to Billing when the user has billing access (the more frequently
  // touched view); fall back to Settings when they don't.
  const [adminView, setAdminView] = useState<AdminView>(
    access.canViewBilling ? "billing" : "settings",
  )

  // If the user's billing access changes (eg. role promotion mid-session),
  // re-seed adminView so we don't try to render Billing without access.
  useEffect(() => {
    if (!access.canViewBilling && adminView === "billing") setAdminView("settings")
  }, [access.canViewBilling, adminView])

  const groups: TopTab<TopGroup>[] = [
    { id: "performance", label: t("client.tab.group.performance", locale), icon: BarChart3 },
    { id: "conversations", label: t("client.tab.group.conversations", locale), icon: MessageSquare },
    { id: "pedro", label: t("client.tab.group.pedro", locale), icon: Sparkles },
    {
      id: "admin",
      label: t("client.tab.group.admin", locale),
      icon: Settings2,
      // Bubble the overdue-invoice dot up to the Admin top tab so the user
      // sees the affordance without opening the group.
      ...(hasOverdueInvoice ? { dot: "red" as const } : {}),
    },
  ]

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

  // Callbacks fired by inner panels that want to jump to another group. The
  // HomeTab uses these for "open billing" / "open inbox" affordances on the
  // payment banner + tasks card — we map them to the new top+sub state pair.
  const goToCampaigns = () => {
    setActiveGroup("performance")
    setPerformanceView("campaigns")
  }
  const goToInbox = () => {
    setActiveGroup("conversations")
    setConversationsView("inbox")
  }
  const goToBilling = () => {
    setActiveGroup("admin")
    if (access.canViewBilling) setAdminView("billing")
  }
  const goToSettings = () => {
    setActiveGroup("admin")
    setAdminView("settings")
  }

  return (
    <div className="space-y-6">
      <TopTabs<TopGroup>
        tabs={groups}
        value={activeGroup}
        onChange={setActiveGroup}
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

      {/* PERFORMANCE — Overview (Home) + Campaigns drill-down */}
      {activeGroup === "performance" && (
        <div className="space-y-4">
          {access.canViewCampaigns && (
            <SegmentedTabs<PerformanceView>
              items={[
                { id: "overview", label: t("client.tab.sub.overview", locale) },
                { id: "campaigns", label: t("client.tab.sub.campaigns", locale) },
              ]}
              value={performanceView}
              onChange={setPerformanceView}
            />
          )}

          {performanceView === "overview" && (
            <HomeTab
              client={client}
              supabaseClientId={supabaseClientId}
              canViewBilling={access.canViewBilling}
              canViewCampaigns={access.canViewCampaigns}
              refreshNonce={refreshNonce}
              onNavigateToCampaigns={goToCampaigns}
              onNavigateToInbox={goToInbox}
              onNavigateToBilling={goToBilling}
            />
          )}

          {performanceView === "campaigns" && (
            access.canViewCampaigns ? (
              <CampaignsTab
                mondayItemId={client.mondayItemId}
                metaAdAccountId={client.metaAdAccountId || null}
                clientBoardId={client.clientBoardId || null}
                clientName={client.name}
                boardType={client.boardType}
                onNavigateToSettings={goToSettings}
              />
            ) : <NoAccess />
          )}
        </div>
      )}

      {/* CONVERSATIONS — interactive Inbox + read-only Timeline */}
      {activeGroup === "conversations" && (
        <div className="space-y-4">
          <SegmentedTabs<ConversationsView>
            items={[
              { id: "inbox", label: t("client.tab.sub.inbox", locale) },
              { id: "timeline", label: t("client.tab.sub.timeline", locale) },
            ]}
            value={conversationsView}
            onChange={setConversationsView}
          />

          {conversationsView === "inbox" && (
            <InboxTab
              mondayItemId={client.mondayItemId}
              clientName={client.name}
              currentUser={currentUser}
              trengoContactId={client.trengoContactId || null}
              canViewCommunication={access.canViewCommunication}
            />
          )}

          {conversationsView === "timeline" && (
            <TimelineTab mondayItemId={client.mondayItemId} />
          )}
        </div>
      )}

      {/* PEDRO — single view, no sub-toggle */}
      {activeGroup === "pedro" && (
        <PedroTab mondayItemId={client.mondayItemId} clientName={client.name} />
      )}

      {/* ADMIN — Billing + per-client Settings */}
      {activeGroup === "admin" && (
        <div className="space-y-4">
          <SegmentedTabs<AdminView>
            items={[
              ...(access.canViewBilling
                ? [{
                    id: "billing" as const,
                    label: t("client.tab.sub.billing", locale),
                    ...(hasOverdueInvoice ? { dot: "red" as const } : {}),
                  }]
                : []),
              { id: "settings" as const, label: t("client.tab.sub.settings", locale) },
            ]}
            value={adminView}
            onChange={setAdminView}
          />

          {adminView === "billing" && (
            access.canViewBilling ? (
              <BillingTab
                mondayItemId={client.mondayItemId}
                stripeCustomerId={client.stripeCustomerId || null}
                metaAdAccountId={client.metaAdAccountId || null}
                initialNextInvoiceDate={client.nextInvoiceDate || null}
                initialNextAdBudgetInvoiceDate={hubBilling?.nextAdBudgetInvoiceDate ?? null}
              />
            ) : <NoAccess />
          )}

          {adminView === "settings" && (
            <ClientSettingsTab client={client} />
          )}
        </div>
      )}
    </div>
  )
}
