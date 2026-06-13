"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  FolderOpen,
  RotateCcw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  PedroCreativeSettings,
  AspectRatio,
  SlotStyleKey,
  InspirationSubfolderFlags,
  VisualStyleKey,
  LightingStyleKey,
  CompositionDensityKey,
} from "@/lib/pedro/creative-settings"

/**
 * Global Pedro settings — admin tab. Two stacked cards:
 *   1. Inspiration library: Drive folder URL + verify + detected subfolder
 *      counts. The shared root every klant references.
 *   2. Globale defaults: the entire per-klant settings shape (aspect ratio,
 *      AI intensity, slot styles, look & feel, brand-color injection,
 *      inspiration subfolders) editable as the Hub-wide baseline. Forms
 *      the middle layer of the three-layer resolver chain (hardcoded →
 *      global → per-klant). When a klant doesn't override a field, this
 *      value applies. Roy 2026-06-13.
 */

// ── Inspiration library types ────────────────────────────────────────────
type SubfolderRow = {
  key: string
  name: string | null
  id: string | null
  fileCount: number
  found: boolean
}

type VerifyResponse =
  | { connected: false; folderId: string | null; error?: string }
  | { connected: true; folderId: string; subfolders: SubfolderRow[] }

// ── Globale defaults types ───────────────────────────────────────────────
type GlobalDefaultsResponse = {
  global: PedroCreativeSettings
  effective: {
    aspectRatio: AspectRatio
    aiIntensity: number
    slotStyleDefaults: Record<number, SlotStyleKey>
    inspirationSubfolders: InspirationSubfolderFlags
    brandColorInjection: boolean
    visualStyle: VisualStyleKey
    lightingStyle: LightingStyleKey
    compositionDensity: CompositionDensityKey
  }
  hardcoded: GlobalDefaultsResponse["effective"]
}

const ASPECT_RATIOS: AspectRatio[] = ["4:5", "1:1", "9:16", "1.91:1"]

const SLOT_STYLE_OPTIONS: Array<{ value: SlotStyleKey; label: string }> = [
  { value: "client_content", label: "Client content" },
  { value: "client_content_ai", label: "Client content + AI" },
  { value: "ai_content", label: "AI Content" },
  { value: "ai_animation", label: "AI Animation" },
  { value: "stock_content", label: "Stock content" },
]

const SUBFOLDER_LABELS: Record<keyof InspirationSubfolderFlags, string> = {
  client_content: "Client content",
  client_content_ai: "Client content + AI",
  ai_content: "AI Content",
  ai_animation: "AI Animation",
  stock_content: "Stock content",
}

const VISUAL_STYLE_OPTIONS: Array<{ value: VisualStyleKey; label: string }> = [
  { value: "auto", label: "Auto (geen voorkeur)" },
  { value: "professional", label: "Professioneel" },
  { value: "modern_clean", label: "Modern & clean" },
  { value: "luxurious", label: "Luxueus / premium" },
  { value: "feminine_soft", label: "Vrouwelijk & zacht" },
  { value: "mysterious_dark", label: "Geheimzinnig / donker" },
  { value: "playful_energetic", label: "Speels & energiek" },
  { value: "robust_industrial", label: "Robuust / industrieel" },
  { value: "vintage_editorial", label: "Vintage / editorial" },
]

const LIGHTING_OPTIONS: Array<{ value: LightingStyleKey; label: string }> = [
  { value: "auto", label: "Auto (geen voorkeur)" },
  { value: "studio_clean", label: "Studio clean" },
  { value: "natural_daylight", label: "Natuurlijk daglicht" },
  { value: "golden_hour", label: "Golden hour" },
  { value: "moody_dark", label: "Moody / donker" },
  { value: "high_key_bright", label: "High-key bright" },
]

const COMPOSITION_OPTIONS: Array<{ value: CompositionDensityKey; label: string }> = [
  { value: "auto", label: "Auto (geen voorkeur)" },
  { value: "minimal", label: "Minimal (veel ruimte)" },
  { value: "balanced", label: "Gebalanceerd" },
  { value: "rich", label: "Rich layered" },
]

