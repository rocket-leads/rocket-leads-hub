"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  Sparkles,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Copy,
  Check,
  Inbox,
  CloudUpload,
  History,
  ChevronDown,
  Loader2,
  ExternalLink,
} from "lucide-react"
import type { RefreshEnvelope } from "@/lib/pedro/refresh-shared"
import { cn } from "@/lib/utils"
import type { RefreshHistoryRow } from "@/app/api/pedro/refreshes/route"

export type RefreshStage = "creatives" | "angles" | "script" | "ad_copy"

/**
 * Shared UI shell for every per-stage Pedro refresh component
 * (angles-refresh, script-refresh, creative-refresh, ad-copy-refresh).
 *
 * Each stage component supplies:
 *  - `endpoint` — the /api/pedro/*-refresh URL
 *  - `title` + `description` — what shows in the header card
 *  - `renderProposals(envelope)` — stage-specific renderer for the proposals
 *    when mode === "iterate-winners"
 *
 * Everything else (window picker, generate button, stats grid, summary
 * banner, no-winners path, warnings, regenerate) is handled here.
 */

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

/** Tiny copy-to-clipboard button used by every per-stage proposal card. */
export function CopyButton({ text }: { text: string }) {
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

type Props<TProposal> = {
  endpoint: string
  /** Stage discriminator — drives the history panel + save endpoints.
   *  Same enum as `pedro_refreshes.stage`. Default `creatives` for
   *  backwards compatibility with components that haven't passed it yet. */
  stage?: RefreshStage
  title: string
  description: string
  selectedClientId: string | null
  selectedClientName: string
  autoStart?: boolean
  /** Renders the iterate-winners proposals. Receives the parsed envelope. */
  renderProposals: (env: Extract<RefreshEnvelope<TProposal>, { mode: "iterate-winners" }>) => ReactNode
}

export function RefreshShell<TProposal>({
  endpoint,
  stage = "creatives",
  title,
  description,
  selectedClientId,
  selectedClientName,
  autoStart,
  renderProposals,
}: Props<TProposal>) {
  const [days, setDays] = useState<number>(30)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<RefreshEnvelope<TProposal> | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Reset output state whenever the active client changes externally.
  useEffect(() => {
    setData(null)
    setError(null)
  }, [selectedClientId])

  const generate = useCallback(async () => {
    if (!selectedClientId) return
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClientId, days }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || `HTTP ${res.status}`)
      } else {
        setData(json as RefreshEnvelope<TProposal>)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout")
    }
    setLoading(false)
  }, [selectedClientId, days, endpoint])

  // Auto-fire when arriving via URL (?auto=1). Only once per mount.
  const autoFiredRef = useRef(false)
  useEffect(() => {
    if (autoFiredRef.current) return
    if (!autoStart) return
    if (!selectedClientId) return
    autoFiredRef.current = true
    void generate()
  }, [autoStart, selectedClientId, generate])

  // Load a historical refresh into the result view (no Anthropic call).
  // Re-uses the same renderer pipeline; UI doesn't distinguish live vs
  // historical past this point.
  const loadHistorical = useCallback(async (refreshId: string) => {
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const res = await fetch(`/api/pedro/refreshes/${encodeURIComponent(refreshId)}`)
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || `HTTP ${res.status}`)
      } else {
        setData(json as RefreshEnvelope<TProposal>)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout")
    }
    setLoading(false)
  }, [])

  return (
    <div className="max-w-[1060px] space-y-5">
      {/* History panel — collapsed by default, expanding shows past
          refresh runs for this client. Click on a row → loads that
          refresh back into the result view (no Anthropic call). Roy
          2026-06-09: zonder dit voelt elke refresh als wegwerp. */}
      {selectedClientId && (
        <RefreshHistoryPanel
          clientId={selectedClientId}
          stage={stage}
          onPick={loadHistorical}
        />
      )}

      {/* Picker + window + generate */}
      <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04),0_1px_3px_-1px_rgb(0_0_0_/_0.04)] dark:shadow-[0_1px_2px_0_rgb(0_0_0_/_0.3)]">
        <div className="mb-4">
          <div className="font-heading font-semibold text-[15px] tracking-tight">{title}</div>
          <div className="text-xs text-muted-foreground mt-1">{description}</div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 mb-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Actieve klant:</span>{" "}
            <span className="font-medium text-foreground">{selectedClientName || "—"}</span>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={!selectedClientId || loading}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm whitespace-nowrap"
          >
            {loading ? "Pedro denkt na..." : "Genereer refresh"}
          </button>
        </div>

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

      {/* No-winners result */}
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

      {/* Iterate-winners result */}
      {data && data.mode === "iterate-winners" && (
        <>
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

          {data.summary && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="text-sm text-foreground leading-relaxed">{data.summary}</div>
              </div>
            </div>
          )}

          {data.proposals.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card p-5 text-sm text-muted-foreground">
              Pedro vond winners maar gaf geen proposals terug. Probeer opnieuw of kies een ander window.
            </div>
          ) : (
            renderProposals(data)
          )}

          {data.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-5 space-y-0.5">
                {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={generate}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium rounded-md border border-border bg-transparent text-foreground hover:bg-accent transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Genereer opnieuw
            </button>
            {/* Save actions — both endpoints are idempotent so re-clicking
                returns the existing inbox/Drive reference without dupes. */}
            {data.refreshId && (
              <SaveActions
                refreshId={data.refreshId}
                clientName={data.clientName}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Save actions (inbox + Drive) ───────────────────────────────────────

function SaveActions({
  refreshId,
  clientName,
}: {
  refreshId: string
  clientName: string
}) {
  type SaveState = "idle" | "saving" | "saved" | "error"
  const [inboxState, setInboxState] = useState<SaveState>("idle")
  const [inboxMsg, setInboxMsg] = useState<string | null>(null)
  const [driveState, setDriveState] = useState<SaveState>("idle")
  const [driveUrl, setDriveUrl] = useState<string | null>(null)
  const [driveMsg, setDriveMsg] = useState<string | null>(null)

  async function saveToInbox() {
    setInboxState("saving")
    setInboxMsg(null)
    try {
      const res = await fetch(
        `/api/pedro/refreshes/${encodeURIComponent(refreshId)}/save-to-inbox`,
        { method: "POST" },
      )
      const json = await res.json()
      if (!res.ok || json.error) {
        setInboxState("error")
        setInboxMsg(json.error || `HTTP ${res.status}`)
        return
      }
      setInboxState("saved")
      setInboxMsg(json.alreadySaved ? "Al opgeslagen" : "Opgeslagen in je Updates inbox")
    } catch (e) {
      setInboxState("error")
      setInboxMsg(e instanceof Error ? e.message : "Onbekende fout")
    }
  }

  async function saveToDrive() {
    setDriveState("saving")
    setDriveMsg(null)
    try {
      const res = await fetch(
        `/api/pedro/refreshes/${encodeURIComponent(refreshId)}/save-to-drive`,
        { method: "POST" },
      )
      const json = await res.json()
      if (!res.ok || json.error) {
        setDriveState("error")
        setDriveMsg(json.error || `HTTP ${res.status}`)
        return
      }
      setDriveState("saved")
      setDriveUrl(json.url ?? null)
      setDriveMsg(json.alreadySaved ? "Al in Drive" : `Geplaatst in ${clientName} Drive folder`)
    } catch (e) {
      setDriveState("error")
      setDriveMsg(e instanceof Error ? e.message : "Onbekende fout")
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={saveToInbox}
        disabled={inboxState === "saving" || inboxState === "saved"}
        className={cn(
          "inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium rounded-md transition-colors disabled:cursor-default",
          inboxState === "saved"
            ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "border border-border bg-card text-foreground hover:bg-accent",
        )}
      >
        {inboxState === "saving" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : inboxState === "saved" ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Inbox className="h-3.5 w-3.5" />
        )}
        {inboxState === "saved" ? "In je inbox" : "Bewaar in mijn inbox"}
      </button>

      {driveState === "saved" && driveUrl ? (
        <a
          href={driveUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15 transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open in Drive
        </a>
      ) : (
        <button
          type="button"
          onClick={saveToDrive}
          disabled={driveState === "saving"}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium rounded-md border border-border bg-card text-foreground hover:bg-accent transition-colors disabled:opacity-50"
        >
          {driveState === "saving" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CloudUpload className="h-3.5 w-3.5" />
          )}
          Bewaar in Drive
        </button>
      )}

      {(inboxMsg || driveMsg) && (
        <div className="w-full flex flex-col gap-1 mt-1">
          {inboxMsg && (
            <div
              className={cn(
                "text-xs",
                inboxState === "error" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
              )}
            >
              {inboxMsg}
            </div>
          )}
          {driveMsg && (
            <div
              className={cn(
                "text-xs",
                driveState === "error" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
              )}
            >
              {driveMsg}
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ─── History panel ──────────────────────────────────────────────────────

/** Collapsible list of past refresh runs for this client + stage. Click
 *  a row to load it back into the result view. Empty state stays
 *  collapsed-but-visible so the AM sees the affordance exists. */
function RefreshHistoryPanel({
  clientId,
  stage,
  onPick,
}: {
  clientId: string
  stage: RefreshStage
  onPick: (refreshId: string) => void
}) {
  const [rows, setRows] = useState<RefreshHistoryRow[] | null>(null)
  const [open, setOpen] = useState(false)
  const [loadingList, setLoadingList] = useState(false)

  // Refetch when the active client OR stage changes — history is
  // scoped to both.
  useEffect(() => {
    let cancelled = false
    setLoadingList(true)
    setRows(null)
    fetch(`/api/pedro/refreshes?clientId=${encodeURIComponent(clientId)}&stage=${stage}&limit=10`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        setRows(Array.isArray(json.refreshes) ? json.refreshes : [])
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false)
      })
    return () => {
      cancelled = true
    }
  }, [clientId, stage])

  const count = rows?.length ?? 0

  // Auto-collapse when there's no history to show (don't waste a row).
  if (rows !== null && count === 0 && !loadingList) {
    return null
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Eerdere refreshes</span>
          <span className="text-xs text-muted-foreground">
            {loadingList ? "laden…" : `(${count})`}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && rows && rows.length > 0 && (
        <div className="border-t border-border/60 divide-y divide-border/40">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r.id)}
              className="w-full text-left px-4 py-2.5 hover:bg-accent/40 transition-colors flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{r.generatedAt.slice(0, 10)}</span>
                  <span>·</span>
                  <span>
                    {r.windowDays}d ({r.windowStart} → {r.windowEnd})
                  </span>
                  <span>·</span>
                  <span>{r.proposalCount} proposal{r.proposalCount === 1 ? "" : "s"}</span>
                  {r.savedToInbox && (
                    <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                      <Inbox className="h-3 w-3" />
                      inbox
                    </span>
                  )}
                  {r.savedToDrive && (
                    <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                      <CloudUpload className="h-3 w-3" />
                      drive
                    </span>
                  )}
                </div>
                {r.summarySnippet && (
                  <div className="text-sm text-foreground/80 truncate mt-0.5">
                    {r.summarySnippet}
                  </div>
                )}
              </div>
              <span className="text-xs text-primary shrink-0 mt-0.5">Laad</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
