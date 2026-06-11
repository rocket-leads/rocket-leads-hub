"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Folder,
  FolderOpen,
  Loader2,
  AlertTriangle,
  ImageIcon,
  Eye,
  EyeOff,
  Sparkles,
  Check,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * ImageSourcesPicker - keuzeproces VOOR de Genereer-image klik.
 *
 * Roy 2026-06-10: Pedro's auto-selectie uit Drive maakte verkeerde
 * keuzes (logo's, sibling-brand foto's). Deze picker laat de CM:
 *   - per Drive folder een aan/uit toggle zetten (denylist hard skip)
 *   - Pexels stock content aan/uit zetten
 * Voordat hij op de Genereer-knop drukt. Geen API kosten meer aan de
 * verkeerde bronnen.
 *
 * State is per-client persistent - ééns instellen, voor altijd opgelost
 * voor die klant. Geen per-refresh of per-variant state.
 */

type FolderRow = {
  id: string
  name: string
  path: string
  depth: number
  hasSubfolders: boolean
  hasImages: boolean
  enabled: boolean
}

type SourcePrefs = {
  useStock: boolean
}

type ApiResponse = {
  clientId: string
  driveRootId: string | null
  driveError: string | null
  folders: FolderRow[]
  sourcePrefs: SourcePrefs
}

type Props = {
  clientId: string | null
}

