"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { Sparkles, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle, Copy, Check } from "lucide-react"
import { ClientPicker } from "./client-picker"
import type { PedroClient } from "../page"

/**
 * Pedro's first optimisation stage — Creative Refresh.
 *
 * The CM picks a Live client + a window (default 30d), Pedro reads live
 * Meta performance via /api/pedro/creative-refresh, finds winners, and
 * proposes 3 iterations per winner in the same hook/angle/format DNA.
 *
 * No budget recommendations, no copy-pasting losers — per the principles
 * baked into knowledge/campaigns.md and the system prompt.
 */

type Proposal = {
  basedOnAd: { adId: string; adName: string; cpl: number | null; verdict: string }
  preserve: { hook: string; angle: string; format: string }
  variants: Array<{
    label: string
    newHook: string
    scriptOutline: string
    primaryCopySnippet: string
    why: string
  }>
}

type RefreshResponse =
  | {
      mode: "iterate-winners"
      clientId: string
      clientName: string
      window: { start: string; end: string; days: number }
      stats: {
        totalSpend: number
        totalLeads: number
        avgCpl: number | null
        avgCtr: number | null
        winnerCount: number
        loserCount: number
      }
      trend: { spendDeltaPct: number | null; leadsDeltaPct: number | null; cplDeltaPct: number | null }
      proposals: Proposal[]
      summary: string
      warnings: string[]
    }
  | {
      mode: "no-winners"
      clientId: string
      clientName: string
      window: { start: string; end: string; days: number }
      summary: string
      warnings: string[]
    }

const WINDOW_OPTIONS = [
  { value: 7, label: "7 dagen" },
  { value: 14, label: "14 dagen" },
  { value: 30, label: "30 dagen" },
  { value: 60, label: "60 dagen" },
] as const

function formatEuro(n: number): string {
  return `€${n.toLocaleString("nl-NL", { maximumFractionDigits: 0 })}`
}

function TrendArrow({ pct }: { pct: number | null }) {
  if (pct == null) return <Minus className="h-3.5 w-3.5 text-muted-foreground/60" />
  if (Math.abs(pct) < 5) return <Minus className="h-3.5 w-3.5 text-muted-foreground/60" />
  return pct > 0 ? (
    <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
  ) : (
    <TrendingDown className="h-3.5 w-3.5 text-red-500" />
  )
}

function StatBlock({
  label,
  value,
  trend,
  goodIs,
}: {
  label: string
  value: string
  trend?: number | null
  /** "up" = positive trend is good (leads), "down" = negative is good (CPL). */
  goodIs?: "up" | "down"
}) {
  let trendColor = "text-muted-foreground"
  if (trend != null && Math.abs(trend) >= 5) {
    const isGood = goodIs === "up" ? trend > 0 : trend < 0
    trendColor = isGood ? "text-emerald-500" : "text-red-500"
  }
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-card p-3">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
        {label}
      </div>
      <div className="font-heading text-lg font-semibold leading-tight">{value}</div>
      {trend != null && (
        <div className={`inline-flex items-center gap-1 text-xs ${trendColor}`}>
          <TrendArrow pct={trend} />
          {trend >= 0 ? "+" : ""}
          {trend.toFixed(0)}% vs vorige periode
        </div>
      )}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className={`inline-flex items-center gap-1 h-6 px-2 text-[10px] font-medium border rounded-md transition-colors ${
        copied
          ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/40"
          : "text-muted-foreground hover:text-foreground hover:bg-accent border-border"
      }`}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Gekopieerd" : "Kopieer"}
    </button>
  )
}

type Props = {
  clients: PedroClient[]
  /** Pre-select a client via URL param (e.g. from Watch List "Ask Pedro"). */
  initialClientId?: string | null
  /** When true, fire generate() automatically once the client is set. */
  autoStart?: boolean
}

