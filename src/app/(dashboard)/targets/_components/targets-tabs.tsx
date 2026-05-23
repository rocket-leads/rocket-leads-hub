"use client"

import { Suspense, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useIsFetching, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { BarChart3, CreditCard, RefreshCw, Users, Settings2 } from "lucide-react"
import { MarketingTab } from "./marketing-tab"
import { FinanceTab } from "./finance-tab"
import { DeliveryTab } from "./delivery-tab"
import { SettingsTab } from "./settings-tab"
import { Skeleton } from "@/components/ui/skeleton"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { getCachedDateRangeSnapshot } from "../_hooks/use-date-range"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"

type TargetsTabId = "marketing" | "finance" | "delivery" | "settings"

/** Query key prefixes belonging to the targets dashboard — used by the refresh button to scope invalidation. */
const TARGETS_QUERY_PREFIXES = ["targets-monday", "targets-meta", "targets-finance", "targets-costs", "targets-delivery", "targets-config"] as const

function TargetsTabsInner({ isAdmin, canSeeFinance }: { isAdmin: boolean; canSeeFinance: boolean }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const locale = useLocale()
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Build tabs per render so labels flip with the locale toggle. The
  // icon + id pair stay static.
  const ALL_MAIN_TABS: TopTab<TargetsTabId>[] = [
    { id: "marketing", label: t("targets.tab.marketing", locale), icon: BarChart3 },
    { id: "delivery", label: t("targets.tab.delivery", locale), icon: Users },
    { id: "finance", label: t("targets.tab.finance", locale), icon: CreditCard },
  ]
  // Finance tab is admin+finance (Roy 2026-05-23). Marketing + Delivery
  // stay visible to everyone.
  const mainTabs = ALL_MAIN_TABS.filter((tab) => canSeeFinance || tab.id !== "finance")
  const validIds = new Set<string>([...mainTabs.map((tab) => tab.id), ...(isAdmin ? ["settings"] : [])])
  const tabParam = searchParams.get("tab") ?? ""
  const activeTab: TargetsTabId = (validIds.has(tabParam) ? tabParam : "marketing") as TargetsTabId

  // Spinner stays on for any in-flight target query, not just the manual refresh.
  const inFlight = useIsFetching({
    predicate: (q) =>
      Array.isArray(q.queryKey) &&
      typeof q.queryKey[0] === "string" &&
      (TARGETS_QUERY_PREFIXES as readonly string[]).includes(q.queryKey[0]),
  })
  const isFetching = inFlight > 0 || isRefreshing

  const setTab = (id: TargetsTabId) => {
    router.replace(`/targets?tab=${id}`, { scroll: false })
  }

  async function handleRefresh() {
    setIsRefreshing(true)
    try {
      const { startDate, endDate } = getCachedDateRangeSnapshot()
      const s = format(startDate, "yyyy-MM-dd")
      const e = format(endDate, "yyyy-MM-dd")
      const year = startDate.getFullYear()
      const month = startDate.getMonth() + 1
      // Bypass the server-side caches by hitting each endpoint with refresh=1 in
      // parallel. We discard the response — React Query refetches with the normal
      // (non-refresh) URLs right after, hitting the freshly-warm caches.
      await Promise.allSettled([
        fetch(`/api/targets/monday?startDate=${s}&endDate=${e}&refresh=1`, { cache: "no-store" }),
        fetch(`/api/targets/meta?startDate=${s}&endDate=${e}&refresh=1`, { cache: "no-store" }),
        ...(canSeeFinance ? [fetch(`/api/targets/finance?startDate=${s}&endDate=${e}&refresh=1`, { cache: "no-store" })] : []),
        ...(isAdmin ? [fetch(`/api/targets/costs?year=${year}&month=${month}&refresh=1`, { cache: "no-store" })] : []),
        fetch(`/api/targets/delivery?startDate=${s}&endDate=${e}&refresh=1`, { cache: "no-store" }),
      ])
      await queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          typeof q.queryKey[0] === "string" &&
          (TARGETS_QUERY_PREFIXES as readonly string[]).includes(q.queryKey[0]),
      })
      router.refresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <div className="space-y-6">
      <TopTabs<TargetsTabId>
        tabs={mainTabs}
        value={activeTab}
        onChange={setTab}
        rightContent={
          <>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isFetching}
              title={t("targets.action.refresh", locale)}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setTab("settings")}
                title={t("targets.action.settings", locale)}
                className={`h-8 w-8 rounded-lg flex items-center justify-center transition-all ${
                  activeTab === "settings"
                    ? "text-foreground bg-muted/50"
                    : "text-muted-foreground/40 hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        }
      />

      {activeTab === "marketing" && <MarketingTab />}
      {activeTab === "finance" && canSeeFinance && <FinanceTab />}
      {activeTab === "delivery" && <DeliveryTab />}
      {activeTab === "settings" && isAdmin && <SettingsTab />}
    </div>
  )
}

export function TargetsTabs({ isAdmin, canSeeFinance }: { isAdmin: boolean; canSeeFinance: boolean }) {
  return (
    <Suspense fallback={
      <div className="space-y-6">
        <div className="flex items-center border-b border-border/40 h-[49px]" />
        <div className="space-y-4">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      </div>
    }>
      <TargetsTabsInner isAdmin={isAdmin} canSeeFinance={canSeeFinance} />
    </Suspense>
  )
}