export function ImageSourcesPicker({ clientId }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ApiResponse | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [savingStock, setSavingStock] = useState(false)

  // Pull-to-refresh helper. Wrapped so we can call it from initial mount,
  // tab-focus, and the manual reload button - all the paths that need to
  // surface a freshly-linked Drive folder from the client page.
  const reload = useCallback(async () => {
    if (!clientId) {
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      // cache: "no-store" zodat zelfs een proxy cache niet mee kan kijken -
      // de Monday fetch achter dit endpoint is al cache-busted bij PATCH,
      // we willen ook hier geen tussenlaag.
      const r = await fetch(`/api/pedro/image-source-prefs/${encodeURIComponent(clientId)}`, {
        cache: "no-store",
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(json.error || `HTTP ${r.status}`)
        setData(null)
        return
      }
      setData(json as ApiResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt")
    } finally {
      setLoading(false)
    }
  }, [clientId])

  // Load on mount + when client changes.
  useEffect(() => {
    let cancelled = false
    void reload().then(() => {
      if (cancelled) {
        /* discard - clientId switched mid-fetch */
      }
    })
    return () => {
      cancelled = true
    }
  }, [reload])

  // Refetch when the tab becomes visible again - covers the "CM edits
  // Drive folder on client page in another tab, comes back to Pedro"
  // case so the picker reflects the new link without a hard reload.
  // Roy 2026-06-11.
  useEffect(() => {
    if (!clientId) return
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload()
    }
    document.addEventListener("visibilitychange", onVisible)
    // Cross-component signal: anything in the Hub that mutates client
    // metadata can `window.dispatchEvent(new CustomEvent("hub:client-updated", { detail: { clientId } }))`
    // and active listeners scoped to that clientId will refresh.
    const onClientUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail as { clientId?: string } | undefined
      if (!detail?.clientId || detail.clientId === clientId) void reload()
    }
    window.addEventListener("hub:client-updated", onClientUpdated as EventListener)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("hub:client-updated", onClientUpdated as EventListener)
    }
  }, [clientId, reload])

  const toggleFolder = useCallback(
    async (folder: FolderRow) => {
      if (!clientId || savingIds.has(folder.id)) return
      const next = !folder.enabled
      // Cascade: gather descendants by path-prefix match. Roy 2026-06-10:
      // "als ik een hoofdfolder uit zet wil ik alle subfolders ook uit".
      // Path format is "Parent / Child / Grandchild" - anything that
      // starts with `${folder.path} / ` is below this folder.
      const currentFolders = data?.folders ?? []
      const parentPrefix = folder.path + " / "
      const descendants = currentFolders.filter(
        (f) =>
          f.id !== folder.id &&
          f.depth > folder.depth &&
          f.path.startsWith(parentPrefix),
      )
      const affectedIds = new Set<string>([folder.id, ...descendants.map((d) => d.id)])

      // Optimistic update across all affected folders.
      setData((prev) =>
        prev
          ? {
              ...prev,
              folders: prev.folders.map((f) =>
                affectedIds.has(f.id) ? { ...f, enabled: next } : f,
              ),
            }
          : prev,
      )
      setSavingIds((prev) => {
        const out = new Set(prev)
        for (const id of affectedIds) out.add(id)
        return out
      })
      try {
        const res = await fetch(
          `/api/pedro/image-source-prefs/${encodeURIComponent(clientId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              folder: {
                id: folder.id,
                name: folder.name,
                path: folder.path,
                enabled: next,
                descendants: descendants.map((d) => ({
                  id: d.id,
                  name: d.name,
                  path: d.path,
                })),
              },
            }),
          },
        )
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error || `HTTP ${res.status}`)
        }
      } catch (e) {
        // Revert all affected folders on failure.
        setData((prev) =>
          prev
            ? {
                ...prev,
                folders: prev.folders.map((f) =>
                  affectedIds.has(f.id) ? { ...f, enabled: !next } : f,
                ),
              }
            : prev,
        )
        setError(e instanceof Error ? e.message : "Opslaan mislukt")
      } finally {
        setSavingIds((prev) => {
          const out = new Set(prev)
          for (const id of affectedIds) out.delete(id)
          return out
        })
      }
    },
    [clientId, savingIds, data],
  )

  const toggleStock = useCallback(async () => {
    if (!clientId || !data || savingStock) return
    const next = !data.sourcePrefs.useStock
    setData({ ...data, sourcePrefs: { ...data.sourcePrefs, useStock: next } })
    setSavingStock(true)
    try {
      const res = await fetch(
        `/api/pedro/image-source-prefs/${encodeURIComponent(clientId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourcePrefs: { useStock: next } }),
        },
      )
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || `HTTP ${res.status}`)
      }
    } catch (e) {
      setData((prev) =>
        prev
          ? { ...prev, sourcePrefs: { ...prev.sourcePrefs, useStock: !next } }
          : prev,
      )
      setError(e instanceof Error ? e.message : "Opslaan mislukt")
    } finally {
      setSavingStock(false)
    }
  }, [clientId, data, savingStock])

  if (!clientId) return null
  if (loading && !data) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Image bronnen laden…
      </div>
    )
  }

  if (!data) {
    return error ? (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-400 inline-flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        Image bronnen niet beschikbaar: {error}
      </div>
    ) : null
  }

  const enabledCount = data.folders.filter((f) => f.enabled).length
  const disabledCount = data.folders.length - enabledCount
  const stockOn = data.sourcePrefs.useStock

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header - collapsible toggle, always visible. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-accent/30 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70">
              Image bronnen voor deze klant
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 truncate">
              {data.driveRootId ? (
                <>
                  {enabledCount} Drive folder{enabledCount === 1 ? "" : "s"} aan
                  {disabledCount > 0 ? `, ${disabledCount} uit` : ""}
                  {" · "}
                </>
              ) : (
                <>Geen Drive folder gekoppeld · </>
              )}
              Stock: {stockOn ? "aan" : "uit"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          {expanded ? (
            <>
              <ChevronDown className="h-3.5 w-3.5" /> Inklappen
            </>
          ) : (
            <>
              <ChevronRight className="h-3.5 w-3.5" /> Beheer
            </>
          )}
        </div>
      </button>

      {/* Expanded body - folder list + stock toggle. */}
      {expanded && (
        <div className="border-t border-border bg-muted/20">
          {/* Stock toggle */}
          <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <Sparkles className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium">Pexels stock content</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Voegt stock-foto&apos;s toe als reference naast Drive. Handig voor
                  klanten met dunne Drives of service-business zonder product-fotografie.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleStock}
              disabled={savingStock}
              className={cn(
                "shrink-0 inline-flex items-center justify-center h-7 w-12 rounded-full transition-colors",
                stockOn
                  ? "bg-emerald-500"
                  : "bg-muted border border-border",
                savingStock && "opacity-50",
              )}
              aria-label={stockOn ? "Stock uitzetten" : "Stock aanzetten"}
            >
              <div
                className={cn(
                  "h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                  stockOn ? "translate-x-2.5" : "-translate-x-2.5",
                )}
              />
            </button>
          </div>

          {/* Drive folders */}
          {data.driveRootId ? (
            <div className="px-2 py-2">
              <div className="px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 font-semibold">
                Drive folders ({data.folders.length})
              </div>
              {data.driveError && (
                <div className="px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400 inline-flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3" />
                  {data.driveError}
                </div>
              )}
              {data.folders.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  Geen subfolders gevonden onder de root.
                </div>
              ) : (
                <ul className="space-y-0.5 max-h-72 overflow-y-auto">
                  {data.folders.map((f) => {
                    const saving = savingIds.has(f.id)
                    // Roy 2026-06-10: descendant-lock. Wanneer een
                    // ancestor uit staat, is deze subfolder effectief
                    // ook uit (BFS skipt de subtree). UI laat zien dat
                    // de toggle door de parent gestuurd wordt.
                    const ancestorOff = data.folders.some(
                      (other) =>
                        other.depth < f.depth &&
                        !other.enabled &&
                        f.path.startsWith(other.path + " / "),
                    )
                    const effectivelyOff = !f.enabled || ancestorOff
                    return (
                      <li
                        key={f.id}
                        className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-accent/40"
                        style={{ paddingLeft: `${0.5 + (f.depth - 1) * 0.75}rem` }}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {!effectivelyOff ? (
                            <FolderOpen className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <Folder className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                          )}
                          <span
                            className={cn(
                              "text-xs truncate",
                              effectivelyOff
                                ? "text-muted-foreground/60 line-through"
                                : "text-foreground",
                            )}
                            title={f.path || f.name}
                          >
                            {f.name}
                          </span>
                          {f.hasImages && (
                            <span className="text-[9px] text-emerald-700/70 dark:text-emerald-400/70 font-medium px-1 rounded bg-emerald-500/10 shrink-0">
                              📷
                            </span>
                          )}
                          {ancestorOff && (
                            <span
                              className="text-[9px] text-muted-foreground/60 px-1 rounded bg-muted/60 shrink-0"
                              title="Hoofdmap staat uit - deze subfolder wordt ook geskipt"
                            >
                              parent uit
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleFolder(f)}
                          disabled={saving || ancestorOff}
                          title={
                            ancestorOff
                              ? "Hoofdmap staat uit - zet eerst de parent aan om deze subfolder afzonderlijk te beheren."
                              : f.enabled
                                ? "Uitzetten - Pedro skipt deze folder + alle subfolders"
                                : "Aanzetten"
                          }
                          className={cn(
                            "shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-medium transition-colors",
                            !effectivelyOff
                              ? "text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                              : "text-muted-foreground hover:bg-accent",
                            (saving || ancestorOff) && "opacity-50 cursor-not-allowed",
                          )}
                        >
                          {saving ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : !effectivelyOff ? (
                            <Eye className="h-3 w-3" />
                          ) : (
                            <EyeOff className="h-3 w-3" />
                          )}
                          {!effectivelyOff ? "Aan" : "Uit"}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className="px-2 pt-2 text-[10px] text-muted-foreground/70">
                Tip: zet sibling-brands (zoals QualityFree onder Juice Concepts) of
                rommelmap je niet wil gebruiken op &quot;uit&quot;. Geldt
                permanent voor deze klant.
              </div>
            </div>
          ) : (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              Geen Drive folder gekoppeld aan deze klant. Open client-instellingen
              om een Drive map te koppelen.
            </div>
          )}

          {error && (
            <div className="px-4 py-2 border-t border-border/60 text-[11px] text-red-600 dark:text-red-400 inline-flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              {error}
            </div>
          )}
          {(savingStock || savingIds.size > 0) && (
            <div className="px-4 py-2 border-t border-border/60 text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
              <Check className="h-3 w-3" />
              Opgeslagen - geldt voor volgende generatie.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
