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
  Plus,
  MessageSquare,
  CheckCircle2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { RegenFeedbackModal, type RegenFeedbackPayload } from "./regen-feedback-modal"

/**
 * VariantImagePanel — 3-slot image gallery per variant.
 *
 * Roy 2026-06-09: bij elke "Genereer image"-klik krijgt de CM 3
 * varianten naast elkaar zodat hij meteen de beste kan kiezen. Per
 * slot kan hij regenereren of een eigen foto uploaden zonder de
 * andere slots aan te raken.
 *
 * Server contract:
 *   GET  /api/pedro/variants/[id]/image         → { slots, imagePrompt, hook, primaryCopySnippet }
 *   POST /api/pedro/variants/[id]/generate-image
 *     body: { position?, slots?, promptOverride? }
 *     - position absent → generate all 3
 *     - position N      → regen just slot N
 *   POST /api/pedro/variants/[id]/upload-image (multipart, ?position=N)
 */

type SlotState = {
  position: number
  hasImage: boolean
  signedUrl: string | null
  provider: string | null
  model: string | null
  generatedAt: string | null
  /** Roy 2026-06-10: max 1 regen per slot. UI gebruikt deze om de
   *  Regen-knop te disablen + tooltip te tonen. */
  regenCount?: number
  regenAvailable?: boolean
}

type GenerateReferences = {
  winnerThumbnail: boolean
  clientPhotos: number
  clientPhotoNames?: string[]
  stockPhotos?: number
  stockPhotoNames?: string[]
}

const SLOT_COUNT = 3
const SLOT_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]

type Props = {
  variantId: string | null
  /** Hub client (Monday item) id. Required for posting explicit
   *  feedback so Pedro learns per-client preferences. Null = feedback
   *  button hidden. */
  clientId: string | null
  adName: string
  /** Initial image prompt from the refresh envelope. */
  initialImagePrompt: string | null
  /** Whether this variant has at least one image already (from envelope
   *  enrichment). When true, we trigger a fresh GET to load all slot
   *  states + signed URLs on mount. */
  initialHasImage: boolean
}

