"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, Plus, Pencil, Archive } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PedroCampaign } from "@/app/api/pedro/campaigns/route"

/**
 * Per-client campaign picker for Pedro.
 *
 * Replaces the older Optimaliseer / Nieuwe-campagne binary toggle.
 * Each campaign is a distinct named container (different audience,
 * different tone-of-voice strategy, etc.) and the picker is the single
 * surface for switching between them, creating new ones, and renaming
 * or archiving the current one.
 *
 * Defaulting: the picker picks the most-recently-used (`last_used_at
 * desc`) campaign on client switch — touching a campaign through the
 * PATCH endpoint bumps `last_used_at` so just opening one keeps it at
 * the top next time.
 */
export function CampaignPicker({
  campaigns,
  selectedId,
  loading,
  onSelect,
  onCreate,
  onRename,
  onArchive,
}: {
  campaigns: PedroCampaign[]
  selectedId: string | null
  loading: boolean
  onSelect: (campaign: PedroCampaign) => void
  onCreate: (name: string) => Promise<void> | void
  onRename: (campaign: PedroCampaign, newName: string) => Promise<void> | void
  onArchive: (campaign: PedroCampaign) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const selected = campaigns.find((c) => c.id === selectedId) ?? null

  async function handleCreate() {
    setOpen(false)
    const name = window.prompt("Naam voor de nieuwe campagne:", "")
    if (name === null) return // user cancelled
    await onCreate(name.trim())
  }

  async function handleRename(c: PedroCampaign) {
    const name = window.prompt("Hernoem campagne:", c.name ?? `Campagne ${c.campaign_number}`)
    if (name === null) return
    const trimmed = name.trim()
    if (!trimmed) return
    await onRename(c, trimmed)
  }

  async function handleArchive(c: PedroCampaign) {
    const ok = window.confirm(
      `Archiveer "${c.name ?? `Campagne ${c.campaign_number}`}"?\n\nDe campagne verdwijnt uit de picker maar de opgeslagen versies blijven bewaard.`,
    )
    if (!ok) return
    await onArchive(c)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        disabled={loading}
        className={cn(
          "inline-flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium text-foreground shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)] transition-colors hover:bg-muted/40",
          "aria-expanded:bg-muted/40",
          loading && "opacity-60 cursor-not-allowed",
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {selected ? (
          <>
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded bg-primary/10 text-primary text-[10px] font-semibold tabular-nums">
              v.{selected.campaign_number}
            </span>
            <span className="truncate max-w-[220px]">
              {selected.name ?? `Campagne ${selected.campaign_number}`}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            {loading ? "Laden…" : campaigns.length === 0 ? "Geen campagne" : "Kies campagne"}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/70" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-1 z-30 w-80 rounded-lg border border-border bg-popover shadow-lg overflow-hidden"
        >
          {campaigns.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground italic">
              Geen campagnes voor deze klant. Maak er één aan.
            </div>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {campaigns.map((c) => {
                const isSelected = c.id === selectedId
                return (
                  <li key={c.id}>
                    <div
                      className={cn(
                        "group flex items-center gap-2 px-2.5 py-1.5 text-xs",
                        isSelected && "bg-primary/5",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false)
                          onSelect(c)
                        }}
                        className="flex-1 min-w-0 text-left flex items-center gap-2"
                      >
                        <span className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded bg-muted text-foreground text-[10px] font-semibold tabular-nums shrink-0">
                          v.{c.campaign_number}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium truncate">
                            {c.name ?? `Campagne ${c.campaign_number}`}
                          </span>
                          <span className="block text-[10px] text-muted-foreground/60">
                            Laatst gebruikt {formatRelative(c.last_used_at)}
                          </span>
                        </span>
                        {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                      </button>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => handleRename(c)}
                          title="Hernoem"
                          className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleArchive(c)}
                          title="Archiveer"
                          disabled={isSelected && campaigns.filter((x) => !x.archived_at).length === 1}
                          className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Archive className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="border-t border-border/60 p-1">
            <button
              type="button"
              onClick={handleCreate}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Nieuwe campagne
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diffSec = (now - d.getTime()) / 1000
  if (diffSec < 60) return "zojuist"
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min geleden`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} u geleden`
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} d geleden`
  return d.toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "2-digit" })
}
