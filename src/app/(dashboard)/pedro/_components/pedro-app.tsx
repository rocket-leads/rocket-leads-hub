"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { Sparkles, Lightbulb, Compass, Video, ImageIcon, FileCode, Megaphone, RefreshCw, Layers } from "lucide-react"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { Campaign } from "./pedro-campaign"
import { Research } from "./pedro-research"
import { PedroRefresh } from "./pedro-refresh"
import { PedroInsights } from "./pedro-insights"
import type { PedroClient } from "../page"

type Section =
  | "brief"
  | "research"
  | "angles"
  | "script"
  | "creatives"
  | "lp"
  | "ad-copy"
  | "refresh"
  | "insights"

type CampaignSection = Exclude<Section, "research" | "refresh" | "insights">

const TABS: TopTab<Section>[] = [
  { id: "brief", label: "Brief", icon: Sparkles },
  { id: "research", label: "Research", icon: Lightbulb },
  { id: "angles", label: "Angles", icon: Compass },
  { id: "script", label: "Video scripts", icon: Video },
  { id: "creatives", label: "Creatives", icon: ImageIcon },
  { id: "lp", label: "LP prompts", icon: FileCode },
  { id: "ad-copy", label: "Ad copy", icon: Megaphone },
  { id: "refresh", label: "Refresh", icon: RefreshCw },
  { id: "insights", label: "Insights", icon: Layers },
]

const VALID_SECTIONS = new Set<Section>([
  "brief",
  "research",
  "angles",
  "script",
  "creatives",
  "lp",
  "ad-copy",
  "refresh",
])

type Props = { clients: PedroClient[] }

export function PedroApp({ clients }: Props) {
  const searchParams = useSearchParams()
  // Open Pedro on a specific tab + pre-selected client via URL: e.g. the
  // Watch List "Ask Pedro" button links to /pedro?tab=refresh&clientId=X
  // and Pedro lands ready to go. Defaults to brief when nothing is passed.
  const initialSection: Section = (() => {
    const t = searchParams.get("tab")
    if (t && VALID_SECTIONS.has(t as Section)) return t as Section
    if (searchParams.get("clientId")) return "refresh" // shorthand for Watch List
    return "brief"
  })()

  const [section, setSection] = useState<Section>(initialSection)

  // If the URL tab param changes (e.g. navigation from another page), follow
  // it. We only sync URL → state, not state → URL — keeps the URL stable
  // when the user clicks tabs internally.
  useEffect(() => {
    const t = searchParams.get("tab")
    if (t && VALID_SECTIONS.has(t as Section)) {
      setSection(t as Section)
    }
  }, [searchParams])

  const requestedClientId = searchParams.get("clientId")
  const requestedAuto = searchParams.get("auto") === "1"

  return (
    <div className="pedro-root">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-heading font-semibold tracking-tight leading-tight">
            Pedro
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Campaign manager AI — onboarding deliverables + creative refresh op live performance.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-[blink_2s_infinite]" />
          Online
        </span>
      </div>

      <TopTabs<Section> tabs={TABS} value={section} onChange={setSection} className="mb-6" />

      <div>
        {section === "research" ? (
          <Research />
        ) : section === "refresh" ? (
          <PedroRefresh
            clients={clients}
            initialClientId={requestedClientId}
            autoStart={requestedAuto}
          />
        ) : section === "insights" ? (
          <PedroInsights />
        ) : (
          <Campaign
            section={section as CampaignSection}
            setSection={(s) => setSection(s)}
            clients={clients}
          />
        )}
      </div>
    </div>
  )
}
