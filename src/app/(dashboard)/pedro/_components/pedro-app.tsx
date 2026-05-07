"use client"

import { useState } from "react"
import { Sparkles, Lightbulb, Compass, Video, ImageIcon, FileCode, Megaphone } from "lucide-react"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { Campaign } from "./pedro-campaign"
import { Research } from "./pedro-research"
import type { PedroClient } from "../page"

type Section = "brief" | "research" | "angles" | "script" | "creatives" | "lp" | "ad-copy"
type CampaignSection = Exclude<Section, "research">

const TABS: TopTab<Section>[] = [
  { id: "brief", label: "Brief", icon: Sparkles },
  { id: "research", label: "Research", icon: Lightbulb },
  { id: "angles", label: "Angles", icon: Compass },
  { id: "script", label: "Video scripts", icon: Video },
  { id: "creatives", label: "Creatives", icon: ImageIcon },
  { id: "lp", label: "LP prompts", icon: FileCode },
  { id: "ad-copy", label: "Ad copy", icon: Megaphone },
]

type Props = { clients: PedroClient[] }

export function PedroApp({ clients }: Props) {
  const [section, setSection] = useState<Section>("brief")

  return (
    <div className="pedro-root">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-heading font-semibold tracking-tight leading-tight">
            Pedro
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Campaign manager AI — research, angles, scripts, creatives en ad copy.
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
