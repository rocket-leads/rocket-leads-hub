"use client"

import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Check, Search } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TopTabs } from "@/components/ui/top-tabs"
import { cn } from "@/lib/utils"
import type { MetaCampaign } from "@/lib/integrations/meta"

type CampaignWithSelection = MetaCampaign & { isSelected: boolean; isSuggested?: boolean }

type Props = {
  campaigns: CampaignWithSelection[]
  isLoading: boolean
  mondayItemId: string
  onSelectionChange: () => void
}

type View = "selected" | "available"

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
  PAUSED: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  ARCHIVED: "bg-muted text-muted-foreground",
}

/**
 * Campaign selection panel for the client detail page. Two-tab layout
 * (Geselecteerd / Beschikbaar) so the CM can see at-a-glance which
 * campaigns are currently feeding KPIs vs. which ones are sitting on
 * the account waiting to be picked up. Click any row to flip its
 * selection — the row instantly disappears from the current tab and
 * shows up in the other.
 *
 * Earlier design used grouped headers within one list, which buried
 * "Selected" under a long Available list when the account had many
 * campaigns (typical for RL shared ad accounts). Roy 2026-05-22.
 */
export function CampaignSelector({ campaigns, isLoading, mondayItemId, onSelectionChange }: Props) {
  const queryClient = useQueryClient()
  const [view, setView] = useState<View>("selected")
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState("")
  const queryKey = ["campaigns", mondayItemId]

  // Optimistically flip the selection in the React Query cache so the
  // UI updates instantly. Returns the snapshot so the mutation can roll
  // back on failure without losing concurrent edits the user made.
  function applyOptimistic(targetIds: Set<string>, isSelected: boolean) {
    const previous = queryClient.getQueryData<{ campaigns: CampaignWithSelection[] }>(queryKey)
    queryClient.setQueryData<{ campaigns: CampaignWithSelection[] }>(queryKey, (old) => {
      if (!old) return old
      return {
        ...old,
        campaigns: old.campaigns.map((c) =>
          targetIds.has(c.id) ? { ...c, isSelected } : c,
        ),
      }
    })
    return previous
  }

  // Roy 2026-05-22 bug: clicking a campaign sometimes appeared to
  // un-click itself. Two reasons combined:
  //
  //   1. The GET response carried a `Cache-Control: s-maxage=60`
  //      header so the refetch after a POST occasionally served the
  //      pre-click cached body — overwriting the optimistic state.
  //   2. The POST handler never checked Supabase's upsert error, so a
  //      silent constraint / RLS failure returned ok:true while the
  //      DB hadn't actually written — and the next GET read the OLD
  //      state, again overwriting the optimistic UI.
  //
  // Both server-side issues are fixed. On this client side we also
  // stop blindly refetching after every toggle: the optimistic update
  // IS the source of truth for the row's selected flag, and the GET
  // only adds server-computed extras (auto-select rows, isSuggested
  // badges) that don't change on each individual click. We still
  // surface the error path so a failed POST visibly rolls back.
  async function postSelection(
    targets: Array<{ campaignId: string; campaignName: string; isSelected: boolean }>,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/clients/${mondayItemId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          targets.length === 1
            ? targets[0]
            : { campaigns: targets },
        ),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return { ok: false, error: data?.error ?? `HTTP ${res.status}` }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Network error" }
    }
  }

  async function toggleCampaign(campaign: CampaignWithSelection) {
    const next = !campaign.isSelected
    const snapshot = applyOptimistic(new Set([campaign.id]), next)
    const result = await postSelection([
      { campaignId: campaign.id, campaignName: campaign.name, isSelected: next },
    ])
    if (!result.ok) {
      // Roll back the cache to the pre-click snapshot so the UI matches
      // server truth. Without this the optimistic flip would persist
      // until a manual refresh.
      if (snapshot) queryClient.setQueryData(queryKey, snapshot)
      console.error("[campaign-selector] toggle failed:", result.error)
      return
    }
    // Notify the parent so it can refresh sibling queries (KPIs etc.)
    // that depend on which campaigns are tracked.
    onSelectionChange()
  }

  async function bulkSetSelection(targets: CampaignWithSelection[], isSelected: boolean) {
    if (targets.length === 0) return
    const snapshot = applyOptimistic(new Set(targets.map((c) => c.id)), isSelected)
    const result = await postSelection(
      targets.map((c) => ({
        campaignId: c.id,
        campaignName: c.name,
        isSelected,
      })),
    )
    if (!result.ok) {
      if (snapshot) queryClient.setQueryData(queryKey, snapshot)
      console.error("[campaign-selector] bulk toggle failed:", result.error)
      return
    }
    onSelectionChange()
  }

  const { selectedAll, availableAll, inactiveCount } = useMemo(() => {
    const selectedAll = campaigns.filter((c) => c.isSelected)
    // Available = not selected. Filter by status here so the tab counts
    // match what the CM actually sees in the list below.
    const availableAll = campaigns
      .filter((c) => !c.isSelected)
      .filter((c) => showInactive || c.status === "ACTIVE")
      .sort(
        (a, b) =>
          Number(b.isSuggested ?? false) - Number(a.isSuggested ?? false) ||
          a.name.localeCompare(b.name),
      )
    const inactiveCount = campaigns.filter(
      (c) => !c.isSelected && c.status !== "ACTIVE",
    ).length
    return { selectedAll, availableAll, inactiveCount }
  }, [campaigns, showInactive])

  // Search applies to both tab contents.
  const q = search.trim().toLowerCase()
  const selected = q
    ? selectedAll.filter((c) => c.name.toLowerCase().includes(q))
    : selectedAll
  const available = q
    ? availableAll.filter((c) => c.name.toLowerCase().includes(q))
    : availableAll

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  if (campaigns.length === 0) {
    return <p className="text-sm text-muted-foreground">Geen campagnes gevonden op dit ad account.</p>
  }

  const list = view === "selected" ? selected : available
  const visibleAll = view === "selected" ? selectedAll : availableAll
  const allVisibleSelected = list.length > 0 && view === "selected"

  return (
    <div className="space-y-3">
      {/* Search — applies to both tabs */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70 pointer-events-none" />
        <Input
          placeholder="Zoek campagnes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Two-tab switcher */}
      <TopTabs<View>
        tabs={[
          { id: "selected", label: "Geselecteerd", count: selectedAll.length, icon: Check },
          { id: "available", label: "Beschikbaar", count: availableAll.length },
        ]}
        value={view}
        onChange={setView}
        rightContent={
          <div className="flex items-center gap-1">
            {view === "available" && inactiveCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-7"
                onClick={() => setShowInactive((v) => !v)}
              >
                {showInactive
                  ? `Verberg inactief (${inactiveCount})`
                  : `Toon inactief (${inactiveCount})`}
              </Button>
            )}
            {visibleAll.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-7"
                onClick={() =>
                  bulkSetSelection(visibleAll, view === "available")
                }
              >
                {view === "selected" ? "Deselecteer alle" : "Selecteer alle"}
              </Button>
            )}
          </div>
        }
      />

      {/* Empty / count line */}
      <p className="text-xs text-muted-foreground">
        {view === "selected" ? (
          selected.length === 0 && q ? (
            "Geen geselecteerde campagne matcht je zoekopdracht."
          ) : selected.length === 0 ? (
            "Geen campagnes geselecteerd — alle spend telt mee in KPI's."
          ) : (
            `${selected.length} ${
              selected.length === 1 ? "campagne" : "campagnes"
            } voedt momenteel de KPI's voor deze klant.`
          )
        ) : available.length === 0 && q ? (
          "Geen beschikbare campagne matcht je zoekopdracht."
        ) : available.length === 0 ? (
          "Geen beschikbare campagnes — alle actieve campagnes zijn al gekoppeld."
        ) : (
          `${available.length} ${
            available.length === 1 ? "campagne" : "campagnes"
          } beschikbaar om te selecteren.`
        )}
      </p>

      {/* List */}
      <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
        {list.map((campaign) => (
          <CampaignRow
            key={campaign.id}
            campaign={campaign}
            onToggle={() => toggleCampaign(campaign)}
          />
        ))}
      </div>
    </div>
  )
}

