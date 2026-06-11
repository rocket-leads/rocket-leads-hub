"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Sparkles,
  Loader2,
  Check,
  X,
  ArrowRight,
  AlertCircle,
  Quote,
  Plus,
  Repeat,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import type { DictionaryKey } from "@/lib/i18n/dictionary"
import { cn } from "@/lib/utils"
import type { SerializedStep, WizardClient } from "../wizard-shell"

type Props = {
  step: SerializedStep
  mondayItemId: string
  client: WizardClient
  allSteps: SerializedStep[]
  locale: Locale
  nextKey: string | undefined
  onStepSaved: (nextStepKey?: string) => void
}

type BriefFields =
  | "bedrijf"
  | "sector"
  | "websiteUrl"
  | "doelgroep"
  | "pijnpunten"
  | "aanbod"
  | "usps"
  | "marketingHooks"

const FIELD_ORDER: BriefFields[] = [
  "bedrijf",
  "sector",
  "websiteUrl",
  "doelgroep",
  "pijnpunten",
  "aanbod",
  "usps",
  "marketingHooks",
]

// Explicit field → dictionary key map so the i18n type system can
// verify each lookup at build time. Template-literal lookups don't
// satisfy `DictionaryKey` no matter the runtime shape.
const FIELD_LABEL_KEYS: Record<BriefFields, DictionaryKey> = {
  bedrijf: "onboarding.wizard.brief.field.bedrijf",
  sector: "onboarding.wizard.brief.field.sector",
  websiteUrl: "onboarding.wizard.brief.field.websiteUrl",
  doelgroep: "onboarding.wizard.brief.field.doelgroep",
  pijnpunten: "onboarding.wizard.brief.field.pijnpunten",
  aanbod: "onboarding.wizard.brief.field.aanbod",
  usps: "onboarding.wizard.brief.field.usps",
  marketingHooks: "onboarding.wizard.brief.field.marketingHooks",
}

type FieldSuggestion = {
  amValue: string
  suggestion: string
  rationale: string
  mode: "add" | "replace"
}

type EnrichmentContent = {
  suggestions?: Record<BriefFields, FieldSuggestion>
  insufficientTranscript?: boolean
  /** Per-field accept state - the AM's decision per row. Persisted
   *  across saves so a refresh doesn't lose accept/reject decisions
   *  before they hit "Approve & continue". */
  accepted?: Partial<Record<BriefFields, boolean>>
  generatedAt?: string
  finalBrief?: Record<BriefFields, string>
}

/**
 * Stap 3 - Brief enrichment diff view.
 *
 * Reads:
 *   - AM's live brief draft from Stap 1's content
 *   - Linked Fathom transcript from Stap 2 (server-side, via the
 *     enrichment endpoint that joins both before calling Claude)
 *
 * Shows per-field rows: AM's value · AI suggestion · accept/reject pills.
 * On approve, merges accepted suggestions into final brief and saves to
 * step content. Sprint 3 (Drive PDF upload) takes it from there.
 */
