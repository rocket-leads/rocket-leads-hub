"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FolderOpen,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RotateCcw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  PedroCreativeSettings,
  AspectRatio,
  SlotStyleKey,
  InspirationSubfolderFlags,
} from "@/lib/pedro/creative-settings"

/**
 * Inline settings panel that opens below the client picker on the Pedro
 * Optimize page. Three sections:
 *   - Bronnen   : inspiration root URL (global), per-client subfolder
 *                 checkboxes, klant-Drive link
 *   - Output    : aspect ratio, AI intensity, variants per refresh,
 *                 per-slot style defaults
 *   - Brand     : brand colors (read-only v1), fonts (read-only), brand
 *                 book ref (read-only v1)
 *
 * Save flow is explicit (Bewaar button); dirty state highlights the
 * button + shows "X wijzigingen". Reset wipes the per-client override
 * back to defaults (PUT { reset: true }).
 *
 * Brand-book picker/upload is deferred to v2 — for now we show whatever
 * `brand_style.brandBookSource` told us the source was. Roy 2026-06-13.
 */

type VerifyResponseSubfolder = {
  key: keyof InspirationSubfolderFlags
  name: string | null
  id: string | null
  fileCount: number
  found: boolean
}

type VerifyResponse =
  | { connected: false; folderId: string | null; error?: string }
  | { connected: true; folderId: string; subfolders: VerifyResponseSubfolder[] }