export function VariantImagePanel({
  variantId,
  clientId,
  adName,
  initialImagePrompt,
  initialHasImage,
}: Props) {
  const [slots, setSlots] = useState<SlotState[]>(() =>
    Array.from({ length: SLOT_COUNT }, (_, i) => ({
      position: i,
      hasImage: false,
      signedUrl: null,
      provider: null,
      model: null,
      generatedAt: null,
    })),
  )
  const [imagePrompt, setImagePrompt] = useState<string | null>(initialImagePrompt)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [slotBusy, setSlotBusy] = useState<Record<number, "generating" | "uploading" | null>>({})
  const [error, setError] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [promptDraft, setPromptDraft] = useState(initialImagePrompt ?? "")
  const [references, setReferences] = useState<GenerateReferences | null>(null)

  // Explicit-feedback state — the textarea is the strongest signal Pedro
  // gets back ("logos altijd klein", "klant haat te witte tanden", etc.).
  // Stored in `pedro_creative_feedback` and pulled into the next
  // creative-refresh prompt for THIS client.
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackDraft, setFeedbackDraft] = useState("")
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [feedbackSaved, setFeedbackSaved] = useState(false)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)

  const submitFeedback = useCallback(async () => {
    const text = feedbackDraft.trim()
    if (!clientId || !text || feedbackBusy) return
    setFeedbackBusy(true)
    setFeedbackError(null)
    try {
      const res = await fetch("/api/pedro/creative-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          variantId: variantId ?? undefined,
          feedbackType: "explicit",
          feedbackText: `[Variant "${adName}"] ${text}`,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      setFeedbackSaved(true)
      setFeedbackDraft("")
      setTimeout(() => {
        setFeedbackSaved(false)
        setFeedbackOpen(false)
      }, 1800)
    } catch (e) {
      setFeedbackError(e instanceof Error ? e.message : "Opslaan mislukt")
    } finally {
      setFeedbackBusy(false)
    }
  }, [feedbackDraft, clientId, variantId, adName, feedbackBusy])

  // Lazy-load slot states on mount if variant already has at least one
  // image (from the envelope enrichment). Single round-trip.
  useEffect(() => {
    if (!variantId || !initialHasImage) return
    let cancelled = false
    fetch(`/api/pedro/variants/${variantId}/image`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !Array.isArray(json.slots)) return
        // Merge — keep empty slots for positions the server didn't return.
        setSlots((prev) =>
          prev.map((p) => {
            const found = (json.slots as SlotState[]).find((s) => s.position === p.position)
            return found ?? p
          }),
        )
        if (json.imagePrompt) {
          setImagePrompt(json.imagePrompt)
          setPromptDraft(json.imagePrompt)
        }
      })
      .catch(() => {
        /* best-effort */
      })
    return () => {
      cancelled = true
    }
  }, [variantId, initialHasImage])

  const setSlotBusyAt = useCallback((pos: number, state: "generating" | "uploading" | null) => {
    setSlotBusy((prev) => ({ ...prev, [pos]: state }))
  }, [])

  const generateAll = useCallback(async () => {
    if (!variantId || bulkBusy) return
    setBulkBusy(true)
    setError(null)
    try {
      const reqBody: { promptOverride?: string; slots: number } = { slots: SLOT_COUNT }
      if (editingPrompt && promptDraft.trim()) {
        reqBody.promptOverride = promptDraft.trim()
      }
      const res = await fetch(`/api/pedro/variants/${variantId}/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      type GenSlot = {
        position: number
        ok: boolean
        signedUrl?: string
        provider?: string
        model?: string
        error?: string
      }
      if (Array.isArray(json.slots)) {
        setSlots((prev) =>
          prev.map((p) => {
            const gen = (json.slots as GenSlot[]).find((g) => g.position === p.position)
            if (!gen || !gen.ok) return p
            return {
              position: p.position,
              hasImage: true,
              signedUrl: gen.signedUrl ?? null,
              provider: gen.provider ?? "gemini",
              model: gen.model ?? null,
              generatedAt: new Date().toISOString(),
            }
          }),
        )
      }
      if (json.references) setReferences(json.references)
      if (reqBody.promptOverride) setImagePrompt(reqBody.promptOverride)
      setEditingPrompt(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generatie mislukt")
    } finally {
      setBulkBusy(false)
    }
  }, [variantId, bulkBusy, editingPrompt, promptDraft])

  // Single-slot generation. Two flavours:
  //   - First-time fill (slot is empty)         → direct call, no feedback modal
  //   - Re-gen (slot already has an image)     → MUST go through RegenFeedbackModal
  // Roy 2026-06-10: dwingt CM om gestructureerd te zeggen wat anders moet,
  // anders kost regen veel credits zonder learning.
  const performSlotGenerate = useCallback(
    async (position: number, feedback?: RegenFeedbackPayload) => {
      if (!variantId) return
      setSlotBusyAt(position, "generating")
      setError(null)
      try {
        const res = await fetch(`/api/pedro/variants/${variantId}/generate-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            position,
            regenFeedback: feedback,
          }),
        })
        const json = await res.json()
        if (!res.ok || json.error) {
          throw new Error(json.error || `HTTP ${res.status}`)
        }
        type GenSlot = {
          position: number
          ok: boolean
          signedUrl?: string
          provider?: string
          model?: string
          error?: string
        }
        const gen = Array.isArray(json.slots)
          ? (json.slots as GenSlot[]).find((g) => g.position === position)
          : undefined
        if (gen && gen.ok) {
          setSlots((prev) =>
            prev.map((p) =>
              p.position === position
                ? {
                    position,
                    hasImage: true,
                    signedUrl: gen.signedUrl ?? null,
                    provider: gen.provider ?? "gemini",
                    model: gen.model ?? null,
                    generatedAt: new Date().toISOString(),
                    // After a re-gen of an existing slot, the budget is
                    // gone. First-time fill doesn't bump regen_count
                    // server-side; UI mirrors that.
                    regenCount: feedback ? 1 : (p.regenCount ?? 0),
                    regenAvailable: feedback ? false : (p.regenAvailable ?? true),
                  }
                : p,
            ),
          )
        }
        if (json.references) setReferences(json.references)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Generatie mislukt")
        throw e // rethrow so the modal sees the failure
      } finally {
        setSlotBusyAt(position, null)
      }
    },
    [variantId, setSlotBusyAt],
  )

  // State voor de gestructureerde regen-feedback modal.
  const [regenModalSlot, setRegenModalSlot] = useState<number | null>(null)

  const onSlotActionClick = useCallback(
    (position: number) => {
      const slot = slots.find((s) => s.position === position)
      // Slot already has an image → forced feedback flow.
      if (slot?.hasImage) {
        setRegenModalSlot(position)
        return
      }
      // First-time fill → direct call.
      void performSlotGenerate(position)
    },
    [slots, performSlotGenerate],
  )

  const uploadToSlot = useCallback(
    async (position: number, file: File) => {
      if (!variantId) return
      setSlotBusyAt(position, "uploading")
      setError(null)
      try {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("position", String(position))
        const res = await fetch(`/api/pedro/variants/${variantId}/upload-image`, {
          method: "POST",
          body: formData,
        })
        const json = await res.json()
        if (!res.ok || json.error) {
          throw new Error(json.error || `HTTP ${res.status}`)
        }
        setSlots((prev) =>
          prev.map((p) =>
            p.position === position
              ? {
                  position,
                  hasImage: true,
                  signedUrl: json.signedUrl ?? null,
                  provider: "manual_upload",
                  model: null,
                  generatedAt: new Date().toISOString(),
                }
              : p,
          ),
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload mislukt")
      } finally {
        setSlotBusyAt(position, null)
      }
    },
    [variantId, setSlotBusyAt],
  )

  if (!variantId) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Genereer de refresh opnieuw om images te kunnen toevoegen aan deze variant.
      </div>
    )
  }

  const filledCount = slots.filter((s) => s.hasImage).length

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold inline-flex items-center gap-1">
          <ImageIcon className="h-3 w-3" />
          Images ({filledCount}/{SLOT_COUNT})
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
          {clientId && filledCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setFeedbackOpen((v) => !v)
                setFeedbackError(null)
              }}
              disabled={bulkBusy}
              title="Geef Pedro feedback op deze creative — wordt opgeslagen per klant en gebruikt bij volgende refresh"
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors",
                feedbackOpen
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <MessageSquare className="h-3 w-3" />
              {feedbackOpen ? "Sluit feedback" : "Geef feedback"}
            </button>
          )}
          {filledCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setEditingPrompt((v) => !v)
                if (!editingPrompt) setPromptDraft(imagePrompt ?? "")
              }}
              disabled={bulkBusy}
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors",
                editingPrompt
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {editingPrompt ? "Sluit prompt" : "Bewerk prompt"}
            </button>
          )}
        </div>
      </div>

      {/* Feedback textarea — explicit signal that Pedro injects into the
          next refresh prompt for this client. */}
      {feedbackOpen && clientId && (
        <div className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
          <div className="text-[10px] uppercase tracking-[0.12em] text-amber-700 dark:text-amber-400 font-semibold inline-flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            Feedback voor Pedro (per klant onthouden)
          </div>
          <textarea
            value={feedbackDraft}
            onChange={(e) => setFeedbackDraft(e.target.value)}
            rows={2}
            disabled={feedbackBusy}
            placeholder='Bijv. "Logo veel te groot — altijd klein of helemaal weg" of "Headline moet vraag uit doelgroep zijn, geen product-claim"'
            className="w-full text-xs rounded-md border border-border bg-background px-2 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 resize-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] text-muted-foreground/70">
              Pedro leest dit terug bij elke volgende refresh van deze klant.
            </div>
            <button
              type="button"
              onClick={submitFeedback}
              disabled={feedbackBusy || !feedbackDraft.trim()}
              className={cn(
                "inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium transition-colors",
                feedbackSaved
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-amber-600 text-white hover:bg-amber-700 disabled:bg-muted disabled:text-muted-foreground",
              )}
            >
              {feedbackBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : feedbackSaved ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <MessageSquare className="h-3 w-3" />
              )}
              {feedbackSaved ? "Opgeslagen" : feedbackBusy ? "Opslaan…" : "Opslaan"}
            </button>
          </div>
          {feedbackError && (
            <div className="text-[11px] text-red-600 dark:text-red-400 inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {feedbackError}
            </div>
          )}
        </div>
      )}

      {/* References — shown after a generate */}
      {references && (
        <div className="text-[11px] text-muted-foreground/80 flex flex-wrap gap-x-1.5 gap-y-0.5 items-center">
          <span className="text-muted-foreground/60">References:</span>
          {references.winnerThumbnail && (
            <span className="inline-flex items-center gap-0.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />
              winner ad
            </span>
          )}
          {references.clientPhotos > 0 && (
            <span
              className="inline-flex items-center gap-0.5"
              title={references.clientPhotoNames?.join("\n") ?? ""}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {references.clientPhotos} klant-foto{references.clientPhotos === 1 ? "" : "'s"} uit Drive
            </span>
          )}
          {!references.winnerThumbnail && references.clientPhotos === 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              alleen prompt (geen winner thumb of Drive-foto's gevonden)
            </span>
          )}
        </div>
      )}

      {/* Editable prompt textarea */}
      {editingPrompt && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
            Image prompt — geldt voor de volgende "Genereer 3 images" klik
          </div>
          <textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            rows={3}
            disabled={bulkBusy}
            className="w-full text-xs rounded-md border border-border bg-background px-2 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 resize-none disabled:opacity-50"
            placeholder="Edit de visual brief..."
          />
        </div>
      )}

      {/* Bulk generate button — primary action */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={generateAll}
          disabled={bulkBusy}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {bulkBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {bulkBusy
            ? "Pedro tekent 3 varianten…"
            : filledCount > 0
              ? `Genereer 3 nieuwe images`
              : `Genereer 3 images`}
        </button>
        {bulkBusy && (
          <span className="text-[11px] text-muted-foreground">~30-60s</span>
        )}
      </div>

      {/* Slot grid */}
      <div className="grid grid-cols-3 gap-2">
        {slots.map((s) => (
          <SlotCard
            key={s.position}
            slot={s}
            adName={adName}
            busy={slotBusy[s.position] ?? null}
            onRegen={() => onSlotActionClick(s.position)}
            onUpload={(file) => uploadToSlot(s.position, file)}
            disabled={bulkBusy}
          />
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Structured regen-feedback modal — opens when CM clicks Regen
          on a slot that already has an image. Roy 2026-06-10. */}
      <RegenFeedbackModal
        open={regenModalSlot !== null}
        onClose={() => setRegenModalSlot(null)}
        slotLabel={
          regenModalSlot !== null ? SLOT_LABELS[regenModalSlot] ?? "?" : "?"
        }
        hasRegenBudget={
          regenModalSlot !== null
            ? slots.find((s) => s.position === regenModalSlot)?.regenAvailable ?? true
            : true
        }
        onSubmit={async (payload) => {
          if (regenModalSlot === null) return
          await performSlotGenerate(regenModalSlot, payload)
        }}
      />
    </div>
  )
}

function SlotCard({
  slot,
  adName,
  busy,
  onRegen,
  onUpload,
  disabled,
}: {
  slot: SlotState
  adName: string
  busy: "generating" | "uploading" | null
  onRegen: () => void
  onUpload: (file: File) => void
  disabled: boolean
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isBusy = busy !== null
  const slotLabel = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"][slot.position] ?? `${slot.position + 1}`

  return (
    <div className="relative rounded-md border border-border/60 bg-background overflow-hidden">
      {/* Slot label badge */}
      <div className="absolute top-1 left-1 z-10 inline-flex items-center justify-center h-5 w-5 rounded-full bg-background/90 backdrop-blur text-[10px] font-bold text-muted-foreground shadow-sm">
        {slotLabel}
      </div>

      {/* Image / placeholder */}
      <div className="relative aspect-square bg-muted/40">
        {slot.hasImage && slot.signedUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slot.signedUrl}
              alt={`${adName} — variant ${slotLabel}`}
              className={cn("w-full h-full object-cover", isBusy && "opacity-40")}
            />
            <a
              href={slot.signedUrl}
              target="_blank"
              rel="noreferrer"
              className="absolute top-1 right-1 inline-flex items-center justify-center h-5 w-5 rounded-md bg-background/90 backdrop-blur text-muted-foreground hover:bg-background hover:text-foreground shadow-sm"
              title="Open op volledige grootte"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
            {isBusy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Plus className="h-5 w-5" />
            )}
          </div>
        )}

        {/* Busy overlay */}
        {isBusy && slot.hasImage && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex border-t border-border/60 divide-x divide-border/40 text-[11px]">
        <button
          type="button"
          onClick={onRegen}
          disabled={isBusy || disabled || (slot.hasImage && slot.regenAvailable === false)}
          title={
            slot.hasImage && slot.regenAvailable === false
              ? "Customise limiet bereikt (max 1× per slot). Upload je eigen afbeelding of genereer de hele refresh opnieuw."
              : slot.hasImage
                ? "Pas deze afbeelding aan met gestructureerde feedback (max 1× per slot)"
                : "Genereer alleen deze slot met AI"
          }
          className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === "generating" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : slot.hasImage ? (
            <RefreshCw className="h-3 w-3" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {slot.hasImage ? "Customise" : "Genereer"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onUpload(f)
            e.target.value = ""
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isBusy || disabled}
          title="Upload eigen foto voor deze slot"
          className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40"
        >
          {busy === "uploading" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Upload className="h-3 w-3" />
          )}
          Upload
        </button>
      </div>
    </div>
  )
}
