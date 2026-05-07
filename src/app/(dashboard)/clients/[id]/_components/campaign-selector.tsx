"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { MetaCampaign } from "@/lib/integrations/meta"

type CampaignWithSelection = MetaCampaign & { isSelected: boolean; isSuggested?: boolean }

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
  const queryClient = useQueryClient()
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState("")
  const queryKey = ["campaigns", mondayItemId]

  // Optimistically flip the selection in the React Query cache so the UI updates instantly,
  // then fire the POST in the background. The parent's onSelectionChange refetches to reconcile.
  function applyOptimistic(targetIds: Set<string>, isSelected: boolean) {
    queryClient.setQueryData<{ campaigns: CampaignWithSelection[] }>(queryKey, (old) => {
      if (!old) return old
      return {
        ...old,
        campaigns: old.campaigns.map((c) =>
          targetIds.has(c.id) ? { ...c, isSelected } : c
        ),
      }
    })
  }

  function toggleCampaign(campaign: CampaignWithSelection) {
    const next = !campaign.isSelected
    applyOptimistic(new Set([campaign.id]), next)
    void fetch(`/api/clients/${mondayItemId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId: campaign.id,
        campaignName: campaign.name,
        isSelected: next,
      }),
    }).finally(onSelectionChange)
  }

  function bulkSetSelection(targets: CampaignWithSelection[], isSelected: boolean) {
    if (targets.length === 0) return
    applyOptimistic(new Set(targets.map((c) => c.id)), isSelected)
    void fetch(`/api/clients/${mondayItemId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaigns: targets.map((c) => ({
          campaignId: c.id,
          campaignName: c.name,
          isSelected,
        })),
      }),
    }).finally(onSelectionChange)
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
  const allVisibleSelected = visible.length > 0 && visible.every((c) => c.isSelected)
  const selectedVisible = visible.filter((c) => c.isSelected)
  // Suggested rows surface to the top of the "Available" group so the user
  // sees them first and can confirm with one click.
  const unselectedVisible = visible
    .filter((c) => !c.isSelected)
    .sort((a, b) => Number(b.isSuggested ?? false) - Number(a.isSuggested ?? false))
  const showGroupHeaders = selectedVisible.length > 0 && unselectedVisible.length > 0

  const renderRow = (campaign: CampaignWithSelection) => (
    <label
      key={campaign.id}
      className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer transition-colors",
        campaign.isSelected
          ? "border-primary/40 bg-primary/10 hover:bg-primary/15"
          : campaign.isSuggested
          ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
          : "hover:bg-muted/50"
      )}
    >
      <input
        type="checkbox"
        checked={campaign.isSelected}
        onChange={() => toggleCampaign(campaign)}
        className="h-4 w-4 accent-primary"
      />
      <span className={cn("flex-1 text-sm truncate", campaign.isSelected && "font-medium")}>
        {campaign.name}
      </span>
      {campaign.isSuggested && !campaign.isSelected && (
        <Badge
          variant="outline"
          className="text-xs bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
          title="The matcher thinks this campaign probably belongs to this client. Click to confirm."
        >
          Suggested
        </Badge>
      )}
      <Badge variant="outline" className={`text-xs ${STATUS_COLORS[campaign.status] ?? ""}`}>
        {campaign.status}
      </Badge>
    </label>
  )

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
        <div className="flex items-center gap-1">
          {visible.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-7"
              onClick={() => bulkSetSelection(visible, !allVisibleSelected)}
            >
              {allVisibleSelected ? "Deselect all" : "Select all"}
            </Button>
          )}
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
      </div>
      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
        {visible.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">No campaigns match your search.</p>
        )}
        {showGroupHeaders && selectedVisible.length > 0 && (
          <p className="text-[10px] font-medium uppercase tracking-wider text-primary/70 px-1 pt-0.5">
            Selected ({selectedVisible.length})
          </p>
        )}
        {selectedVisible.map(renderRow)}
        {showGroupHeaders && unselectedVisible.length > 0 && (
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 px-1 pt-3">
            Available
          </p>
        )}
        {unselectedVisible.map(renderRow)}
      </div>
    </div>
  )
}