function CampaignRow({
  campaign,
  onToggle,
}: {
  campaign: CampaignWithSelection
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "w-full flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left cursor-pointer transition-all",
        campaign.isSelected
          ? "border-primary/40 bg-primary/10 hover:bg-primary/15"
          : campaign.isSuggested
            ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
            : "border-border/60 bg-card hover:border-border hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "h-4 w-4 rounded-[4px] border-[1.5px] flex items-center justify-center shrink-0 transition-colors",
          campaign.isSelected
            ? "bg-primary border-primary text-primary-foreground"
            : "border-border bg-card",
        )}
      >
        {campaign.isSelected && (
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
        )}
      </span>
      <span
        className={cn(
          "flex-1 text-sm truncate",
          campaign.isSelected && "font-medium",
        )}
      >
        {campaign.name}
      </span>
      {campaign.isSuggested && !campaign.isSelected && (
        <Badge
          variant="outline"
          className="text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 shrink-0"
          title="De matcher denkt dat deze campagne bij deze klant hoort. Klik om te bevestigen."
        >
          Suggested
        </Badge>
      )}
      <Badge
        variant="outline"
        className={cn("text-[10px] shrink-0", STATUS_COLORS[campaign.status] ?? "")}
      >
        {campaign.status}
      </Badge>
    </button>
  )
}
