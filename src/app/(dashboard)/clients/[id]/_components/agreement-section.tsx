"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Check, Handshake } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  PLATFORMS,
  type Agreement,
  type Platform,
  agreementMonthly,
} from "@/lib/clients/agreement"
import { BillingSectionShell } from "./billing-section-shell"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"

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

/**
 * Single-campaign agreement editor. Each Monday client row is its own
 * campaign, so this section captures exactly what RL invoices for THIS row.
 * When two Monday rows share a Stripe customer (e.g. "O2 Plus | B2B" and
 * "O2 Plus | B2C"), each carries its own ad budget + platform fees here, and
 * the Billing page consolidates them into a single invoice at send time.
 */
export function AgreementSection({ mondayItemId }: Props) {
  const locale = useLocale()
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

  // Local draft - fed by the server fetch on first load and after each save.
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
      <BillingSectionShell icon={Handshake} title={t("client.agreement.title", locale)} subtitle={t("client.agreement.subtitle", locale)}>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </BillingSectionShell>
    )
  }

  if (query.isError) {
    return (
      <BillingSectionShell icon={Handshake} title={t("client.agreement.title", locale)} subtitle={t("client.agreement.subtitle", locale)}>
        <div className="py-6 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : t("client.agreement.error.load_failed", locale)}
        </div>
      </BillingSectionShell>
    )
  }

  const mrr = agreementMonthly(draft)

  function patch(p: Partial<Agreement>) {
    setDraft((d) => (d ? { ...d, ...p } : d))
  }

  function togglePlatform(p: Platform) {
    if (!draft) return
    const has = draft.platforms.includes(p)
    const nextPlatforms = has
      ? draft.platforms.filter((x) => x !== p)
      : [...draft.platforms, p]
    // Seed a fee at 0 the first time a platform is selected, but preserve any
    // previously entered amount when re-selecting after a deselect.
    const nextFees = { ...draft.platform_fees }
    if (!has && nextFees[p] === undefined) nextFees[p] = 0
    patch({ platforms: nextPlatforms, platform_fees: nextFees })
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
      if (!res.ok) throw new Error(data.error ?? t("client.agreement.error.save_failed", locale))
      await queryClient.invalidateQueries({ queryKey })
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("client.agreement.error.save_failed", locale))
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    if (query.data) setDraft(query.data)
    setError(null)
  }

  return (
    <BillingSectionShell
      icon={Handshake}
      title={t("client.agreement.title", locale)}
      subtitle={t("client.agreement.subtitle", locale)}
    >
      {/* Totals - same SummaryCard pattern as the invoices section above */}
      <div className="grid grid-cols-2 gap-3">
        <SummaryCard title={t("client.billing.summary.mrr", locale)} value={fmtEuro(mrr)} sub={t("client.billing.summary.mrr.sub", locale)} />
        <SummaryCard title={t("client.billing.summary.ad_budget", locale)} value={fmtEuro(draft.ad_budget)} sub={t("client.billing.summary.ad_budget.sub", locale)} />
      </div>

      <div className="rounded-md border bg-card p-4 space-y-2">
        <FieldRow label={t("client.agreement.field.ad_budget", locale)}>
          <EuroInput
            value={draft.ad_budget}
            onChange={(v) => patch({ ad_budget: v })}
            className="w-32"
          />
        </FieldRow>

        <FieldRow label={t("client.agreement.field.platforms", locale)}>
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => {
              const active = draft.platforms.includes(p)
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

        {draft.platforms.map((p) => (
          <FieldRow key={p} label={t("client.agreement.field.platform_fee", locale, { platform: PLATFORM_LABEL[p] })}>
            <EuroInput
              value={draft.platform_fees[p] ?? 0}
              onChange={(v) =>
                patch({ platform_fees: { ...draft.platform_fees, [p]: v } })
              }
              className="w-32"
            />
          </FieldRow>
        ))}

        <FieldRow label={t("client.agreement.field.follow_up", locale)}>
          <div className="flex items-center gap-3">
            <ToggleSwitch
              on={draft.follow_up}
              onChange={(v) => patch({ follow_up: v })}
            />
            <span
              className={cn(
                "text-xs",
                draft.follow_up ? "text-foreground" : "text-muted-foreground/60",
              )}
            >
              {draft.follow_up
                ? t("client.agreement.follow_up.by_rl", locale)
                : t("client.agreement.follow_up.by_client", locale)}
            </span>
          </div>
        </FieldRow>

        {draft.follow_up && (
          <FieldRow label={t("client.agreement.field.follow_up_fee", locale)}>
            <EuroInput
              value={draft.follow_up_fee}
              onChange={(v) => patch({ follow_up_fee: v })}
              className="w-32"
            />
          </FieldRow>
        )}

        <FieldRow label={t("client.agreement.field.notes", locale)}>
          <Input
            value={draft.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder={t("client.agreement.notes.optional", locale)}
            className="h-8 text-sm"
          />
        </FieldRow>
      </div>

      {(dirty || error || savedFlash) && (
        <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2">
          <span className="text-xs">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : savedFlash ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-500">
                <Check className="h-3.5 w-3.5" /> {t("client.agreement.status.saved", locale)}
              </span>
            ) : (
              <span className="text-muted-foreground">{t("client.agreement.status.unsaved", locale)}</span>
            )}
          </span>
          {dirty && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={discard} disabled={saving}>
                {t("client.agreement.action.discard", locale)}
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("client.agreement.action.save", locale)}
              </Button>
            </div>
          )}
        </div>
      )}
    </BillingSectionShell>
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

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 items-center">
      <Label className="text-[12px] text-muted-foreground">{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Matches the toggle pattern used in KpiVisibilityToggle so settings across
 *  the dashboard feel consistent - green when on, muted when off. */
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
