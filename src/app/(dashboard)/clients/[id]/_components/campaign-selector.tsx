"use client"

import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Check, Search, Loader2 } from "lucide-react"
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

/**
 * Campaign selection panel for the client detail page.
 *
 * Roy 2026-05-22 (second pass):
 *   - Search input moved below the tab strip so it visually belongs to
 *     the active tab.
 *   - Dropped the "Verberg inactief" toggle — both active and inactive
 *     campaigns are shown in every tab, with status surfaced as a small
 *     coloured dot per row (green=ACTIVE, amber=PAUSED, grey=ARCHIVED).
 *   - Sorted active first within each tab so the relevant rows are
 *     always at the top.
 *   - Added a "Opgeslagen" / "Bezig met opslaan…" badge near the tabs
 *     so the CM has visual confirmation that toggles persisted (this
 *     was the missing trust signal that made Roy think selections
 *     weren't saving).
 */
export function CampaignSelector({ campaigns, isLoading, mondayItemId, onSelectionChange }: Props) {
  const queryClient = useQueryClient()
  const [view, setView] = useState<View>("selected")
  const [search, setSearch] = useState("")
  const [savingCount, setSavingCount] = useState(0)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const queryKey = ["campaigns", mondayItemId]

  // Optimistically flip the selection in the React Query cache so the UI
  // updates instantly. Returns the previous snapshot for rollback.
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

  async function postSelection(
    targets: Array<{ campaignId: string; campaignName: string; isSelected: boolean }>,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/clients/${mondayItemId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          targets.length === 1 ? targets[0] : { campaigns: targets },
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
    setSavingCount((c) => c + 1)
    const result = await postSelection([
      { campaignId: campaign.id, campaignName: campaign.name, isSelected: next },
    ])
    setSavingCount((c) => c - 1)
    if (!result.ok) {
      if (snapshot) queryClient.setQueryData(queryKey, snapshot)
      console.error("[campaign-selector] toggle failed:", result.error)
      return
    }
    setSavedAt(Date.now())
    onSelectionChange()
  }

  async function bulkSetSelection(targets: CampaignWithSelection[], isSelected: boolean) {
    if (targets.length === 0) return
    const snapshot = applyOptimistic(new Set(targets.map((c) => c.id)), isSelected)
    setSavingCount((c) => c + 1)
    const result = await postSelection(
      targets.map((c) => ({
        campaignId: c.id,
        campaignName: c.name,
        isSelected,
      })),
    )
    setSavingCount((c) => c - 1)
    if (!result.ok) {
      if (snapshot) queryClient.setQueryData(queryKey, snapshot)
      console.error("[campaign-selector] bulk toggle failed:", result.error)
      return
    }
    setSavedAt(Date.now())
    onSelectionChange()
  }

  // Sort: ACTIVE first, then PAUSED, then everything else; alphabetical
  // within each status bucket. Roy: actieve bovenaan zodat de CM die als
  // eerste ziet — inactieven blijven zichtbaar maar staan onderaan.
  const STATUS_RANK: Record<string, number> = {
    ACTIVE: 0,
    PAUSED: 1,
    ARCHIVED: 2,
  }
  function statusSort(a: CampaignWithSelection, b: CampaignWithSelection): number {
    const ra = STATUS_RANK[a.status] ?? 99
    const rb = STATUS_RANK[b.status] ?? 99
    if (ra !== rb) return ra - rb
    return a.name.localeCompare(b.name)
  }

  const { selectedAll, availableAll } = useMemo(() => {
    const selectedAll = campaigns.filter((c) => c.isSelected).sort(statusSort)
    const availableAll = campaigns
      .filter((c) => !c.isSelected)
      .sort(
        (a, b) =>
          // Suggested rows surface to the top of Available so the CM
          // sees them first; otherwise fall through to status sort.
          Number(b.isSuggested ?? false) - Number(a.isSuggested ?? false) || statusSort(a, b),
      )
    return { selectedAll, availableAll }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns])

  // Search applies to the active tab only.
  const q = search.trim().toLowerCase()
  const selected = q
    ? selectedAll.filter((c) => c.name.toLowerCase().includes(q))
    : selectedAll
  const available = q
    ? availableAll.filter((c) => c.name.toLowerCase().includes(q))
    : availableAll
  const list = view === "selected" ? selected : available
  const visibleAll = view === "selected" ? selectedAll : availableAll

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

  return (
    <div className="space-y-3">
      {/* Tab strip + save indicator. Search lives BELOW per Roy 2026-05-22 —
          it visually belongs to the active tab's list. */}
      <TopTabs<View>
        tabs={[
          { id: "selected", label: "Geselecteerd", count: selectedAll.length, icon: Check },
          { id: "available", label: "Beschikbaar", count: availableAll.length },
        ]}
        value={view}
        onChange={setView}
        rightContent={
          <div className="flex items-center gap-2">
            {/* Save indicator — feedback that toggles actually persisted.
                Was missing; Roy thought selections were silently dropping. */}
            <SaveIndicator savingCount={savingCount} savedAt={savedAt} />
            {visibleAll.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-7"
                onClick={() => bulkSetSelection(visibleAll, view === "available")}
              >
                {view === "selected" ? "Deselecteer alle" : "Selecteer alle"}
              </Button>
            )}
          </div>
        }
      />

      {/* Per-tab search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70 pointer-events-none" />
        <Input
          placeholder={
            view === "selected"
              ? "Zoek in geselecteerd…"
              : "Zoek in beschikbaar…"
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Count line */}
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
          "Alle campagnes op dit account zijn al gekoppeld."
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

function SaveIndicator({
  savingCount,
  savedAt,
}: {
  savingCount: number
  savedAt: number | null
}) {
  // Saving: spinner + "Opslaan…". Recently saved (≤3s): green ✓ + "Opgeslagen".
  // Otherwise nothing — silence is the resting state.
  const [, force] = useState(0)
  useMemo(() => {
    if (!savedAt) return
    const t = setTimeout(() => force((x) => x + 1), 3500)
    return () => clearTimeout(t)
  }, [savedAt])

  if (savingCount > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Opslaan…
      </span>
    )
  }
  if (savedAt && Date.now() - savedAt < 3000) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <Check className="h-3 w-3" strokeWidth={3} />
        Opgeslagen
      </span>
    )
  }
  return null
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "ACTIVE"
      ? "bg-emerald-500"
      : status === "PAUSED"
        ? "bg-amber-500"
        : "bg-muted-foreground/40"
  return (
    <span
      className={cn("h-2 w-2 rounded-full shrink-0", color)}
      title={status}
      aria-label={status}
    />
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
      <StatusDot status={campaign.status} />
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
    </button>
  )
}
