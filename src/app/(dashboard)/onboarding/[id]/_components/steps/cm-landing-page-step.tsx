"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Loader2, Sparkles, Copy, Check, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import { cn } from "@/lib/utils"
import type { BriefData } from "@/lib/pedro/helpers"
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

// Wizard's BriefFields shape (from kickoff_live + brief_enrichment).
// Different from Pedro's internal BriefData - mapped below in toPedroBrief.
type WizardBriefFields = {
  bedrijf: string
  sector: string
  doelgroep: string
  pijnpunten: string
  aanbod: string
  usps: string
  marketingHooks: string
}

type LpConfig = {
  stijl: string
  lengte: string
  pixelId: string
  webhookUrl: string
  utmStr: string
}

type LpContent = LpConfig & {
  lpPrompt: string
  steering: string
}

const STIJL_OPTIONS = [
  "Modern - clean, business",
  "Bold - urgentie, conversie-focus",
  "Premium - high-ticket, trust",
  "Friendly - warm, persoonlijk",
]

const LENGTE_OPTIONS = [
  "Short - hero + CTA",
  "Medium - hero + social proof + form",
  "Long - + FAQ + bezwaren",
]

const EMPTY_CONTENT: LpContent = {
  stijl: STIJL_OPTIONS[0],
  lengte: LENGTE_OPTIONS[1],
  pixelId: "",
  webhookUrl: "",
  utmStr: "utm_source=meta&utm_medium=paid&utm_campaign={{naam}}",
  lpPrompt: "",
  steering: "",
}

/**
 * Stap 8 — Landingspagina (CM). One-shot Lovable prompt generator.
 *
 * Pedro's standalone LP component bestaat (nog) niet als losse file -
 * de logic zit in pedro-campaign.tsx. Tot we die extraheren naar een
 * volledige LpRefresh sibling van AnglesRefresh c.s. doen we het hier
 * minimaal: brief uit kickoff_live + brief_enrichment, angles uit
 * pedro_client_state (gevuld door Stap 6 cm_angles), CM kiest stijl +
 * lengte + vult tracking in, krijgt 1 Lovable prompt terug.
 */
