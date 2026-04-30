"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCw, BarChart3, CreditCard, MessageCircle, Settings2, Wallet, Calendar, ExternalLink, FolderOpen, ChevronRight, type LucideIcon } from "lucide-react"
import { CampaignsTab } from "./campaigns-tab"
import { BillingTab } from "./billing-tab"
import { CommunicationTab } from "./communication-tab"
import { ClientSettingsTab } from "./client-settings-tab"
import { AdBudgetBalance } from "./ad-budget-balance"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import type { MondayClient } from "@/lib/integrations/monday"
import type { ClientAccess } from "@/lib/clients/access"
import type { MetaCampaign } from "@/lib/integrations/meta"
import type { BillingData, InvoiceRow } from "@/lib/integrations/stripe"

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

function SidebarItem({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
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

function SidebarLink({ icon: Icon, label, href }: { icon: LucideIcon; label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 px-3.5 py-2 text-xs text-muted-foreground/60 hover:text-foreground transition-colors group"
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="flex-1 truncate">{label}</span>
      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
    </a>
  )
}

function fmtEuro(v: number): string {
  return `€${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
}

type PaymentStatusSummary =
  | { kind: "complete" }
  | { kind: "open"; count: number; amount: number }
  | { kind: "overdue"; count: number; amount: number }

function summarizePayments(invoices: InvoiceRow[] | undefined): PaymentStatusSummary | null {
  if (!invoices) return null
  const overdue = invoices.filter((i) => i.status === "overdue")
  const open = invoices.filter((i) => i.status === "open")

  if (overdue.length > 0) {
    const amount = overdue.reduce((s, i) => s + (i.amountDue - i.amountPaid), 0)
    return { kind: "overdue", count: overdue.length, amount }
  }
  if (open.length > 0) {
    const amount = open.reduce((s, i) => s + (i.amountDue - i.amountPaid), 0)
    return { kind: "open", count: open.length, amount }
  }
  return { kind: "complete" }
}

function SidebarPaymentStatus({
  summary,
  isLoading,
  onClick,
}: {
  summary: PaymentStatusSummary | null
  isLoading: boolean
  onClick: () => void
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <Skeleton className="h-8 w-8 rounded-md shrink-0" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-3.5 w-32" />
        </div>
      </div>
    )
  }
  if (!summary) return null

  const { dotClass, valueClass, valueText } = (() => {
    if (summary.kind === "overdue") {
      return {
        dotClass: "bg-red-500",
        valueClass: "text-red-400",
        valueText: `${summary.count} ${summary.count === 1 ? "invoice" : "invoices"} · ${fmtEuro(summary.amount)} overdue`,
      }
    }
    if (summary.kind === "open") {
      return {
        dotClass: "bg-amber-500",
        valueClass: "text-amber-400",
        valueText: `${summary.count} ${summary.count === 1 ? "invoice" : "invoices"} · ${fmtEuro(summary.amount)} open`,
      }
    }
    return {
      dotClass: "bg-green-500",
      valueClass: "text-foreground",
      valueText: "Paid up",
    }
  })()

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 px-3.5 py-2.5 w-full hover:bg-muted/30 transition-colors text-left group rounded-md"
    >
      <div className="h-8 w-8 rounded-md bg-muted/50 flex items-center justify-center shrink-0 relative">
        <CreditCard className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${dotClass} ring-2 ring-card`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 leading-none mb-1">Payments</p>
        <p className={`text-sm font-medium tabular-nums leading-none truncate ${valueClass}`}>{valueText}</p>
      </div>
      <ChevronRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
    </button>
  )
}

export function ClientTabs({ client, access }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [regenerateSignal, setRegenerateSignal] = useState(0)

  // Billing query — drives the tab notification dot AND the sidebar payment status row.
  const billingQuery = useQuery<Partial<BillingData>>({
    queryKey: ["billing-check", client.mondayItemId],
    queryFn: () =>
      client.stripeCustomerId
        ? fetch(`/api/clients/${client.mondayItemId}/billing?stripeCustomerId=${client.stripeCustomerId}`).then((r) => r.json())
        : Promise.resolve({}),
    enabled: !!client.stripeCustomerId && access.canViewBilling,
    staleTime: 5 * 60 * 1000,
  })

  const paymentSummary = summarizePayments(billingQuery.data?.invoices)
  const hasOverdueInvoice = paymentSummary?.kind === "overdue"

  type TabDef = { id: string; label: string; icon: LucideIcon; dot?: "red" | "amber" }

  const tabs: TabDef[] = [
    ...(access.canViewCampaigns ? [{ id: "campaigns", label: "Campaigns", icon: BarChart3 }] : []),
    ...(access.canViewBilling ? [{ id: "billing", label: "Billing", icon: CreditCard, ...(hasOverdueInvoice ? { dot: "red" as const } : {}) }] : []),
    ...(access.canViewCommunication ? [{ id: "communication", label: "Communication", icon: MessageCircle }] : []),
    { id: "settings", label: "Settings", icon: Settings2 },
  ]

  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? "campaigns")

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
    // Refetch all client-scoped queries (Meta/Monday data) and wait for them to settle.
    await queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey
        return Array.isArray(key) && key.length >= 2 && key[1] === client.mondayItemId
      },
    })
    // Then bump the signal so the AI proposal regenerates against the fresh KPI data.
    setRegenerateSignal((n) => n + 1)
    setIsRefreshing(false)
  }

  // Sidebar info items (budget + kick-off only — AM/CM now in header)
  const infoItems = [
    client.adBudget && {
      icon: Wallet,
      label: "Ad Budget",
      value: client.adBudget.startsWith("€") ? client.adBudget : `€${Number(client.adBudget).toLocaleString()}`,
    },
    client.kickOffDate && { icon: Calendar, label: "Kick-off", value: client.kickOffDate },
  ].filter(Boolean) as { icon: LucideIcon; label: string; value: string }[]

  // Quick links
  const quickLinks = [
    client.metaAdAccountId && {
      icon: BarChart3,
      label: "Meta Ads Manager",
      href: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${client.metaAdAccountId.replace("act_", "")}`,
    },
    client.clientBoardId && {
      icon: FolderOpen,
      label: "Monday Client Board",
      href: `https://rocketleads-team.monday.com/boards/${client.clientBoardId}`,
    },
  ].filter(Boolean) as { icon: LucideIcon; label: string; href: string }[]

  const showCampaignsSidebar = activeTab === "campaigns" && (!!client.metaAdAccountId || !!client.clientBoardId) && selectedCampaignIds.length > 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      {/* Left — Main content */}
      <div className="min-w-0 space-y-6">
        {/* Tab bar */}
        <div className="flex items-center justify-between border-b border-border/40">
          <div className="flex items-center gap-0">
            {tabs.map(({ id, label, icon: Icon, dot }) => (
              <button
                key={id}
                className={`relative flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all duration-150 ${
                  activeTab === id
                    ? "text-foreground"
                    : "text-muted-foreground/60 hover:text-foreground"
                }`}
                onClick={() => setActiveTab(id)}
              >
                <span className="relative">
                  <Icon className={`h-4 w-4 transition-colors ${activeTab === id ? "text-primary" : ""}`} />
                  {dot && activeTab !== id && (
                    <span className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${dot === "red" ? "bg-red-500" : "bg-amber-500"} ring-2 ring-background`} />
                  )}
                </span>
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
            title="Refresh data and regenerate analysis"
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
              clientName={client.name}
              boardType={client.boardType}
              onNavigateToSettings={() => setActiveTab("settings")}
              regenerateSignal={regenerateSignal}
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
          {/* Client info + payment status + quick links */}
          <Card>
            <CardContent className="p-1.5">
              {infoItems.length > 0 && (
                <div className="divide-y divide-border/30">
                  {infoItems.map(({ icon, label, value }) => (
                    <SidebarItem key={label} icon={icon} label={label} value={value} />
                  ))}
                </div>
              )}

              {/* Payment status — at-a-glance Stripe state, tap to jump to billing tab */}
              {client.stripeCustomerId && access.canViewBilling && (
                <div className={`${infoItems.length > 0 ? "border-t border-border/30 mt-1 pt-1" : ""}`}>
                  <SidebarPaymentStatus
                    summary={paymentSummary}
                    isLoading={billingQuery.isLoading}
                    onClick={() => setActiveTab("billing")}
                  />
                </div>
              )}

              {quickLinks.length > 0 && (
                <div className={`${(infoItems.length > 0 || (client.stripeCustomerId && access.canViewBilling)) ? "border-t border-border/30 mt-1 pt-1" : ""}`}>
                  {quickLinks.map(({ icon, label, href }) => (
                    <SidebarLink key={label} icon={icon} label={label} href={href} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ad budget balance for RL ad account clients */}
          {showCampaignsSidebar && isRocketLeadsAdAccount(client.metaAdAccountId) && client.stripeCustomerId && (
            <AdBudgetBalance
              mondayItemId={client.mondayItemId}
              metaAdAccountId={client.metaAdAccountId!}
              stripeCustomerId={client.stripeCustomerId}
            />
          )}
        </div>
      </div>
    </div>
  )
}
