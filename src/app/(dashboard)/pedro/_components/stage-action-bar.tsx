"use client"

import { useState, useEffect } from "react"
import { Save, History, AlertCircle, Check } from "lucide-react"

/**
 * Per-stage action bar for Pedro Campaign tabs.
 *
 * Two-layer storage UX:
 *  - draft: auto-saved every 800ms to pedro_client_state (already wired
 *    in pedro-campaign.tsx). Survives reloads. Not shown to client tab,
 *    not used by cross-client examples. Private working state.
 *  - saved: explicit "Save final version" → row in pedro_stage_versions.
 *    These are what client detail page + cross-client examples read.
 *
 * Bar lives at the top of each stage so the CM always knows:
 *  - what the latest saved version is (vN — date)
 *  - that the working draft auto-saves continuously
 *  - one click to commit the current draft as a new version
 */

export type SaveStage = "brief" | "angles" | "script" | "creatives" | "lp" | "ad-copy"

type LatestVersion = {
  version_number: number
  saved_at: string
  label: string | null
} | null

type Props = {
  clientId: string | null
  stage: SaveStage
  /** Function returning the current draft data to snapshot. Called when
   *  the user clicks "Save final version". */
  getCurrentData: () => unknown
  /** When true, the save button is disabled (e.g. while AI is generating). */
  busy?: boolean
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function StageActionBar({ clientId, stage, getCurrentData, busy }: Props) {
  const [latest, setLatest] = useState<LatestVersion>(null)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null)

  // Load the latest saved version for this (client, stage). Reloads
  // when client changes so switching clients shows the right version
  // count. Silent on failure.
  useEffect(() => {
    if (!clientId) {
      setLatest(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/pedro/saved-versions?clientId=${encodeURIComponent(clientId)}&stage=${encodeURIComponent(stage)}`,
        )
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const versions = (data.versions ?? []) as Array<{ version_number: number; saved_at: string; label: string | null }>
        setLatest(versions[0] ?? null)
      } catch {
        /* silent */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId, stage])

  async function handleSave() {
    if (!clientId) return
    setSaving(true)
    setFeedback(null)
    try {
      const res = await fetch("/api/pedro/saved-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          stage,
          data: getCurrentData(),
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setFeedback({ kind: "err", msg: data.error || `HTTP ${res.status}` })
      } else {
        setLatest({
          version_number: data.version?.version_number ?? (latest?.version_number ?? 0) + 1,
          saved_at: data.version?.saved_at ?? new Date().toISOString(),
          label: null,
        })
        setFeedback({
          kind: "ok",
          msg: `Opgeslagen als v${data.version?.version_number ?? "?"}`,
        })
        setTimeout(() => setFeedback(null), 3500)
      }
    } catch (e) {
      setFeedback({ kind: "err", msg: e instanceof Error ? e.message : "Opslaan mislukt" })
    }
    setSaving(false)
  }

  if (!clientId) return null

  return (
    <div className="flex items-center justify-between gap-3 mb-4 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0 text-xs">
        {latest ? (
          <>
            <History className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
            <span className="text-muted-foreground">
              Laatst opgeslagen:{" "}
              <span className="text-foreground font-medium">v{latest.version_number}</span>{" "}
              <span className="text-muted-foreground/70">· {fmtDate(latest.saved_at)}</span>
            </span>
          </>
        ) : (
          <>
            <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <span className="text-muted-foreground">
              Nog niet opgeslagen — werkt in <span className="font-medium text-foreground">draft mode</span>{" "}
              <span className="text-muted-foreground/60">(auto-save aan, niet zichtbaar voor klant-record)</span>
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {feedback && (
          <span
            className={`text-xs font-medium ${feedback.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
          >
            {feedback.kind === "ok" ? "✓ " : "✗ "}
            {feedback.msg}
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || busy}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm whitespace-nowrap"
        >
          {saving ? (
            <>
              <span className="h-3 w-3 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
              Opslaan...
            </>
          ) : (
            <>
              <Save className="h-3 w-3" />
              {latest ? `Save als v${latest.version_number + 1}` : "Save naar klant"}
            </>
          )}
        </button>
        {feedback?.kind === "ok" && !saving && (
          <Check className="h-4 w-4 text-emerald-500" aria-hidden />
        )}
      </div>
    </div>
  )
}
