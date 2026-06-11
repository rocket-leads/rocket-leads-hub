"use client"

import { useState, useEffect } from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { CreativeRefresh } from "./creative-refresh"
import { AdCopyRefresh } from "./ad-copy-refresh"

const TOGGLES_STORAGE_KEY = "pedro.optimize.adsToggles"

type Toggles = { creative: boolean; copy: boolean }
const DEFAULT_TOGGLES: Toggles = { creative: true, copy: true }

/**
 * Combined "Ads" workspace - merges Creatives + Ad copy into one stage.
 *
 * Roy 2026-06-11 v6: vervangt de oude 3-way segmented tabs (Creative+Copy
 * / Alleen Creative / Alleen Copy) door TWEE losse toggle pills (Creative
 * en Copy) die allebei default AAN staan. Een buitenstaander kan op het
 * eerste oog zien dat 'ie beide kan beheren ipv te moeten kiezen tussen
 * 3 opties. Eén toggle uitzetten verbergt die sub-sectie. Allebei aan
 * = beide stacked.
 *
 * Toggles staan persistent per browser zodat de CM zijn voorkeur niet
 * elke sessie opnieuw hoeft te zetten.
 */
type Props = {
  selectedClientId: string
  selectedClientName: string
  autoStart?: boolean
  hideShellHeader?: boolean
}

export function AdsRefresh({
  selectedClientId,
  selectedClientName,
  autoStart,
  hideShellHeader,
}: Props) {
  const [toggles, setToggles] = useState<Toggles>(() => {
    if (typeof window === "undefined") return DEFAULT_TOGGLES
    try {
      const stored = window.localStorage.getItem(TOGGLES_STORAGE_KEY)
      if (!stored) return DEFAULT_TOGGLES
      const parsed = JSON.parse(stored) as Partial<Toggles>
      const creative = parsed.creative !== false
      const copy = parsed.copy !== false
      // Don't allow both off via stale state - default both on.
      if (!creative && !copy) return DEFAULT_TOGGLES
      return { creative, copy }
    } catch {
      return DEFAULT_TOGGLES
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(TOGGLES_STORAGE_KEY, JSON.stringify(toggles))
    } catch {
      /* private mode - ignore */
    }
  }, [toggles])

  function toggle(key: keyof Toggles) {
    setToggles((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      // Guard rail: minstens één toggle aan houden, anders heeft de
      // stap geen output.
      if (!next.creative && !next.copy) return prev
      return next
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mr-1">
          Genereer
        </span>
        <TogglePill
          label="Creative"
          active={toggles.creative}
          onClick={() => toggle("creative")}
        />
        <TogglePill
          label="Copy"
          active={toggles.copy}
          onClick={() => toggle("copy")}
        />
      </div>

      {toggles.creative && (
        <CreativeRefresh
          selectedClientId={selectedClientId}
          selectedClientName={selectedClientName}
          autoStart={autoStart}
          hideShellHeader={hideShellHeader}
        />
      )}
      {toggles.copy && (
        <AdCopyRefresh
          selectedClientId={selectedClientId}
          selectedClientName={selectedClientName}
          autoStart={autoStart}
          hideShellHeader={hideShellHeader}
        />
      )}
    </div>
  )
}

function TogglePill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md border transition-colors",
        active
          ? "bg-primary/10 text-primary border-primary/40"
          : "bg-card text-muted-foreground border-border hover:bg-accent",
      )}
      title={`${label}: ${active ? "aan" : "uit"} - klik om te wisselen`}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center h-3.5 w-3.5 rounded-sm border",
          active
            ? "bg-primary border-primary text-primary-foreground"
            : "border-border bg-card",
        )}
      >
        {active && <Check className="h-2.5 w-2.5" />}
      </span>
      {label}
    </button>
  )
}
