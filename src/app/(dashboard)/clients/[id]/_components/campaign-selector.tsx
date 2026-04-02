"use client"

import { useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { MetaCampaign } from "@/lib/integrations/meta"

type CampaignWithSelection = MetaCampaign & { isSelected: boolean }

type Props = {
  campaigns: CampaignWithSelection[]
  isLoading: boolean
  mondayItemId: string
  onSelectionChange: () => void
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-500/20 text-green-400 border-green-500/30",
  PAUSED: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  ARCHIVED: "bg-muted text-muted-foreground",
}

export function CampaignSelector({ campaigns, isLoading, mondayItemId, onSelectionChange }: Props) {
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState("")

  async function toggleCampaign(campaign: CampaignWithSelection) {
    setSaving((s) => ({ ...s, [campaign.id]: true }))
    try {
      await fetch(`/api/clients/${mondayItemId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaign.id,
          campaignName: campaign.name,
          isSelected: !campaign.isSelected,
        }),
      })
      onSelectionChange()
    } finally {
      setSaving((s) => ({ ...s, [campaign.id]: false }))
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    )
  }

  if (campaigns.length === 0) {
    return <p className="text-sm text-muted-foreground">No campaigns found in this ad account.</p>
  }

  const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE")
  const inactiveCampaigns = campaigns.filter((c) => c.status !== "ACTIVE")
  const byStatus = showInactive ? campaigns : activeCampaigns
  const visible = search
    ? byStatus.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : byStatus
  const selectedCount = campaigns.filter((c) => c.isSelected).length

  return (
    <div className="space-y-3">
      <Input
        placeholder="Search campaigns..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {selectedCount === 0
            ? "No campaigns selected — all spend is included in KPIs."
            : `${selectedCount} campaign${selectedCount > 1 ? "s" : ""} selected.`}
        </p>
        {inactiveCampaigns.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs h-7"
            onClick={() => setShowInactive((v) => !v)}
          >
            {showInactive
              ? `Hide inactive (${inactiveCampaigns.length})`
              : `Show inactive (${inactiveCampaigns.length})`}
          </Button>
        )}
      </div>
      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
        {visible.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">No campaigns match your search.</p>
        )}
        {visible.map((campaign) => (
          <label
            key={campaign.id}
            className="flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
          >
            <input
              type="checkbox"
              checked={campaign.isSelected}
              onChange={() => toggleCampaign(campaign)}
              disabled={saving[campaign.id]}
              className="h-4 w-4 accent-primary"
            />
            <span className="flex-1 text-sm truncate">{campaign.name}</span>
            <Badge variant="outline" className={`text-xs ${STATUS_COLORS[campaign.status] ?? ""}`}>
              {campaign.status}
            </Badge>
          </label>
        ))}
      </div>
    </div>
  )
}