export function PedroRefresh({ clients, initialClientId, autoStart }: Props) {
  // Only Live clients are relevant for refresh — onboarding clients have no
  // performance data yet.
  const liveClients = useMemo(
    () => clients.filter((c) => c.boardType === "current" || c.hasSavedCampaign),
    [clients],
  )

  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    initialClientId ?? null,
  )
  const [selectedClientName, setSelectedClientName] = useState<string>(
    initialClientId
      ? clients.find((c) => c.id === initialClientId)?.name ?? ""
      : "",
  )
  const [days, setDays] = useState<number>(30)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<RefreshResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleClientSelect = useCallback((clientId: string, clientName: string) => {
    setSelectedClientId(clientId)
    setSelectedClientName(clientName)
    setData(null)
    setError(null)
  }, [])

  const generate = useCallback(async () => {
    if (!selectedClientId) return
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const res = await fetch("/api/pedro/creative-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClientId, days }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || `HTTP ${res.status}`)
      } else {
        setData(json as RefreshResponse)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout")
    }
    setLoading(false)
  }, [selectedClientId, days])

  // Auto-fire when arriving via URL (?clientId=X&auto=1 — e.g. the Watch
  // List "Ask Pedro" button). Only once per mount, only when explicitly
  // requested. Otherwise the CM has to click "Genereer" themselves.
  const autoFiredRef = useRef(false)
  useEffect(() => {
    if (autoFiredRef.current) return
    if (!autoStart) return
    if (!selectedClientId) return
    autoFiredRef.current = true
    void generate()
  }, [autoStart, selectedClientId, generate])

  return (
    <div className="max-w-[1060px] space-y-5">
      {/* Picker + window + generate */}
      <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04),0_1px_3px_-1px_rgb(0_0_0_/_0.04)] dark:shadow-[0_1px_2px_0_rgb(0_0_0_/_0.3)]">
        <div className="mb-4">
          <div className="font-heading font-semibold text-[15px] tracking-tight">
            Creative refresh
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Pedro leest live Meta performance, vindt winners en stelt 3 iteraties per winner voor — zelfde DNA, frisse executie.
          </div>
        </div>

        <ClientPicker
          clients={liveClients}
          selectedId={selectedClientId}
          onSelect={handleClientSelect}
          onAutoFill={generate}
          loading={loading}
        />

        <div className="flex items-center gap-3 mt-3">
          <div className="text-xs text-muted-foreground">Window:</div>
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDays(opt.value)}
              className={`text-xs font-medium px-2.5 py-1 rounded-md border transition-colors ${
                days === opt.value
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:bg-accent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {selectedClientId && !data && !loading && !error && (
          <div className="mt-4">
            <button
              type="button"
              onClick={generate}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Genereer refresh-proposals
            </button>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="rounded-2xl border border-border/60 bg-card p-5 flex items-center gap-3">
          <RefreshCw className="h-4 w-4 text-primary animate-spin" />
          <span className="text-sm text-muted-foreground">
            Pedro pakt performance van &quot;{selectedClientName}&quot; over {days}d, zoekt winners en schrijft proposals…
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5">
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        </div>
      )}

      {/* Result */}
      {data && data.mode === "no-winners" && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-2">
          <div className="font-heading font-semibold text-[14px] tracking-tight">
            Geen winners in {data.window.days}d window
          </div>
          <div className="text-sm text-muted-foreground">{data.summary}</div>
          {data.warnings.length > 0 && (
            <ul className="text-xs text-muted-foreground/70 list-disc pl-5 mt-2 space-y-0.5">
              {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}

      {data && data.mode === "iterate-winners" && (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatBlock
              label={`Spend ${data.window.days}d`}
              value={formatEuro(data.stats.totalSpend)}
              trend={data.trend.spendDeltaPct}
            />
            <StatBlock
              label="Leads"
              value={data.stats.totalLeads.toString()}
              trend={data.trend.leadsDeltaPct}
              goodIs="up"
            />
            <StatBlock
              label="Avg CPL"
              value={data.stats.avgCpl != null ? `€${data.stats.avgCpl.toFixed(2)}` : "—"}
              trend={data.trend.cplDeltaPct}
              goodIs="down"
            />
            <StatBlock
              label="Winners / losers"
              value={`${data.stats.winnerCount} / ${data.stats.loserCount}`}
            />
          </div>

          {/* Pedro's summary */}
          {data.summary && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="text-sm text-foreground leading-relaxed">{data.summary}</div>
              </div>
            </div>
          )}

          {/* Proposals */}
          {data.proposals.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card p-5 text-sm text-muted-foreground">
              Pedro vond winners maar gaf geen proposals terug. Probeer opnieuw of kies een ander window.
            </div>
          ) : (
            <div className="space-y-4">
              {data.proposals.map((p, i) => (
                <div
                  key={`${p.basedOnAd.adId}-${i}`}
                  className="rounded-2xl border border-border/60 bg-card p-5 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)]"
                >
                  <div className="flex items-start justify-between mb-4 gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-400 font-semibold mb-1">
                        Itereren op winner
                      </div>
                      <div className="font-heading font-semibold text-[15px] tracking-tight truncate">
                        {p.basedOnAd.adName}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        CPL {p.basedOnAd.cpl != null ? `€${p.basedOnAd.cpl.toFixed(2)}` : "—"}
                        {" · "}
                        Behoud: {p.preserve.hook} / {p.preserve.angle} / {p.preserve.format}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {p.variants.map((v, vi) => (
                      <div
                        key={vi}
                        className="rounded-lg border border-border/60 bg-background p-4 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-heading font-semibold text-sm">{v.label}</div>
                          <CopyButton
                            text={`Hook: ${v.newHook}\n\nScript outline:\n${v.scriptOutline}\n\nPrimary copy:\n${v.primaryCopySnippet}`}
                          />
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
                            Hook
                          </div>
                          <div className="text-sm text-foreground">{v.newHook}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
                            Script outline
                          </div>
                          <div className="text-sm text-foreground whitespace-pre-line">{v.scriptOutline}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
                            Primary copy
                          </div>
                          <div className="text-sm text-foreground">{v.primaryCopySnippet}</div>
                        </div>
                        <div className="text-xs text-muted-foreground italic pt-1 border-t border-border/40">
                          Waarom: {v.why}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-5 space-y-0.5">
                {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={generate}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium rounded-md border border-border bg-transparent text-foreground hover:bg-accent transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Genereer opnieuw
            </button>
          </div>
        </>
      )}
    </div>
  )
}
