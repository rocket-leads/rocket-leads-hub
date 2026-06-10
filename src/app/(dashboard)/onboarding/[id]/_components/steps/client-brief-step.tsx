"use client"

import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Sparkles, Save, ArrowRight, Loader2, CheckCircle2, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
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

/** Persisted shape for this step's `content` blob. The AM edits each
 *  field in place; competitorAnalysis is a separate AI generation that
 *  populates its own field (Phase 1 ships it as a manual textarea while
 *  the AI hook is being built; the UI is wired the same way). */
type BriefContent = {
  brief: {
    bedrijf: string
    sector: string
    doelgroep: string
    pijnpunten: string
    aanbod: string
    usps: string
    marketingHooks: string
    websiteUrl: string
    driveLink: string
    source: string
  }
  concurrentieAnalyse: string
}

const EMPTY: BriefContent = {
  brief: {
    bedrijf: "",
    sector: "",
    doelgroep: "",
    pijnpunten: "",
    aanbod: "",
    usps: "",
    marketingHooks: "",
    websiteUrl: "",
    driveLink: "",
    source: "",
  },
  concurrentieAnalyse: "",
}

/**
 * Client Brief step. Calls Pedro's existing /api/pedro/auto-brief — the
 * same generator the CM's brief tab uses — to produce an AI draft from
 * the kick-off transcript + Trengo + Monday context. AM edits inline,
 * adds competitor analysis, then saves & continues.
 */