type SettingsResponse = {
  override: PedroCreativeSettings
  effective: {
    aspectRatio: AspectRatio
    aiIntensity: number
    variantsPerRefresh: number
    slotStyleDefaults: Record<number, SlotStyleKey>
    inspirationSubfolders: InspirationSubfolderFlags
    brandColorInjection: boolean
    brandColorIntensity: number
    brandBookDriveFileId: string | null
    brandBookSource?: string
  }
  defaults: SettingsResponse["effective"]
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

type Props = {
  open: boolean
  clientId: string
  clientName: string
  googleDriveId: string | null
}

export function PedroSettingsPanel({ open, clientId, clientName, googleDriveId }: Props) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null)
  const [loadingSettings, setLoadingSettings] = useState(false)
  const [verifyState, setVerifyState] = useState<VerifyResponse | null>(null)
  const [verifyBusy, setVerifyBusy] = useState(false)

  // Override draft = the unsaved-yet edits, layered on top of the
  // server-known override. Save POSTs draft, refetches into `settings`.
  const [draft, setDraft] = useState<PedroCreativeSettings>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  // Inspiration root URL editor — global setting, separate save path.
  const [rootDraft, setRootDraft] = useState<string>("")
  const [rootDirty, setRootDirty] = useState(false)
  const [rootSaving, setRootSaving] = useState(false)

  // Load per-client settings + verify root on open. We re-fetch every
  // time the panel opens for a new client so saving on one client and
  // then switching reflects the fresh state.
  const requestSeq = useRef(0)
  useEffect(() => {
    if (!open || !clientId) return
    const seq = ++requestSeq.current
    setLoadingSettings(true)
    setError(null)
    Promise.all([
      fetch(`/api/pedro/clients/${encodeURIComponent(clientId)}/settings`).then((r) => r.json()),
      fetch("/api/pedro/inspiration-folder/verify").then((r) => r.json()),
    ])
      .then(([s, v]) => {
        if (seq !== requestSeq.current) return
        setSettings(s as SettingsResponse)
        setDraft({})
        setVerifyState(v as VerifyResponse)
        if ((v as VerifyResponse).folderId) {
          setRootDraft((v as VerifyResponse).folderId ?? "")
        } else {
          setRootDraft("")
        }
        setRootDirty(false)
      })
      .catch((e) => {
        if (seq !== requestSeq.current) return
        setError(e instanceof Error ? e.message : "Kon instellingen niet laden")
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoadingSettings(false)
      })
  }, [open, clientId])

  // Effective view = server override + local draft, falling back to
  // server defaults for keys the user hasn't touched yet. Used to
  // render every field's current value.
  const effective = useMemo(() => {
    if (!settings) return null
    return {
      aspectRatio: draft.aspectRatio ?? settings.effective.aspectRatio,
      aiIntensity: draft.aiIntensity ?? settings.effective.aiIntensity,
      variantsPerRefresh: draft.variantsPerRefresh ?? settings.effective.variantsPerRefresh,
      slotStyleDefaults: {
        ...settings.effective.slotStyleDefaults,
        ...(draft.slotStyleDefaults ?? {}),
      },
      inspirationSubfolders: {
        ...settings.effective.inspirationSubfolders,
        ...(draft.inspirationSubfolders ?? {}),
      },
      brandColorInjection: draft.brandColorInjection ?? settings.effective.brandColorInjection,
      brandColorIntensity: draft.brandColorIntensity ?? settings.effective.brandColorIntensity,
      brandBookDriveFileId:
        draft.brandBookDriveFileId !== undefined
          ? draft.brandBookDriveFileId
          : settings.effective.brandBookDriveFileId,
      brandBookSource: draft.brandBookSource ?? settings.effective.brandBookSource,
    }
  }, [settings, draft])

  const dirty = useMemo(() => {
    // Count keys present in draft. Empty sub-objects don't count.
    let n = 0
    for (const [k, v] of Object.entries(draft)) {
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
    if (!clientId || dirty === 0) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/pedro/clients/${encodeURIComponent(clientId)}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: draft }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)
      setSettings(json as SettingsResponse)
      setDraft({})
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt")
    } finally {
      setSaving(false)
    }
  }, [clientId, draft, dirty])

  const handleReset = useCallback(async () => {
    if (!clientId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/pedro/clients/${encodeURIComponent(clientId)}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)
      setSettings(json as SettingsResponse)
      setDraft({})
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset mislukt")
    } finally {
      setSaving(false)
    }
  }, [clientId])

  // Inspiration root URL save — parses a Drive URL down to a folder ID
  // ("https://drive.google.com/drive/folders/<id>") or accepts a bare ID.
  const handleRootSave = useCallback(async () => {
    const raw = rootDraft.trim()
    if (!raw) return
    const idMatch = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/)
    const folderId = idMatch ? idMatch[1] : raw
    setRootSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/pedro/inspiration-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)
      setRootDirty(false)
      // Re-verify so the subfolder counts refresh.
      const v = await fetch("/api/pedro/inspiration-folder/verify").then((r) => r.json())
      setVerifyState(v as VerifyResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inspiration root opslaan mislukt")
    } finally {
      setRootSaving(false)
    }
  }, [rootDraft])

  const handleVerify = useCallback(async () => {
    setVerifyBusy(true)
    try {
      const v = await fetch("/api/pedro/inspiration-folder/verify").then((r) => r.json())
      setVerifyState(v as VerifyResponse)
    } finally {
      setVerifyBusy(false)
    }
  }, [])

  if (!open) return null

  return (
    <div className="mt-3 rounded-2xl border border-border/60 bg-card shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)]">
      <div className="border-b border-border/60 px-5 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Pedro instellingen
          </div>
          <div className="font-heading font-semibold text-sm truncate">{clientName}</div>
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
            title="Zet alle per-klant instellingen terug naar de Hub defaults"
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

      {loadingSettings || !effective || !settings ? (
        <div className="px-5 py-10 flex items-center justify-center text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Instellingen laden…
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {/* ─────────── BRONNEN ─────────── */}
          <Section title="Bronnen">
            <div className="space-y-4">
              {/* Connection status (prominent at top — read-only summary).
                  The URL editor zelf staat gedempt onderaan deze sectie
                  omdat 't een globale instelling is die per definitie
                  voor élke klant gelijk is. Roy 2026-06-13. */}
              {verifyState?.connected ? (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Inspiration library verbonden
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {verifyState.subfolders.filter((s) => s.found).length} subfolders ·{" "}
                      {verifyState.subfolders.reduce((n, s) => n + s.fileCount, 0)} refs
                    </div>
                  </div>
                  <a
                    href={`https://drive.google.com/drive/folders/${verifyState.folderId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-xs font-medium hover:bg-accent transition-colors"
                    title="Open de inspiration-library folder in Drive"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Open in Drive
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </a>
                </div>
              ) : verifyState ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                  <div className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {verifyState.folderId
                      ? "Inspiration root niet bereikbaar"
                      : "Inspiration root nog niet geconfigureerd"}
                  </div>
                  {verifyState.folderId && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Drive zegt: {verifyState.error ?? "onbekende fout"}. Opgeslagen ID:{" "}
                      <code className="font-mono">{verifyState.folderId}</code>. Onderaan kun je 'm
                      aanpassen.
                    </div>
                  )}
                </div>
              ) : null}

              {/* Inspiration subfolders */}
              <div>
                <Label>
                  Inspiration subfolders <span className="font-normal text-muted-foreground">(per klant)</span>
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(Object.keys(SUBFOLDER_LABELS) as Array<keyof InspirationSubfolderFlags>).map((key) => {
                    const detected = verifyState?.connected
                      ? verifyState.subfolders.find((s) => s.key === key)
                      : undefined
                    const checked = effective.inspirationSubfolders[key] ?? false
                    return (
                      <label
                        key={key}
                        className={cn(
                          "flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border/60 bg-background/40 text-sm",
                          detected?.found === false && "opacity-50",
                        )}
                      >
                        <span className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => patchSubfolder(key, e.target.checked)}
                            disabled={detected?.found === false}
                            className="h-4 w-4 accent-primary"
                          />
                          {SUBFOLDER_LABELS[key]}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {detected?.found
                            ? `${detected.fileCount} refs`
                            : detected
                              ? "niet gevonden"
                              : "—"}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Klant-Drive link */}
              <div>
                <Label>Klant-Drive</Label>
                {googleDriveId ? (
                  <a
                    href={`https://drive.google.com/drive/folders/${googleDriveId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-accent transition-colors"
                    title="Open de Drive folder van deze klant in een nieuw tab"
                  >
                    <FolderOpen className="h-4 w-4" />
                    Open in Drive
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </a>
                ) : (
                  <div className="text-xs text-muted-foreground italic">
                    Geen Drive folder gekoppeld in Monday voor deze klant.
                  </div>
                )}
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  Per-folder selecties (welke klant-mappen Pedro mag gebruiken voor bron-fotos) worden beheerd via de bestaande image-source-prefs picker in de wizard.
                </div>
              </div>

              {/* Globale instelling, onderaan + gedempt. Geldt voor élke
                  klant; zelden aangeraakt. Hier laten staan zodat 'm
                  vindbaar is wanneer de library hard down is, maar
                  visueel niet competen met de per-klant toggles erboven. */}
              <div className="mt-6 pt-4 border-t border-border/40">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-1">
                  Globale instelling · zelfde voor alle klanten
                </div>
                <Label>
                  <span className="font-normal text-muted-foreground/80">Inspiration root (Drive folder URL of folder-ID)</span>
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={rootDraft}
                    onChange={(e) => {
                      setRootDraft(e.target.value)
                      setRootDirty(true)
                    }}
                    placeholder="https://drive.google.com/drive/folders/…"
                    className="flex-1 h-8 px-2 rounded-md border border-border/50 bg-background/40 text-xs font-mono text-muted-foreground focus:text-foreground focus:bg-background focus:border-border transition-colors"
                  />
                  <button
                    type="button"
                    onClick={handleRootSave}
                    disabled={!rootDirty || rootSaving}
                    className="h-8 px-3 rounded-md border border-border/60 bg-card text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
                  >
                    {rootSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Opslaan"}
                  </button>
                  <button
                    type="button"
                    onClick={handleVerify}
                    disabled={verifyBusy}
                    className="h-8 px-3 rounded-md border border-border/60 bg-card text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
                  >
                    {verifyBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Verifieer"}
                  </button>
                </div>
              </div>
            </div>
          </Section>

          {/* ─────────── OUTPUT ─────────── */}
          <Section title="Output">
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Aspect ratio</Label>
                  <select
                    value={effective.aspectRatio}
                    onChange={(e) => patchDraft({ aspectRatio: e.target.value as AspectRatio })}
                    className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm"
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
                    Variants per refresh{" "}
                    <span className="font-normal text-muted-foreground">{effective.variantsPerRefresh}</span>
                  </Label>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={effective.variantsPerRefresh}
                    onChange={(e) => patchDraft({ variantsPerRefresh: Number(e.target.value) })}
                    className="w-full accent-primary"
                  />
                </div>
              </div>

              <div>
                <Label>
                  AI intensity{" "}
                  <span className="font-normal text-muted-foreground">
                    {effective.aiIntensity} — {aiIntensityLabel(effective.aiIntensity)}
                  </span>
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
                <Label>
                  Slot styles <span className="font-normal text-muted-foreground">(default mix per refresh)</span>
                </Label>
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

          {/* ─────────── BRAND IDENTITY ─────────── */}
          <Section title="Brand identity">
            <div className="space-y-4">
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
              </div>

              <div className={cn(!effective.brandColorInjection && "opacity-50")}>
                <Label>
                  Color presence{" "}
                  <span className="font-normal text-muted-foreground">
                    {effective.brandColorIntensity} — {colorPresenceLabel(effective.brandColorIntensity)}
                  </span>
                </Label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={effective.brandColorIntensity}
                  onChange={(e) => patchDraft({ brandColorIntensity: Number(e.target.value) })}
                  disabled={!effective.brandColorInjection}
                  className="w-full accent-primary"
                />
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>Subtiel accent (0)</span>
                  <span>Panel-dominant (100)</span>
                </div>
              </div>

              <div>
                <Label>Brand book</Label>
                {effective.brandBookDriveFileId ? (
                  <a
                    href={`https://drive.google.com/file/d/${effective.brandBookDriveFileId}/view`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm hover:bg-accent transition-colors"
                  >
                    <FolderOpen className="h-4 w-4" />
                    Open brand book ({effective.brandBookSource ?? "drive"})
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </a>
                ) : (
                  <div className="text-xs text-muted-foreground italic">
                    Geen brand book gekoppeld. Drive-picker + upload komen in v2 — Pedro valt
                    voorlopig terug op de uit de website gescrapete brand_style (colors + fonts).
                  </div>
                )}
              </div>
            </div>
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

function aiIntensityLabel(n: number): string {
  if (n <= 20) return "voornamelijk origineel"
  if (n <= 50) return "lichte AI-bewerking"
  if (n <= 80) return "stevige AI-bewerking"
  return "vrijwel volledig AI"
}

function colorPresenceLabel(n: number): string {
  if (n <= 25) return "subtiel"
  if (n <= 60) return "duidelijk aanwezig"
  return "dominant"
}
