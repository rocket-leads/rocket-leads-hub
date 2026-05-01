"use client"

import { Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { BarChart3, CreditCard, Users, Settings2 } from "lucide-react"
import { MarketingTab } from "./marketing-tab"
import { FinanceTab } from "./finance-tab"
import { DeliveryTab } from "./delivery-tab"
import { SettingsTab } from "./settings-tab"
import { Skeleton } from "@/components/ui/skeleton"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"

type TargetsTabId = "marketing" | "finance" | "delivery" | "settings"

const ALL_MAIN_TABS: TopTab<TargetsTabId>[] = [
  { id: "marketing", label: "Marketing / Sales", icon: BarChart3 },
  { id: "delivery", label: "Delivery", icon: Users },
  { id: "finance", label: "Finance", icon: CreditCard },
]

function TargetsTabsInner({ isAdmin }: { isAdmin: boolean }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const mainTabs = ALL_MAIN_TABS.filter((t) => isAdmin || t.id !== "finance")
  const validIds = new Set<string>([...mainTabs.map((t) => t.id), ...(isAdmin ? ["settings"] : [])])
  const tabParam = searchParams.get("tab") ?? ""
  const activeTab: TargetsTabId = (validIds.has(tabParam) ? tabParam : "marketing") as TargetsTabId

  const setTab = (id: TargetsTabId) => {
    router.replace(`/targets?tab=${id}`, { scroll: false })
  }

  return (
    <div className="space-y-6">
      <TopTabs<TargetsTabId>
        tabs={mainTabs}
        value={activeTab}
        onChange={setTab}
        rightContent={
          isAdmin ? (
            <button
              type="button"
              onClick={() => setTab("settings")}
              title="Settings"
              className={`h-8 w-8 rounded-lg flex items-center justify-center transition-all ${
                activeTab === "settings"
                  ? "text-foreground bg-muted/50"
                  : "text-muted-foreground/40 hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          ) : null
        }
      />

      {activeTab === "marketing" && <MarketingTab />}
      {activeTab === "finance" && isAdmin && <FinanceTab />}
      {activeTab === "delivery" && <DeliveryTab />}
      {activeTab === "settings" && isAdmin && <SettingsTab />}
    </div>
  )
}

export function TargetsTabs({ isAdmin }: { isAdmin: boolean }) {
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
      <TargetsTabsInner isAdmin={isAdmin} />
    </Suspense>
  )
}
