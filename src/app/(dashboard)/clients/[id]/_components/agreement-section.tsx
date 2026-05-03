"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2, Loader2, Check } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  PLATFORMS,
  type Agreement,
  type AgreementCampaign,
  type Platform,
  campaignMonthly,
  newCampaign,
  totalAdBudget,
  totalMRR,
} from "@/lib/clients/agreement"

const PLATFORM_LABEL: Record<Platform, string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
}

function fmtEuro(v: number): string {
  return `€${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
}

type Props = {
  mondayItemId: string
}

export function AgreementSection({ mondayItemId }: Props) {
  const queryClient = useQueryClient()
  const queryKey = ["agreement", mondayItemId]

  const query = useQuery<Agreement>({
    queryKey,
    queryFn: () =>
      fetch(`/api/clients/${mondayItemId}/agreement`).then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? "Failed to load agreement")
        return data
      }),
  })

  // Local draft — fed by the server fetch on first load and after each save.
  // Edits stay local until Save, so Discard is a one-click revert.
  const [draft, setDraft] = useState<Agreement | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    if (query.data && draft === null) setDraft(query.data)
  }, [query.data, draft])

  const dirty = useMemo(() => {
    if (!draft || !query.data) return false
    return JSON.stringify(draft) !== JSON.stringify(query.data)
  }, [draft, query.data])

  if (query.isLoading || !draft) {
    return (
      <div className="space-y-4">
        <Header />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="space-y-3">
        <Header />
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {query.error instanceof Error ? query.error.message : "Failed to load agreement."}
          </CardContent>
        </Card>
      </div>
    )
  }

  const mrr = totalMRR(draft.campaigns)
  const adBudget = totalAdBudget(draft.campaigns)

  function update(next: AgreementCampaign[]) {
    setDraft((d) => (d ? { ...d, campaigns: next } : d))
  }

  function patchCampaign(id: string, patch: Partial<AgreementCampaign>) {
    update(draft!.campaigns.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  function addCampaign() {
    update([...draft!.campaigns, newCampaign()])
  }

  function removeCampaign(id: string) {
    update(draft!.campaigns.filter((c) => c.id !== id))
  }

  async function save() {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${mondayItemId}/agreement`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Save failed")
      await queryClient.invalidateQueries({ queryKey })
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    if (query.data) setDraft(query.data)
    setError(null)
  }

  return (
    <div className="space-y-4">
      <Header onAdd={addCampaign} />

      {/* Totals — same SummaryCard pattern as the invoices section below */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryCard title="MRR" value={fmtEuro(mrr)} sub="recurring per month" />
        <SummaryCard title="Total ad budget" value={fmtEuro(adBudget)} sub="across all campaigns" />
        <SummaryCard
          title="Campaigns"
          value={String(draft.campaigns.length)}
          sub={draft.campaigns.length === 1 ? "campaign" : "campaigns"}
        />
      </div>

      {draft.campaigns.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
          No campaigns yet. Add the first one to capture what this client pays.
        </div>
      ) : (
        <div className="rounded-md border bg-card divide-y divide-border/60 overflow-hidden">
          {draft.campaigns.map((c, idx) => (
            <CampaignRow
              key={c.id}
              index={idx}
              total={draft.campaigns.length}
              campaign={c}
              onChange={(patch) => patchCampaign(c.id, patch)}
              onRemove={() => removeCampaign(c.id)}
            />
          ))}
        </div>
      )}

      {(dirty || error || savedFlash) && (
        <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2">
          <span className="text-xs">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : savedFlash ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-500">
                <Check className="h-3.5 w-3.5" /> Saved
              </span>
            ) : (
              <span className="text-muted-foreground">Unsaved changes</span>
            )}
          </span>
          {dirty && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={discard} disabled={saving}>
                Discard
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Header({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground/80">Agreement</h3>
        <p className="text-[11px] text-muted-foreground/60 mt-0.5">
          What this client pays per month, broken down per campaign.
        </p>
      </div>
      {onAdd && (
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" /> Add campaign
        </Button>
      )}
    </div>
  )
}

function SummaryCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function CampaignRow({
  index,
  total,
  campaign,
  onChange,
  onRemove,
}: {
  index: number
  total: number
  campaign: AgreementCampaign
  onChange: (patch: Partial<AgreementCampaign>) => void
  onRemove: () => void
}) {
  const monthly = campaignMonthly(campaign)

  function togglePlatform(p: Platform) {
    const has = campaign.platforms.includes(p)
    const nextPlatforms = has
      ? campaign.platforms.filter((x) => x !== p)
      : [...campaign.platforms, p]
    // Seed a fee at 0 the first time a platform is selected, but preserve any
    // previously entered amount when re-selecting after a deselect.
    const nextFees = { ...campaign.platform_fees }
    if (!has && nextFees[p] === undefined) nextFees[p] = 0
    onChange({ platforms: nextPlatforms, platform_fees: nextFees })
  }

  return (
    <div className="p-4 space-y-4">
      {/* Row header — campaign index, name, monthly subtotal, delete */}
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-medium text-muted-foreground/60 w-8 shrink-0 tabular-nums">
          {total > 1 ? `#${index + 1}` : ""}
        </span>
        <Input
          value={campaign.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Campaign name"
          className="flex-1 h-8 font-medium text-sm"
        />
        <div className="text-xs text-muted-foreground hidden sm:flex items-center gap-1.5 shrink-0">
          <span>Monthly</span>
          <span className="font-semibold tabular-nums text-foreground">{fmtEuro(monthly)}</span>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onRemove}
          title="Remove campaign"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="space-y-2 pl-8">
        <FieldRow label="Ad budget">
          <EuroInput
            value={campaign.ad_budget}
            onChange={(v) => onChange({ ad_budget: v })}
            className="w-32"
          />
        </FieldRow>

        <FieldRow label="Platforms">
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => {
              const active = campaign.platforms.includes(p)
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={cn(
                    "inline-flex items-center h-7 rounded-md border px-2.5 text-[12px] font-medium transition-colors",
                    active
                      ? "border-foreground/20 bg-foreground/[0.06] text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  {PLATFORM_LABEL[p]}
                </button>
              )
            })}
          </div>
        </FieldRow>

        {campaign.platforms.map((p) => (
          <FieldRow key={p} label={`${PLATFORM_LABEL[p]} fee`}>
            <EuroInput
              value={campaign.platform_fees[p] ?? 0}
              onChange={(v) =>
                onChange({ platform_fees: { ...campaign.platform_fees, [p]: v } })
              }
              className="w-32"
            />
          </FieldRow>
        ))}

        <FieldRow label="Lead follow-up">
          <div className="flex items-center gap-3">
            <ToggleSwitch
              on={campaign.follow_up}
              onChange={(v) => onChange({ follow_up: v })}
            />
            <span
              className={cn(
                "text-xs",
                campaign.follow_up ? "text-foreground" : "text-muted-foreground/60",
              )}
            >
              {campaign.follow_up ? "Done by Rocket Leads" : "Done by client"}
            </span>
          </div>
        </FieldRow>

        {campaign.follow_up && (
          <FieldRow label="Follow-up fee">
            <EuroInput
              value={campaign.follow_up_fee}
              onChange={(v) => onChange({ follow_up_fee: v })}
              className="w-32"
            />
          </FieldRow>
        )}

        <FieldRow label="Notes">
          <Input
            value={campaign.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            placeholder="Optional"
            className="h-8 text-sm"
          />
        </FieldRow>
      </div>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 items-center">
      <Label className="text-[12px] text-muted-foreground">{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Matches the toggle pattern used in KpiVisibilityToggle so settings across
 *  the dashboard feel consistent — green when on, muted when off. */
function ToggleSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200",
        on ? "bg-emerald-500" : "bg-muted-foreground/20",
      )}
      aria-pressed={on}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200",
          on ? "translate-x-[18px]" : "translate-x-[3px]",
        )}
      />
    </button>
  )
}

function EuroInput({
  value,
  onChange,
  className,
}: {
  value: number
  onChange: (v: number) => void
  className?: string
}) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-muted-foreground">
        €
      </span>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step={50}
        value={value === 0 ? "" : value}
        onChange={(e) => {
          const n = e.target.value === "" ? 0 : Number(e.target.value)
          onChange(isFinite(n) ? n : 0)
        }}
        placeholder="0"
        className="h-8 pl-6 pr-2 text-sm tabular-nums"
      />
    </div>
  )
}