export function PedroTab() {
  return (
    <div className="space-y-6">
      <h2 className="font-heading font-semibold text-lg">Pedro</h2>
      <InspirationLibraryCard />
      <GlobalDefaultsCard />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Inspiration library — folder URL + verify + detected subfolder counts.
// ─────────────────────────────────────────────────────────────────────────

function InspirationLibraryCard() {
  const [folderInput, setFolderInput] = useState("")
  const [verifyState, setVerifyState] = useState<VerifyResponse | null>(null)
  const [verifyBusy, setVerifyBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    fetch("/api/pedro/inspiration-folder/verify")
      .then((r) => r.json())
      .then((v: VerifyResponse) => {
        setVerifyState(v)
        if (v.folderId) setFolderInput(v.folderId)
      })
      .catch(() => {
        /* surface on next user action */
      })
  }, [])

  const handleSave = useCallback(async () => {
    const raw = folderInput.trim()
    if (!raw) return
    const idMatch = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/)
    const folderId = idMatch ? idMatch[1] : raw
    setSaveBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/pedro/inspiration-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)
      setDirty(false)
      const v = await fetch("/api/pedro/inspiration-folder/verify").then((r) => r.json())
      setVerifyState(v as VerifyResponse)
      setFolderInput((v as VerifyResponse).folderId ?? folderId)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt")
    } finally {
      setSaveBusy(false)
    }
  }, [folderInput])

  const handleVerify = useCallback(async () => {
    setVerifyBusy(true)
    setError(null)
    try {
      const v = await fetch("/api/pedro/inspiration-folder/verify").then((r) => r.json())
      setVerifyState(v as VerifyResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verifieren mislukt")
    } finally {
      setVerifyBusy(false)
    }
  }, [])

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Inspiration library
          </div>
          <div className="font-heading font-semibold text-sm">AD CREATIVES INSPIRATION</div>
        </div>
        {savedFlash && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Opgeslagen
          </span>
        )}
      </div>

      <div>
        <label className="text-xs font-medium text-foreground/80 mb-1.5 block">
          Drive folder URL of folder-ID
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={folderInput}
            onChange={(e) => {
              setFolderInput(e.target.value)
              setDirty(true)
            }}
            placeholder="https://drive.google.com/drive/folders/…"
            className="flex-1 h-9 px-3 rounded-md border border-border bg-background text-sm font-mono"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saveBusy || folderInput.trim().length === 0}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {saveBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Opslaan"}
          </button>
          <button
            type="button"
            onClick={handleVerify}
            disabled={verifyBusy}
            className="h-9 px-3 rounded-md border border-border bg-card text-sm hover:bg-accent transition-colors disabled:opacity-40"
          >
            {verifyBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Verifieer"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400 inline-flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {verifyState && (
        <div>
          {verifyState.connected ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  Verbonden — {verifyState.subfolders.filter((s) => s.found).length} subfolders ·{" "}
                  {verifyState.subfolders.reduce((n, s) => n + s.fileCount, 0)} refs
                </span>
                <a
                  href={`https://drive.google.com/drive/folders/${verifyState.folderId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border bg-card text-xs font-medium hover:bg-accent transition-colors"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Open in Drive
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </a>
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {verifyState.subfolders.map((s) => (
                  <li
                    key={s.key}
                    className="flex items-center justify-between text-xs px-2 py-1 rounded bg-background/60"
                  >
                    <span className={s.found ? "text-foreground" : "text-muted-foreground/60"}>
                      {s.found ? s.name : SUBFOLDER_LABELS[s.key as keyof InspirationSubfolderFlags] ?? s.key}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {s.found ? `${s.fileCount} refs` : "niet gevonden"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : verifyState.folderId ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 space-y-1">
              <div className="text-sm font-medium text-amber-700 dark:text-amber-400 inline-flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4" />
                Niet bereikbaar
              </div>
              <div className="text-xs text-muted-foreground">
                Drive zegt: {verifyState.error ?? "onbekende fout"}. Opgeslagen ID:{" "}
                <code className="font-mono">{verifyState.folderId}</code>.
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-muted/30 bg-muted/10 px-3 py-2 text-sm text-muted-foreground inline-flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" />
              Nog niet geconfigureerd.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Globale defaults — Output / Look & feel / Brand / Inspiration subfolders.
// ─────────────────────────────────────────────────────────────────────────

function GlobalDefaultsCard() {
  const [state, setState] = useState<GlobalDefaultsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<PedroCreativeSettings>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch("/api/pedro/global-defaults")
      .then((r) => r.json())
      .then((j: GlobalDefaultsResponse) => setState(j))
      .catch((e) => setError(e instanceof Error ? e.message : "Kon globale defaults niet laden"))
      .finally(() => setLoading(false))
  }, [])

  const effective = useMemo(() => {
    if (!state) return null
    return {
      aspectRatio: draft.aspectRatio ?? state.effective.aspectRatio,
      aiIntensity: draft.aiIntensity ?? state.effective.aiIntensity,
      slotStyleDefaults: {
        ...state.effective.slotStyleDefaults,
        ...(draft.slotStyleDefaults ?? {}),
      },
      inspirationSubfolders: {
        ...state.effective.inspirationSubfolders,
        ...(draft.inspirationSubfolders ?? {}),
      },
      brandColorInjection: draft.brandColorInjection ?? state.effective.brandColorInjection,
      visualStyle: draft.visualStyle ?? state.effective.visualStyle,
      lightingStyle: draft.lightingStyle ?? state.effective.lightingStyle,
      compositionDensity: draft.compositionDensity ?? state.effective.compositionDensity,
    }
  }, [state, draft])

  const dirty = useMemo(() => {
    let n = 0
    for (const [, v] of Object.entries(draft)) {
      if (v === undefined) continue
      if (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0) continue
      n++
    }
    return n
  }, [draft])

  const patchDraft = useCallback((p: Partial<PedroCreativeSettings>) => {
    setDraft((prev) => ({ ...prev, ...p }))
  }, [])

  const patchSlotStyle = useCallback((slot: number, value: SlotStyleKey) => {
    setDraft((prev) => ({
      ...prev,
      slotStyleDefaults: { ...(prev.slotStyleDefaults ?? {}), [slot]: value },
    }))
  }, [])

  const patchSubfolder = useCallback(
    (key: keyof InspirationSubfolderFlags, value: boolean) => {
      setDraft((prev) => ({
        ...prev,
        inspirationSubfolders: { ...(prev.inspirationSubfolders ?? {}), [key]: value },
      }))
    },
    [],
  )

  const handleSave = useCallback(async () => {
    if (dirty === 0) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/pedro/global-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: draft }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)
      setState(json as GlobalDefaultsResponse)
      setDraft({})
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt")
    } finally {
      setSaving(false)
    }
  }, [draft, dirty])

  const handleReset = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/pedro/global-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)
      setState(json as GlobalDefaultsResponse)
      setDraft({})
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset mislukt")
    } finally {
      setSaving(false)
    }
  }, [])

  return (
    <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
      <div className="border-b border-border/60 px-5 py-3 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Globale defaults
          </div>
          <div className="font-heading font-semibold text-sm">
            Gelden voor élke klant zonder eigen override
          </div>
        </div>
        <div className="flex items-center gap-2">
          {savedFlash && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Opgeslagen
            </span>
          )}
          {dirty > 0 && !savedFlash && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {dirty} wijziging{dirty === 1 ? "" : "en"} niet opgeslagen
            </span>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={saving}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            title="Wis alle globale overrides en val terug op de hardcoded Hub defaults"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || dirty === 0}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-4 rounded-md text-xs font-medium transition-colors disabled:opacity-50",
              dirty > 0
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-muted text-muted-foreground",
            )}
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Bewaar
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b border-red-500/30 bg-red-500/5 px-5 py-2 text-xs text-red-600 dark:text-red-400 inline-flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {loading || !effective || !state ? (
        <div className="px-5 py-10 flex items-center justify-center text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Globale defaults laden…
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {/* Output */}
          <Section title="Output">
            <div className="space-y-4">
              <div>
                <Label>Aspect ratio</Label>
                <select
                  value={effective.aspectRatio}
                  onChange={(e) => patchDraft({ aspectRatio: e.target.value as AspectRatio })}
                  className="w-full sm:w-1/3 h-9 px-3 rounded-md border border-border bg-background text-sm"
                >
                  {ASPECT_RATIOS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label>
                  AI intensity{" "}
                  <span className="font-normal text-muted-foreground">{effective.aiIntensity}</span>
                </Label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={effective.aiIntensity}
                  onChange={(e) => patchDraft({ aiIntensity: Number(e.target.value) })}
                  className="w-full accent-primary"
                />
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>Origineel (0)</span>
                  <span>Geheel AI-bewerkt (100)</span>
                </div>
              </div>

              <div>
                <Label>Slot styles default mix</Label>
                <div className="grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((slot) => (
                    <div key={slot}>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                        Slot {["A", "B", "C"][slot]}
                      </div>
                      <select
                        value={effective.slotStyleDefaults[slot] ?? "client_content_ai"}
                        onChange={(e) => patchSlotStyle(slot, e.target.value as SlotStyleKey)}
                        className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
                      >
                        {SLOT_STYLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          {/* Look & feel */}
          <Section title="Look & feel">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>Stijl</Label>
                <select
                  value={effective.visualStyle}
                  onChange={(e) => patchDraft({ visualStyle: e.target.value as VisualStyleKey })}
                  className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
                >
                  {VISUAL_STYLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Lichtstijl</Label>
                <select
                  value={effective.lightingStyle}
                  onChange={(e) => patchDraft({ lightingStyle: e.target.value as LightingStyleKey })}
                  className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
                >
                  {LIGHTING_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Compositie</Label>
                <select
                  value={effective.compositionDensity}
                  onChange={(e) => patchDraft({ compositionDensity: e.target.value as CompositionDensityKey })}
                  className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
                >
                  {COMPOSITION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Section>

          {/* Brand */}
          <Section title="Brand identity">
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={effective.brandColorInjection}
                  onChange={(e) => patchDraft({ brandColorInjection: e.target.checked })}
                  className="h-4 w-4 accent-primary"
                />
                <span>Injecteer brand colors in image prompts</span>
              </label>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                De brand colors zelf zijn per klant (uit website / brand book / handmatig).
                Deze toggle bepaalt alleen of ze überhaupt mee mogen.
              </p>
            </div>
          </Section>

          {/* Inspiration subfolders */}
          <Section title="Inspiration subfolders default">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(Object.keys(SUBFOLDER_LABELS) as Array<keyof InspirationSubfolderFlags>).map((key) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border/60 bg-background/40 text-sm"
                >
                  <span className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={effective.inspirationSubfolders[key]}
                      onChange={(e) => patchSubfolder(key, e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                    {SUBFOLDER_LABELS[key]}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Default aan/uit-status per subfolder. Klanten kunnen op de Pedro Optimize
              wizard hun eigen subset kiezen.
            </p>
          </Section>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">{title}</div>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-foreground/80 mb-1.5">{children}</div>
}