export function BriefEnrichmentStep({
  step,
  mondayItemId,
  locale,
  nextKey,
  onStepSaved,
}: Props) {
  const queryClient = useQueryClient()
  const content = (step.content as EnrichmentContent | null) ?? {}
  const suggestions = content.suggestions ?? null
  const insufficientTranscript = Boolean(content.insufficientTranscript)

  // Local per-field accept state - initialised from persisted content so
  // a page reload preserves the AM's decisions.
  const [accepted, setAccepted] = useState<Partial<Record<BriefFields, boolean>>>(
    content.accepted ?? {},
  )

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/clients/${mondayItemId}/onboarding/brief-enrichment`,
        { method: "POST" },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Generate failed")
      }
      return res.json()
    },
    onSuccess: () => {
      // Reset accept state - new suggestions, new decisions.
      setAccepted({})
      queryClient.invalidateQueries({ queryKey: ["onboarding-wizard", mondayItemId] })
    },
  })

  const save = useMutation({
    mutationFn: async (vars: { done: boolean }) => {
      // Compute final brief from suggestions + accept decisions.
      const finalBrief = computeFinalBrief(suggestions, accepted)
      const res = await fetch(`/api/clients/${mondayItemId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepKey: step.key,
          done: vars.done,
          content: { ...content, accepted, finalBrief },
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Save failed")
      }
      return res.json()
    },
    onSuccess: (_data, vars) => {
      onStepSaved(vars.done ? nextKey : undefined)
    },
  })

  // ── Initial empty state - needs "generate" before anything to diff ──
  if (!suggestions) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border/60 bg-card/50 p-5">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {t("onboarding.wizard.enrich.start.title", locale)}
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            {t("onboarding.wizard.enrich.start.body", locale)}
          </p>
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="gap-1.5"
          >
            {generate.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {t("onboarding.wizard.enrich.start.btn", locale)}
          </Button>
          {generate.isError && (
            <div className="mt-3 text-xs text-destructive">
              {generate.error instanceof Error ? generate.error.message : "Failed"}
            </div>
          )}
        </div>

        {insufficientTranscript && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <span className="text-amber-700 dark:text-amber-300">
              {t("onboarding.wizard.enrich.insufficient", locale)}
            </span>
          </div>
        )}
      </div>
    )
  }

  // ── Diff view - one row per field ──
  const usefulFields = FIELD_ORDER.filter(
    (f) => (suggestions[f]?.suggestion ?? "").length > 0,
  )
  const allDecided =
    usefulFields.length > 0 &&
    usefulFields.every((f) => accepted[f] !== undefined)
  const anyAccepted = Object.values(accepted).some((v) => v === true)

  return (
    <div className="space-y-4">
      {/* Header with re-generate */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {usefulFields.length === 0
            ? t("onboarding.wizard.enrich.no_suggestions", locale)
            : t("onboarding.wizard.enrich.diff.hint", locale)}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          className="gap-1.5"
        >
          {generate.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {t("onboarding.wizard.enrich.regenerate", locale)}
        </Button>
      </div>

      {usefulFields.length > 0 && (
        <ul className="space-y-3">
          {usefulFields.map((field) => (
            <SuggestionRow
              key={field}
              field={field}
              suggestion={suggestions[field]}
              decision={accepted[field]}
              onAccept={() => setAccepted((a) => ({ ...a, [field]: true }))}
              onReject={() => setAccepted((a) => ({ ...a, [field]: false }))}
              locale={locale}
            />
          ))}
        </ul>
      )}

      {/* Footer - approve & save */}
      <div className="flex items-center justify-between gap-3 pt-4 border-t border-border/40">
        <p className="text-[11px] text-muted-foreground">
          {usefulFields.length > 0
            ? t("onboarding.wizard.enrich.decided_count", locale)
                .replace("{decided}", String(Object.keys(accepted).length))
                .replace("{total}", String(usefulFields.length))
            : ""}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => save.mutate({ done: false })}
            disabled={save.isPending}
            className="gap-1.5"
          >
            {save.isPending && save.variables?.done === false && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {t("onboarding.wizard.enrich.save_draft", locale)}
          </Button>
          <Button
            onClick={() => save.mutate({ done: true })}
            disabled={save.isPending || (usefulFields.length > 0 && !allDecided)}
            className="gap-1.5"
            title={
              usefulFields.length > 0 && !allDecided
                ? t("onboarding.wizard.enrich.decide_first", locale)
                : undefined
            }
          >
            {save.isPending && save.variables?.done === true ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowRight className="h-3.5 w-3.5" />
            )}
            {anyAccepted
              ? t("onboarding.wizard.enrich.approve_and_continue", locale)
              : t("onboarding.wizard.enrich.skip_and_continue", locale)}
          </Button>
        </div>
      </div>

      {save.isError && (
        <div className="text-xs text-destructive">
          {save.error instanceof Error ? save.error.message : "Save failed"}
        </div>
      )}
    </div>
  )
}