export function ClientBriefStep({ step, mondayItemId, client, locale, nextKey, onStepSaved }: Props) {
  // Load prior content (revisit case) — render whatever was last saved.
  const stored = step.content as BriefContent | null
  const [content, setContent] = useState<BriefContent>(() => {
    if (stored && typeof stored === "object" && "brief" in stored) {
      return { ...EMPTY, ...stored, brief: { ...EMPTY.brief, ...stored.brief } }
    }
    return EMPTY
  })

  // When the stored payload arrives later (React Query refetch), sync it
  // into the form ONLY if the user hasn't started editing.
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (touched) return
    if (stored && typeof stored === "object" && "brief" in stored) {
      setContent({ ...EMPTY, ...stored, brief: { ...EMPTY.brief, ...stored.brief } })
    }
  }, [stored, touched])

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pedro/auto-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: mondayItemId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Brief generation failed")
      }
      return res.json() as Promise<{ brief: BriefContent["brief"] }>
    },
    onSuccess: ({ brief }) => {
      setContent((c) => ({ ...c, brief: { ...EMPTY.brief, ...brief } }))
      setTouched(true)
    },
  })

  const save = useMutation({
    mutationFn: async (vars: { done: boolean }) => {
      const res = await fetch(`/api/clients/${mondayItemId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepKey: step.key,
          done: vars.done,
          content,
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

  const updateBrief = (field: keyof BriefContent["brief"], value: string) => {
    setTouched(true)
    setContent((c) => ({ ...c, brief: { ...c.brief, [field]: value } }))
  }

  const isEmpty = !content.brief.bedrijf && !content.brief.sector && !content.brief.doelgroep

  return (
    <div className="space-y-5">
      {/* AI generation row — single button when empty, "Re-generate" once filled. */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          {isEmpty
            ? t("onboarding.wizard.brief.generate_hint", locale)
            : t("onboarding.wizard.brief.regenerate_hint", locale)}
        </div>
        <Button
          size="sm"
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          className="gap-1.5"
        >
          {generate.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {isEmpty
            ? t("onboarding.wizard.brief.generate_btn", locale)
            : t("onboarding.wizard.brief.regenerate_btn", locale)}
        </Button>
      </div>

      {generate.isError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {generate.error instanceof Error ? generate.error.message : "Failed"}
        </div>
      )}

      {/* Brief form — flat layout, no card chrome to keep it focused. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={t("onboarding.wizard.brief.field.bedrijf", locale)}>
          <Input
            value={content.brief.bedrijf}
            onChange={(e) => updateBrief("bedrijf", e.target.value)}
            placeholder={client.companyName || client.name}
          />
        </Field>
        <Field label={t("onboarding.wizard.brief.field.sector", locale)}>
          <Input
            value={content.brief.sector}
            onChange={(e) => updateBrief("sector", e.target.value)}
            placeholder="Renovatie, verduurzaming, …"
          />
        </Field>
        <Field label={t("onboarding.wizard.brief.field.websiteUrl", locale)}>
          <Input
            value={content.brief.websiteUrl}
            onChange={(e) => updateBrief("websiteUrl", e.target.value)}
            placeholder="https://"
          />
        </Field>
        <Field label={t("onboarding.wizard.brief.field.driveLink", locale)}>
          <Input
            value={content.brief.driveLink}
            onChange={(e) => updateBrief("driveLink", e.target.value)}
            placeholder="https://drive.google.com/…"
          />
        </Field>
      </div>

      <Field label={t("onboarding.wizard.brief.field.doelgroep", locale)}>
        <textarea
          value={content.brief.doelgroep}
          onChange={(e) => updateBrief("doelgroep", e.target.value)}
          rows={3}
          className={textareaCls}
          placeholder={t("onboarding.wizard.brief.placeholder.doelgroep", locale)}
        />
      </Field>

      <Field label={t("onboarding.wizard.brief.field.pijnpunten", locale)}>
        <textarea
          value={content.brief.pijnpunten}
          onChange={(e) => updateBrief("pijnpunten", e.target.value)}
          rows={3}
          className={textareaCls}
          placeholder={t("onboarding.wizard.brief.placeholder.pijnpunten", locale)}
        />
      </Field>

      <Field label={t("onboarding.wizard.brief.field.aanbod", locale)}>
        <textarea
          value={content.brief.aanbod}
          onChange={(e) => updateBrief("aanbod", e.target.value)}
          rows={3}
          className={textareaCls}
          placeholder={t("onboarding.wizard.brief.placeholder.aanbod", locale)}
        />
      </Field>

      <Field label={t("onboarding.wizard.brief.field.usps", locale)}>
        <textarea
          value={content.brief.usps}
          onChange={(e) => updateBrief("usps", e.target.value)}
          rows={3}
          className={textareaCls}
          placeholder={t("onboarding.wizard.brief.placeholder.usps", locale)}
        />
      </Field>

      <Field label={t("onboarding.wizard.brief.field.marketingHooks", locale)}>
        <textarea
          value={content.brief.marketingHooks}
          onChange={(e) => updateBrief("marketingHooks", e.target.value)}
          rows={4}
          className={textareaCls}
          placeholder={t("onboarding.wizard.brief.placeholder.marketingHooks", locale)}
        />
      </Field>

      {/* Competitor analysis — separate section because it's its own
          deliverable in Drive once filled. Phase 1 ships the textarea
          + a "Generate (AI)" button placeholder so the flow is complete. */}
      <div className="pt-2 border-t border-border/40">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <h4 className="text-sm font-semibold">
              {t("onboarding.wizard.brief.field.concurrentieAnalyse", locale)}
            </h4>
          </div>
          <Button size="sm" variant="outline" disabled className="gap-1.5" title="Phase 2">
            <Sparkles className="h-3.5 w-3.5" />
            {t("onboarding.wizard.brief.competitor_generate_btn", locale)}
          </Button>
        </div>
        <textarea
          value={content.concurrentieAnalyse}
          onChange={(e) => {
            setTouched(true)
            setContent((c) => ({ ...c, concurrentieAnalyse: e.target.value }))
          }}
          rows={6}
          className={textareaCls}
          placeholder={t("onboarding.wizard.brief.placeholder.concurrentieAnalyse", locale)}
        />
      </div>

      {/* Sticky footer-ish action row */}
      <div className="flex items-center justify-between gap-3 pt-4 border-t border-border/40">
        <Button
          variant="ghost"
          onClick={() => save.mutate({ done: false })}
          disabled={save.isPending}
          className="gap-1.5"
        >
          {save.isPending && save.variables?.done === false ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {t("onboarding.wizard.brief.save_draft", locale)}
        </Button>
        <Button
          onClick={() => save.mutate({ done: true })}
          disabled={save.isPending || isEmpty}
          className="gap-1.5"
        >
          {save.isPending && save.variables?.done === true ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : step.done ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <ArrowRight className="h-3.5 w-3.5" />
          )}
          {step.done
            ? t("onboarding.wizard.brief.save_and_continue", locale)
            : t("onboarding.wizard.brief.approve_and_continue", locale)}
        </Button>
      </div>

      {save.isError && (
        <div className="text-xs text-destructive">
          {save.error instanceof Error ? save.error.message : "Save failed"}
        </div>
      )}
    </div>
  )
}

const textareaCls = cn(
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
  "placeholder:text-muted-foreground/50 resize-y",
  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0",
)

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      {children}
    </label>
  )
}
