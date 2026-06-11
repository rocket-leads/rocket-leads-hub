"use client"

import { useState, useEffect, useCallback } from "react"
import { X, Loader2, AlertTriangle, RefreshCw, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * RegenFeedbackModal - gestructureerde feedback voordat een slot
 * regenereerd wordt.
 *
 * Roy 2026-06-10: zonder gedwongen onderbouwing klikken CM's eindeloos
 * op "Regen" met "vind 'm niet mooi" → kost veel Gemini credits + 0
 * learning. Deze modal is verplicht VOOR de regen-call en:
 *   - vraagt apart wat er anders moet aan IMAGE / TEXT / DESIGN
 *   - eist minstens één veld ingevuld
 *   - stuurt de gestructureerde feedback mee als context naar Gemini
 *   - logt dezelfde feedback in pedro_creative_feedback voor de
 *     volgende refresh learning loop
 *
 * Hard cap: max 1 regen per slot (server enforced via regen_count).
 * Na 1× is regen geblokkeerd - alleen Upload of nieuwe refresh helpt.
 */

export type RegenFeedbackPayload = {
  imageFeedback: string
  textFeedback: string
  designFeedback: string
  otherFeedback: string
}

type Props = {
  open: boolean
  onClose: () => void
  /** Slot label (A/B/C) for the modal title. */
  slotLabel: string
  /** Called when CM clicks "Regenereer met deze context". Receives the
   *  combined structured feedback. Parent handles the actual API call
   *  + slot state updates. */
  onSubmit: (payload: RegenFeedbackPayload) => Promise<void>
  /** True wanneer er nog credit over is. False = picker UI laat zien
   *  dat regen niet meer beschikbaar is. */
  hasRegenBudget: boolean
}

const FIELDS: Array<{
  key: keyof RegenFeedbackPayload
  label: string
  placeholder: string
  hint: string
}> = [
  {
    key: "imageFeedback",
    label: "Afbeelding (wat staat erop)",
    placeholder:
      "Bv. 'Verkeerd product - dit is geen Zumex juicer maar een Blendtec blender. Vervang door echte Zumex automaat.'",
    hint: "Wat staat er nu op de afbeelding dat anders moet? Personen, producten, setting, props.",
  },
  {
    key: "textFeedback",
    label: "Tekst op afbeelding",
    placeholder:
      "Bv. 'Headline is te lang. Maak korter: \"Vragen je gasten ook naar verse sappen?\"' of 'Verwijder de brand-slogan onderaan.'",
    hint: "Wat moet anders aan de tekst die ON de afbeelding staat? Lettergrootte, tekst zelf, positionering.",
  },
  {
    key: "designFeedback",
    label: "Design / stijl",
    placeholder:
      "Bv. 'Te clean, voelt B2C. Moet meer professioneel-horeca uitstralen. Donkere achtergrond ipv lichte.'",
    hint: "Kleuren, sfeer, fotografisch vs grafisch, brand-look, compositie.",
  },
  {
    key: "otherFeedback",
    label: "Andere context",
    placeholder:
      "Bv. 'Klant zei laatste eval dat hij geen mensen in beeld wil. Probeer alleen product close-up.'",
    hint: "Klant-context, recente feedback, redenen die niet in bovenstaande 3 passen.",
  },
]

export function RegenFeedbackModal({
  open,
  onClose,
  slotLabel,
  onSubmit,
  hasRegenBudget,
}: Props) {
  const [payload, setPayload] = useState<RegenFeedbackPayload>({
    imageFeedback: "",
    textFeedback: "",
    designFeedback: "",
    otherFeedback: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on open so the next time the modal opens it's fresh.
  useEffect(() => {
    if (open) {
      setPayload({
        imageFeedback: "",
        textFeedback: "",
        designFeedback: "",
        otherFeedback: "",
      })
      setError(null)
    }
  }, [open])

  const hasAnyContent = Object.values(payload).some((v) => v.trim().length > 0)
  const canSubmit = hasAnyContent && hasRegenBudget && !submitting

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(payload)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Regen mislukt")
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, payload, onSubmit, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-6 py-4 border-b border-border bg-card">
          <div>
            <div className="text-xs uppercase tracking-wide font-semibold text-amber-600 dark:text-amber-400 mb-1 inline-flex items-center gap-1">
              <RefreshCw className="h-3 w-3" />
              Customise slot {slotLabel}
            </div>
            <h2 className="font-heading font-semibold text-lg">
              Wat moet er anders?
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Vul minstens één veld in. Hoe specifieker je feedback, hoe beter
              de aanpassing. Dit telt mee - daarna is de slot dicht (max 1×
              per slot om credits te besparen).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40"
            aria-label="Sluiten"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {!hasRegenBudget && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div>
                Deze slot is al 1× aangepast - geen credits meer over.
                Upload je eigen afbeelding of genereer de hele refresh
                opnieuw om met een schone lei te beginnen.
              </div>
            </div>
          )}

          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <label
                htmlFor={`regen-${f.key}`}
                className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground/70 font-semibold"
              >
                {f.label}
              </label>
              <textarea
                id={`regen-${f.key}`}
                value={payload[f.key]}
                onChange={(e) =>
                  setPayload((prev) => ({ ...prev, [f.key]: e.target.value }))
                }
                disabled={submitting || !hasRegenBudget}
                rows={2}
                placeholder={f.placeholder}
                className="w-full text-sm rounded-md border border-border bg-background px-2.5 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 resize-none disabled:opacity-50"
              />
              <div className="text-[10px] text-muted-foreground/70">{f.hint}</div>
            </div>
          ))}

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 px-6 py-3 border-t border-border bg-card">
          <div className="text-[11px] text-muted-foreground">
            {hasRegenBudget
              ? "Feedback wordt ook opgeslagen voor toekomstige refreshes."
              : "Geen credits meer beschikbaar voor deze slot."}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="inline-flex items-center h-9 px-3.5 rounded-md text-sm font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              Annuleer
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              title={
                !hasRegenBudget
                  ? "Geen credits meer voor deze slot"
                  : !hasAnyContent
                    ? "Vul minstens één veld in"
                    : "Pas aan met deze context"
              }
              className={cn(
                "inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-sm font-medium transition-opacity",
                "bg-amber-600 text-white hover:bg-amber-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
              )}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {submitting ? "Aanpassen…" : "Pas aan met deze context"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Convert structured feedback into a prompt-additive string that the
 *  image-gen route appends to the imagePrompt. Format matches Pedro's
 *  expectation for context blocks (Engels for model fidelity). */
export function feedbackToPromptAddendum(payload: RegenFeedbackPayload): string {
  const parts: string[] = []
  if (payload.imageFeedback.trim()) {
    parts.push(`IMAGE CONTENT: ${payload.imageFeedback.trim()}`)
  }
  if (payload.textFeedback.trim()) {
    parts.push(`ON-IMAGE TEXT: ${payload.textFeedback.trim()}`)
  }
  if (payload.designFeedback.trim()) {
    parts.push(`DESIGN / STYLE: ${payload.designFeedback.trim()}`)
  }
  if (payload.otherFeedback.trim()) {
    parts.push(`ADDITIONAL CONTEXT: ${payload.otherFeedback.trim()}`)
  }
  if (parts.length === 0) return ""
  return `\n\n---\nCM REGEN FEEDBACK (CRITICAL - fix these specifically):\n${parts.join("\n")}\n---`
}
