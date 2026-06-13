"use client"

import { useCallback, useEffect, useState } from "react"
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  FolderOpen,
} from "lucide-react"

/**
 * Global Pedro settings — admin-only tab. Currently just the AD CREATIVES
 * INSPIRATION root folder URL (one folder ID, shared across every klant).
 * Per-klant overrides (slot styles, AI intensity, look & feel, brand
 * colors) live on the Pedro Optimize wizard itself, not here. Roy
 * 2026-06-13 moved the URL field out of the per-klant panel because it's
 * structurally a global setting and doesn't belong in a per-klant view.
 *
 * Future additions to this tab:
 *   - Global default overrides for aspect ratio, AI intensity, slot
 *     styles (so a Hub-wide policy change doesn't require touching every
 *     klant override).
 *   - Drive picker for brand book auto-discovery rules.
 */

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

export function PedroTab() {
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
    <div className="space-y-6">
      <div>
        <h2 className="font-heading font-semibold text-lg">Pedro</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Globale Pedro-instellingen die voor élke klant gelden. Per-klant overrides
          (slot styles, AI intensity, look &amp; feel, brand colors) staan op de Pedro
          Optimize wizard zelf.
        </p>
      </div>

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
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Pasten kan met de volledige Drive URL of alleen het folder-ID — de URL parser
            pakt eruit wat hij nodig heeft.
          </p>
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
                        {s.found ? s.name : labelFor(s.key)}
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
    </div>
  )
}

function labelFor(key: string): string {
  switch (key) {
    case "client_content":
      return "Client content"
    case "client_content_ai":
      return "Client content + AI"
    case "ai_content":
      return "AI Content"
    case "ai_animation":
      return "AI Animation"
    case "stock_content":
      return "Stock content"
    default:
      return key
  }
}
