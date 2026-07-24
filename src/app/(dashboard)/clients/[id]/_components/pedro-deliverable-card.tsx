"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { FileText, Download, RefreshCw, Eye, Loader2 } from "lucide-react"
import { useHubMutation } from "@/lib/mutations/use-hub-mutation"

/**
 * Pedro "Deliverable #1" surface on the client home tab.
 *
 * Shows whether the per-client Pedro deliverable exists, when it was
 * last generated, and which saved stage versions went into it. Three
 * actions: View (inline modal), Download .md, Regenerate (re-reads
 * latest saved versions and upserts the row). When no deliverable
 * exists yet, the card collapses to a single line + "Generate" button.
 */

type DeliverableRow = {
  client_id: string
  campaign_number: number
  content_md: string
  metadata: Record<string, number | null> | null
  generated_at: string
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function PedroDeliverableCard({ mondayItemId }: { mondayItemId: string }) {
  const [viewOpen, setViewOpen] = useState(false)

  const deliverableQuery = useQuery({
    queryKey: ["pedro-deliverable", mondayItemId],
    queryFn: async (): Promise<DeliverableRow | null> => {
      const res = await fetch(`/api/pedro/deliverable?clientId=${encodeURIComponent(mondayItemId)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return (data?.deliverable ?? null) as DeliverableRow | null
    },
    staleTime: 30_000,
  })

  const generateMutation = useHubMutation({
    invalidates: [],
    mutationFn: async () => {
      const res = await fetch("/api/pedro/deliverable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: mondayItemId }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
      return data.deliverable as DeliverableRow
    },
    onSuccess: () => {
      void deliverableQuery.refetch()
    },
  })

  const deliverable = deliverableQuery.data
  const meta = deliverable?.metadata ?? {}
  const stagesIncluded = [
    ["Brief", meta.brief_version],
    ["Research", meta.research_version],
    ["Angles", meta.angles_version],
    ["Script", meta.script_version],
    ["Creatives", meta.creatives_version],
    ["LP", meta.lp_version],
    ["Ad copy", meta.ad_copy_version],
  ] as const

  function handleDownload() {
    if (!deliverable) return
    const blob = new Blob([deliverable.content_md], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `pedro-deliverable-${mondayItemId}-v${deliverable.campaign_number}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (deliverableQuery.isLoading) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card px-5 py-4 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Pedro deliverable laden…
      </div>
    )
  }

  // Empty state - no deliverable saved yet
  if (!deliverable) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card px-5 py-4 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <FileText className="h-4 w-4 text-muted-foreground/60 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">Pedro deliverable</div>
            <div className="text-xs text-muted-foreground">Nog niet gegenereerd voor deze klant.</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => generateMutation.mutate(undefined)}
          disabled={generateMutation.isPending}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          {generateMutation.isPending ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Genereren…
            </>
          ) : (
            "Genereer nu"
          )}
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-2xl border border-border/60 bg-card px-5 py-4 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)]">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">Pedro deliverable</div>
              <div className="text-[11px] text-muted-foreground">
                Campagne {deliverable.campaign_number} · laatst opgeslagen {fmtDate(deliverable.generated_at)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setViewOpen(true)}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted/60 transition-colors"
              title="Bekijk de markdown deliverable"
            >
              <Eye className="h-3.5 w-3.5" />
              Bekijk
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted/60 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              .md
            </button>
            <button
              type="button"
              onClick={() => generateMutation.mutate(undefined)}
              disabled={generateMutation.isPending}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted/60 disabled:opacity-60 transition-colors"
              title="Lees de laatst opgeslagen stage versies opnieuw in en bak een nieuwe deliverable"
            >
              {generateMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Regenereer
            </button>
          </div>
        </div>

        {/* Per-stage version chips - quick provenance scan without opening the doc */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {stagesIncluded.map(([label, v]) => (
            <span
              key={label}
              className={`text-[10px] tabular-nums px-2 py-0.5 rounded-full border ${
                v != null
                  ? "border-[color:var(--st-live)]/30 bg-[var(--st-live)]/10 text-[color:var(--st-live)]"
                  : "border-border/40 bg-muted/40 text-muted-foreground/60"
              }`}
              title={v != null ? `${label}: opgeslagen versie ${v}` : `${label}: geen versie opgeslagen`}
            >
              {label}{v != null ? ` v${v}` : " -"}
            </span>
          ))}
        </div>
      </div>

      {/* View modal - inline markdown preview. Pre-wraps the raw .md so
          the CM sees exactly what the client would get. */}
      {viewOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setViewOpen(false)}
        >
          <div
            className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border/60">
              <div className="text-sm font-semibold">Pedro deliverable preview</div>
              <button
                type="button"
                onClick={() => setViewOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Sluit ✕
              </button>
            </div>
            <pre className="flex-1 overflow-auto px-5 py-4 text-[12px] leading-[1.6] whitespace-pre-wrap font-mono text-foreground/90">
              {deliverable.content_md}
            </pre>
          </div>
        </div>
      )}
    </>
  )
}
