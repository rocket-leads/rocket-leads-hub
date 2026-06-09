"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import {
  Sparkles,
  Loader2,
  Upload,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  ImageIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * VariantImagePanel — per-variant image generation UX.
 *
 * Sits inside each CreativeRefresh variant card. Three states:
 *   - no image yet → "Genereer image" + "Of upload eigen"
 *   - generating  → spinner + "Pedro pakt de winner als referentie..."
 *   - image ready → thumbnail + "Regenereer" + "Vervang" + "Open" + edit-prompt
 *
 * The variantId comes from the enriched envelope (see
 * /api/pedro/refreshes/[id]/route.ts and the POST response of
 * /api/pedro/creative-refresh). Components on legacy refreshes without
 * variant ids render a disabled "Save eerst opnieuw" hint.
 *
 * Roy 2026-06-09.
 */

type Props = {
  variantId: string | null
  adName: string
  initialImagePrompt: string | null
  initialImage?: {
    hasImage: boolean
    provider?: string | null
    model?: string | null
    generatedAt?: string | null
  }
}

type ImageState = {
  hasImage: boolean
  signedUrl?: string
  provider?: string | null
  model?: string | null
  generatedAt?: string | null
  imagePrompt?: string | null
}

export function VariantImagePanel({
  variantId,
  adName,
  initialImagePrompt,
  initialImage,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [image, setImage] = useState<ImageState>({
    hasImage: initialImage?.hasImage ?? false,
    provider: initialImage?.provider,
    model: initialImage?.model,
    generatedAt: initialImage?.generatedAt,
    imagePrompt: initialImagePrompt,
  })
  const [busy, setBusy] = useState<null | "generating" | "uploading">(null)
  const [error, setError] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [promptDraft, setPromptDraft] = useState(initialImagePrompt ?? "")

  // Fetch current image state lazily: when the component mounts AND the
  // initialImage said hasImage=true (we have the row but not the signed
  // URL yet because the parent endpoint doesn't sign). Single round-trip.
  useEffect(() => {
    if (!variantId || !image.hasImage || image.signedUrl) return
    let cancelled = false
    fetch(`/api/pedro/variants/${variantId}/image`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        if (json.hasImage) {
          setImage((prev) => ({
            ...prev,
            hasImage: true,
            signedUrl: json.signedUrl ?? undefined,
            provider: json.provider ?? prev.provider,
            model: json.model ?? prev.model,
            generatedAt: json.generatedAt ?? prev.generatedAt,
            imagePrompt: json.imagePrompt ?? prev.imagePrompt,
          }))
        }
      })
      .catch(() => {
        // Best-effort. UI just hides the preview if the signed URL didn't load.
      })
    return () => {
      cancelled = true
    }
  }, [variantId, image.hasImage, image.signedUrl])

  const handleGenerate = useCallback(async () => {
    if (!variantId || busy) return
    setBusy("generating")
    setError(null)
    try {
      const body: { promptOverride?: string } = {}
      if (editingPrompt && promptDraft.trim()) {
        body.promptOverride = promptDraft.trim()
      }
      const res = await fetch(`/api/pedro/variants/${variantId}/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      setImage({
        hasImage: true,
        signedUrl: json.signedUrl,
        provider: "gemini",
        model: json.model,
        generatedAt: new Date().toISOString(),
        imagePrompt: body.promptOverride ?? image.imagePrompt,
      })
      setEditingPrompt(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generatie mislukt")
    } finally {
      setBusy(null)
    }
  }, [variantId, busy, editingPrompt, promptDraft, image.imagePrompt])

  const handleUpload = useCallback(
    async (file: File) => {
      if (!variantId || busy) return
      setBusy("uploading")
      setError(null)
      try {
        const formData = new FormData()
        formData.append("file", file)
        const res = await fetch(`/api/pedro/variants/${variantId}/upload-image`, {
          method: "POST",
          body: formData,
        })
        const json = await res.json()
        if (!res.ok || json.error) {
          throw new Error(json.error || `HTTP ${res.status}`)
        }
        setImage({
          hasImage: true,
          signedUrl: json.signedUrl,
          provider: "manual_upload",
          model: null,
          generatedAt: new Date().toISOString(),
          imagePrompt: image.imagePrompt,
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload mislukt")
      } finally {
        setBusy(null)
      }
    },
    [variantId, busy, image.imagePrompt],
  )

  if (!variantId) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Genereer de refresh opnieuw om images te kunnen toevoegen aan deze variant.
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold inline-flex items-center gap-1">
          <ImageIcon className="h-3 w-3" />
          Image
        </div>
        {image.provider && (
          <div className="text-[10px] text-muted-foreground/70">
            {image.provider === "manual_upload"
              ? "Eigen upload"
              : `Gemini${image.model ? ` · ${image.model.replace("gemini-", "").replace("-preview", "")}` : ""}`}
          </div>
        )}
      </div>

      {/* Preview */}
      {image.hasImage && image.signedUrl && (
        <div className="relative rounded-md overflow-hidden border border-border bg-background">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.signedUrl}
            alt={adName}
            className="w-full aspect-square object-cover"
          />
          <a
            href={image.signedUrl}
            target="_blank"
            rel="noreferrer"
            className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-md bg-background/90 backdrop-blur px-1.5 py-0.5 text-[10px] text-foreground hover:bg-background shadow-sm"
            title="Open op volledige grootte"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {/* Prompt editor (collapsible) */}
      {(editingPrompt || (!image.hasImage && image.imagePrompt)) && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
            Image prompt
          </div>
          <textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            rows={3}
            disabled={busy !== null}
            className="w-full text-xs rounded-md border border-border bg-background px-2 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 resize-none disabled:opacity-50"
            placeholder="Bijv. 'Modern interior with new wooden floor, family enjoying coffee, brand teal accent, on-image text BESPAAR €400 PER MAAND in bold white'"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5">
        {!image.hasImage ? (
          <>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {busy === "generating" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {busy === "generating" ? "Pedro tekent..." : "Genereer image"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleUpload(f)
                e.target.value = ""
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border bg-card text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
            >
              {busy === "uploading" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
              {busy === "uploading" ? "Uploaden..." : "Upload eigen"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border bg-card text-xs font-medium hover:bg-accent disabled:opacity-50 transition-colors"
            >
              {busy === "generating" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Regenereer
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingPrompt((v) => !v)
                if (!editingPrompt) setPromptDraft(image.imagePrompt ?? "")
              }}
              disabled={busy !== null}
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50",
                editingPrompt
                  ? "border border-primary/40 bg-primary/10 text-primary"
                  : "border border-border bg-card text-foreground hover:bg-accent",
              )}
            >
              {editingPrompt ? "Sluit prompt" : "Bewerk prompt"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleUpload(f)
                e.target.value = ""
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border bg-card text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
            >
              {busy === "uploading" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
              Vervang
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {error}
        </div>
      )}
    </div>
  )
}
