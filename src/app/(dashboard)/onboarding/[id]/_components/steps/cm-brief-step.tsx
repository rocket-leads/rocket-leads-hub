"use client"

import { FileText, AlertCircle, Sparkles } from "lucide-react"
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
  hiddenContent?: Record<string, unknown>
  locale: Locale
  nextKey: string | undefined
  onStepSaved: (nextStepKey?: string) => void
}

type BriefFields = {
  bedrijf: string
  sector: string
  websiteUrl: string
  doelgroep: string
  pijnpunten: string
  aanbod: string
  usps: string
  marketingHooks: string
}

const FIELD_ORDER: Array<keyof BriefFields> = [
  "bedrijf",
  "sector",
  "websiteUrl",
  "doelgroep",
  "pijnpunten",
  "aanbod",
  "usps",
  "marketingHooks",
]

const FIELD_LABEL_KEYS: Record<keyof BriefFields, DictionaryKey> = {
  bedrijf: "onboarding.wizard.brief.field.bedrijf",
  sector: "onboarding.wizard.brief.field.sector",
  websiteUrl: "onboarding.wizard.brief.field.websiteUrl",
  doelgroep: "onboarding.wizard.brief.field.doelgroep",
  pijnpunten: "onboarding.wizard.brief.field.pijnpunten",
  aanbod: "onboarding.wizard.brief.field.aanbod",
  usps: "onboarding.wizard.brief.field.usps",
  marketingHooks: "onboarding.wizard.brief.field.marketingHooks",
}

/**
 * Stap 4 — Creative briefing (CM-side, read-only view voor nu).
 *
 * Laadt automatisch de AM's brief in zodra Stap 1 (kick-off meeting)
 * is gedaan. De brief in deze stap is een aggregatie:
 *   - Stap 2 brief_enrichment.finalBrief wint per-veld (post-AI)
 *   - Stap 1 kickoff_live.briefDraft is de fallback (live ingevuld
 *     tijdens de call, ook zonder transcript)
 *
 * Roy 2026-06-11: "ook zonder de transcript wil ik dat die client
 * brief daar wordt ingeladen". Sub-tool om de brief te verrijken met
 * campagne-angles komt in een volgende sprint — voor nu zien CMs de
 * AM's werk live + krijgen ze een duidelijke hint waar het vandaan komt.
 */
export function CmBriefStep({ step: _step, allSteps, hiddenContent, locale }: Props) {
  // kickoff_live is in WIZARD_STEPS so its content sits in allSteps.
  // brief_enrichment is a hidden child row of transcript_brief and
  // comes through the wizard payload's hiddenContent map.
  const kickoffContent = pickContent(allSteps, "kickoff_live") as
    | { briefDraft?: Partial<BriefFields> }
    | null
  const enrichmentContent = (hiddenContent?.brief_enrichment ?? null) as
    | { finalBrief?: Partial<BriefFields> }
    | null

  // Merge: enrichment wins per non-empty field, kickoff draft fills in
  // the blanks. Empty fields become "not yet filled in" in the UI.
  const merged = mergeBrief(
    enrichmentContent?.finalBrief,
    kickoffContent?.briefDraft,
  )
  const hasAnything = Object.values(merged).some((v) => v.trim().length > 0)
  const fromEnrichment = Boolean(enrichmentContent?.finalBrief)

  return (
    <div className="space-y-5">
      {/* Provenance banner — Roy: "de campagnemanager moet weten dat
          dit gebaseerd is op de creative briefing van stap 1, zodra
          die gemaakt is". */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-start gap-2 text-xs">
        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
        <div className="text-foreground/80 leading-relaxed">
          {hasAnything
            ? fromEnrichment
              ? t("onboarding.wizard.cm_brief.source.enriched", locale)
              : t("onboarding.wizard.cm_brief.source.draft", locale)
            : t("onboarding.wizard.cm_brief.source.empty", locale)}
        </div>
      </div>

      {/* Brief content */}
      {hasAnything ? (
        <section className="space-y-4">
          {FIELD_ORDER.map((field) => {
            const value = merged[field].trim()
            return (
              <div key={field}>
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                  {t(FIELD_LABEL_KEYS[field], locale)}
                </h4>
                <div
                  className={cn(
                    "rounded-md px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed",
                    value ? "bg-muted/30 text-foreground" : "bg-muted/20 italic text-muted-foreground/60",
                  )}
                >
                  {value || t("onboarding.wizard.cm_brief.field.empty", locale)}
                </div>
              </div>
            )
          })}
        </section>
      ) : (
        <div className="rounded-xl border border-border/60 bg-card/30 px-5 py-10 text-center">
          <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="text-sm font-medium mb-1">
            {t("onboarding.wizard.cm_brief.empty.title", locale)}
          </h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {t("onboarding.wizard.cm_brief.empty.body", locale)}
          </p>
        </div>
      )}

      {/* Future-tool hint — Roy: "wel wil ik nu, in plaats van 'tools
          voor deze stap komen er nog aan', dat je daar neerzet wat er
          straks gebeurt op deze stap". */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs flex items-start gap-2">
        <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <span className="text-amber-700 dark:text-amber-300">
          {t("onboarding.wizard.cm_brief.future_tool", locale)}
        </span>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

function pickContent(allSteps: SerializedStep[], key: string): unknown {
  return allSteps.find((s) => s.key === key)?.content ?? null
}

function mergeBrief(
  primary: Partial<BriefFields> | undefined,
  fallback: Partial<BriefFields> | undefined,
): BriefFields {
  const out = {} as BriefFields
  for (const key of FIELD_ORDER) {
    const p = primary?.[key]?.trim?.() ?? ""
    const f = fallback?.[key]?.trim?.() ?? ""
    out[key] = p || f
  }
  return out
}