export function CmLandingPageStep({
  step,
  mondayItemId,
  allSteps,
  hiddenContent,
  locale,
  onStepSaved,
}: Props) {
  const initial = (step.content as Partial<LpContent> | null) ?? null
  const [config, setConfig] = useState<LpContent>({
    ...EMPTY_CONTENT,
    ...(initial ?? {}),
  })

  // Wizard brief is the source of truth - state.brief in Pedro is the
  // CM-side enriched version which might not be populated yet for a
  // fresh onboarding client.
  const wizardBrief = useMemo(
    () => pickWizardBrief(allSteps, hiddenContent),
    [allSteps, hiddenContent],
  )

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/pedro/lp-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: mondayItemId,
          stijl: config.stijl,
          lengte: config.lengte,
          pixelId: config.pixelId,
          webhookUrl: config.webhookUrl,
          utmStr: config.utmStr,
          steering: config.steering || undefined,
          brief: toPedroBrief(wizardBrief),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "LP generate failed")
      }
      return res.json() as Promise<{
        lpPrompt: string
        anglesUsed: number
        briefSource: string
      }>
    },
    onSuccess: ({ lpPrompt }) => {
      setConfig((prev) => ({ ...prev, lpPrompt }))
    },
  })

  // Debounced save of the entire step.content blob whenever the user
  // edits a field. Persists to wizard_steps via the standard endpoint.
  const skipFirst = useRef(true)
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false
      return
    }
    const id = setTimeout(() => {
      void fetch(`/api/clients/${mondayItemId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepKey: step.key,
          done: !!config.lpPrompt,
          content: config,
        }),
      })
    }, 800)
    return () => clearTimeout(id)
  }, [config, mondayItemId, step.key])

  const [copied, setCopied] = useState(false)
  const copyPrompt = async () => {
    if (!config.lpPrompt) return
    try {
      await navigator.clipboard.writeText(config.lpPrompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked - non-fatal
    }
  }

  return (
    <div className="space-y-5">
      {/* Step intro */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-start gap-2 text-xs">
        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
        <span className="text-foreground/80 leading-relaxed">
          {t("onboarding.wizard.cm_lp.intro", locale)}
        </span>
      </div>

      {/* Stijl */}
      <section className="rounded-xl border border-border/60 bg-card/50 p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">
            {t("onboarding.wizard.cm_lp.stijl.title", locale)}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {t("onboarding.wizard.cm_lp.stijl.body", locale)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STIJL_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setConfig((p) => ({ ...p, stijl: s }))}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                config.stijl === s
                  ? "bg-primary/10 border-primary text-primary"
                  : "bg-transparent border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      {/* Lengte */}
      <section className="rounded-xl border border-border/60 bg-card/50 p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">
            {t("onboarding.wizard.cm_lp.lengte.title", locale)}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {t("onboarding.wizard.cm_lp.lengte.body", locale)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LENGTE_OPTIONS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setConfig((p) => ({ ...p, lengte: l }))}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                config.lengte === l
                  ? "bg-primary/10 border-primary text-primary"
                  : "bg-transparent border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </section>

      {/* Tracking */}
      <section className="rounded-xl border border-border/60 bg-card/50 p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">
            {t("onboarding.wizard.cm_lp.tracking.title", locale)}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {t("onboarding.wizard.cm_lp.tracking.body", locale)}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t("onboarding.wizard.cm_lp.tracking.pixel", locale)}>
            <Input
              value={config.pixelId}
              onChange={(e) => setConfig((p) => ({ ...p, pixelId: e.target.value }))}
              placeholder="bv. 1234567890123456"
              className="text-xs"
            />
          </Field>
          <Field label={t("onboarding.wizard.cm_lp.tracking.webhook", locale)}>
            <Input
              value={config.webhookUrl}
              onChange={(e) => setConfig((p) => ({ ...p, webhookUrl: e.target.value }))}
              placeholder="https://hooks.zapier.com/..."
              className="text-xs"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t("onboarding.wizard.cm_lp.tracking.utm", locale)}>
              <Input
                value={config.utmStr}
                onChange={(e) => setConfig((p) => ({ ...p, utmStr: e.target.value }))}
                className="text-xs"
              />
            </Field>
          </div>
        </div>
      </section>

      {/* Generate / output */}
      <section className="rounded-xl border border-border/60 bg-card/50 p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">
              {t("onboarding.wizard.cm_lp.generate.title", locale)}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {t("onboarding.wizard.cm_lp.generate.body", locale)}
            </p>
          </div>
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
            {config.lpPrompt
              ? t("onboarding.wizard.cm_lp.generate.regenerate", locale)
              : t("onboarding.wizard.cm_lp.generate.btn", locale)}
          </Button>
        </div>

        {generate.isError && (
          <p className="text-xs text-destructive">
            {generate.error instanceof Error ? generate.error.message : "Failed"}
          </p>
        )}

        {/* Output */}
        {config.lpPrompt && (
          <div className="space-y-2">
            <div className="rounded-lg border border-border/60 bg-background p-4 max-h-[500px] overflow-auto">
              <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono">
                {config.lpPrompt}
              </pre>
            </div>
            <Input
              value={config.steering}
              onChange={(e) => setConfig((p) => ({ ...p, steering: e.target.value }))}
              placeholder={t("onboarding.wizard.cm_lp.steering.placeholder", locale)}
              className="text-xs"
            />
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={copyPrompt} className="gap-1.5">
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {t("onboarding.wizard.cm_lp.copy", locale)}
              </Button>
              <a
                href="https://lovable.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
              >
                {t("onboarding.wizard.cm_lp.open_lovable", locale)}{" "}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
            {onStepSaved && (
              <div className="pt-2 flex justify-end">
                <Button size="sm" onClick={() => onStepSaved()}>
                  {t("onboarding.wizard.cm_lp.mark_done", locale)}
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
        {label}
      </label>
      {children}
    </div>
  )
}

function pickWizardBrief(
  allSteps: SerializedStep[],
  hiddenContent: Record<string, unknown> | undefined,
): WizardBriefFields {
  const kickoff = allSteps.find((s) => s.key === "kickoff_live")?.content as
    | { briefDraft?: Partial<WizardBriefFields> }
    | null
  const enrichment = hiddenContent?.brief_enrichment as
    | { finalBrief?: Partial<WizardBriefFields> }
    | null
  const empty: WizardBriefFields = {
    bedrijf: "",
    sector: "",
    doelgroep: "",
    pijnpunten: "",
    aanbod: "",
    usps: "",
    marketingHooks: "",
  }
  const out = { ...empty }
  for (const key of Object.keys(empty) as Array<keyof WizardBriefFields>) {
    const e = enrichment?.finalBrief?.[key]?.trim?.() ?? ""
    const k = kickoff?.briefDraft?.[key]?.trim?.() ?? ""
    out[key] = e || k
  }
  return out
}

function toPedroBrief(b: WizardBriefFields): Partial<BriefData> {
  // Maps the wizard's BriefFields to Pedro's internal BriefData shape.
  // doelgroep → doel, pijnpunten → pijn, marketingHooks → hooksAM
  // (Pedro's hooksExtra stays empty here - it's only filled by Pedro's
  // own brief-enrichment step which doesn't run in onboarding.)
  return {
    bedrijf: b.bedrijf,
    sector: b.sector,
    doel: b.doelgroep,
    pijn: b.pijnpunten,
    aanbod: b.aanbod,
    usps: b.usps,
    hooksAM: b.marketingHooks,
    hooksExtra: "",
  }
}