// ─── Suggestion row ────────────────────────────────────────────────────────

function SuggestionRow({
  field,
  suggestion,
  decision,
  onAccept,
  onReject,
  locale,
}: {
  field: BriefFields
  suggestion: FieldSuggestion
  decision: boolean | undefined
  onAccept: () => void
  onReject: () => void
  locale: Locale
}) {
  return (
    <li
      className={cn(
        "rounded-xl border bg-card/50 p-4 transition-colors",
        decision === true && "border-emerald-500/30 bg-emerald-500/5",
        decision === false && "border-border/40 opacity-60",
        decision === undefined && "border-border/60",
      )}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium">
            {t(FIELD_LABEL_KEYS[field], locale)}
          </h4>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
              suggestion.mode === "replace"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                : "bg-primary/10 text-primary",
            )}
          >
            {suggestion.mode === "replace" ? (
              <>
                <Repeat className="h-2.5 w-2.5" />
                {t("onboarding.wizard.enrich.mode.replace", locale)}
              </>
            ) : (
              <>
                <Plus className="h-2.5 w-2.5" />
                {t("onboarding.wizard.enrich.mode.add", locale)}
              </>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant={decision === true ? "default" : "outline"}
            onClick={onAccept}
            className="h-7 gap-1 text-xs"
          >
            <Check className="h-3 w-3" />
            {t("onboarding.wizard.enrich.accept", locale)}
          </Button>
          <Button
            size="sm"
            variant={decision === false ? "default" : "outline"}
            onClick={onReject}
            className="h-7 gap-1 text-xs"
          >
            <X className="h-3 w-3" />
            {t("onboarding.wizard.enrich.reject", locale)}
          </Button>
        </div>
      </div>

      <div className="space-y-2 text-xs">
        {/* AM's value */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
            {t("onboarding.wizard.enrich.am_filled", locale)}
          </div>
          <div className="text-muted-foreground bg-muted/30 rounded px-2 py-1.5 whitespace-pre-wrap leading-relaxed">
            {suggestion.amValue || (
              <span className="italic text-muted-foreground/50">
                {t("onboarding.wizard.enrich.am_empty", locale)}
              </span>
            )}
          </div>
        </div>
        {/* AI suggestion */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-primary mb-0.5 inline-flex items-center gap-1">
            <Sparkles className="h-2.5 w-2.5" />
            {suggestion.mode === "replace"
              ? t("onboarding.wizard.enrich.ai_replace", locale)
              : t("onboarding.wizard.enrich.ai_add", locale)}
          </div>
          <div className="text-foreground bg-primary/5 border border-primary/20 rounded px-2 py-1.5 whitespace-pre-wrap leading-relaxed">
            {suggestion.suggestion}
          </div>
        </div>
        {/* Rationale */}
        {suggestion.rationale && (
          <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground/80 pt-1">
            <Quote className="h-3 w-3 mt-0.5 shrink-0" />
            <span className="italic">{suggestion.rationale}</span>
          </div>
        )}
      </div>
    </li>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function computeFinalBrief(
  suggestions: Record<BriefFields, FieldSuggestion> | null,
  accepted: Partial<Record<BriefFields, boolean>>,
): Record<BriefFields, string> {
  const out = {} as Record<BriefFields, string>
  for (const field of FIELD_ORDER) {
    const s = suggestions?.[field]
    if (!s) {
      out[field] = ""
      continue
    }
    if (accepted[field] !== true) {
      // Rejected or undecided - keep AM's value as-is.
      out[field] = s.amValue
      continue
    }
    // Accepted.
    if (s.mode === "replace") {
      out[field] = s.suggestion
    } else {
      // add - append to AM's value with a separator. Empty AM value
      // becomes the suggestion outright (no leading newline cruft).
      out[field] = s.amValue
        ? `${s.amValue}\n\n${s.suggestion}`
        : s.suggestion
    }
  }
  return out
}
