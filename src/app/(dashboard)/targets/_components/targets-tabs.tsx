"use client"

import { useState } from "react"
import { BarChart3, CreditCard, Users, Settings2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { MarketingTab } from "./marketing-tab"
import { FinanceTab } from "./finance-tab"
import { DeliveryTab } from "./delivery-tab"
import { SettingsTab } from "./settings-tab"

type Tab = {
  id: string
  label: string
  icon: LucideIcon
  subtle?: boolean
}

const TABS: Tab[] = [
  { id: "marketing", label: "Marketing / Sales", icon: BarChart3 },
  { id: "finance", label: "Finance", icon: CreditCard },
  { id: "delivery", label: "Delivery", icon: Users },
  { id: "settings", label: "Settings", icon: Settings2, subtle: true },
]

export function TargetsTabs() {
  const [activeTab, setActiveTab] = useState("marketing")

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border/40">
        <div className="flex items-center gap-0 flex-1">
          {TABS.filter((t) => !t.subtle).map(({ id, label, icon: Icon }) => (
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

        {/* Settings — right-aligned, subtle */}
        {TABS.filter((t) => t.subtle).map(({ id, icon: Icon }) => (
          <button
            key={id}
            className={`relative h-8 w-8 rounded-lg flex items-center justify-center transition-all mb-1 ${
              activeTab === id
                ? "text-foreground bg-muted/50"
                : "text-muted-foreground/40 hover:text-foreground hover:bg-muted/50"
            }`}
            onClick={() => setActiveTab(id)}
            title="Settings"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "marketing" && <MarketingTab />}
      {activeTab === "finance" && <FinanceTab />}
      {activeTab === "delivery" && <DeliveryTab />}
      {activeTab === "settings" && <SettingsTab />}
    </div>
  )
}
