"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  FileText,
  Sparkles,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  Wand2,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { BriefData, Angle } from "@/lib/pedro/helpers"

type Mode = "optimize-existing" | "scratch"

type Props = {
  selectedClientId: string | null
  selectedClientName: string
  /** When true, the "Verbeter bestaande LP" button is disabled with a
   *  hint. Used inside the onboarding wizard where the client doesn't
   *  have a live LP yet. */
  disableOptimizeMode?: boolean
  /** Header chrome is shown by default. Onboarding wraps in its own
   *  step header so it hides this one. */
  hideShellHeader?: boolean
  /** Optional pre-resolved brief from the caller (onboarding wizard
   *  passes the kickoff/enrichment merged brief here). When omitted,
   *  the endpoint falls back to pedro_client_state. */
  briefOverride?: Partial<BriefData>
  /** Optional pre-resolved angles. Same fallback rule as briefOverride. */
  anglesOverride?: Angle[]
  /** Persist the generated LP prompt to the wizard step. Onboarding
   *  passes this; Optimize leaves it undefined. */
  onPromptGenerated?: (lpPrompt: string) => void
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

/**
 * Pedro LP Refresh. Two modes:
 *
 *  - **optimize-existing** (default + primary): CM pastes the current LP
 *    URL + describes what to change. Pedro scrapes the page, treats it
 *    as structural anchor, and generates a Lovable prompt that recreates
 *    it with the requested improvements.
 *
 *  - **scratch**: build from brief + angles. Used in onboarding where
 *    no live LP exists yet.
 *
 * The Optimize side leaves Mode A enabled by default. The onboarding
 * wizard passes `disableOptimizeMode` since freshly-onboarded clients
 * don't have a live LP yet.
 */
export function LpRefresh({
  selectedClientId,
  selectedClientName,
  disableOptimizeMode,
  hideShellHeader,
  briefOverride,
  anglesOverride,
  onPromptGenerated,
}: Props) {
  // Default to scratch when optimize is disabled (onboarding context).
  const [mode, setMode] = useState<Mode>(
    disableOptimizeMode ? "scratch" : "optimize-existing",
  )
  const [currentLpUrl, setCurrentLpUrl] = useState("")
  const [steering, setSteering] = useState("")
  const [stijl, setStijl] = useState(STIJL_OPTIONS[0])
  const [lengte, setLengte] = useState(LENGTE_OPTIONS[1])
  const [pixelId, setPixelId] = useState("")
  const [webhookUrl, setWebhookUrl] = useState("")
  const [utmStr, setUtmStr] = useState(
    "utm_source=meta&utm_medium=paid&utm_campaign={{naam}}",
  )
  const [lpPrompt, setLpPrompt] = useState("")
  const [copied, setCopied] = useState(false)

  // Per-client localStorage rehydration for the URL field — saves a
  // typing round-trip when the CM revisits.
  const storageKey = useMemo(
    () => (selectedClientId ? `pedro.lp.url.${selectedClientId}` : null),
    [selectedClientId],
  )
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return
    const saved = window.localStorage.getItem(storageKey)
    if (saved) setCurrentLpUrl(saved)
  }, [storageKey])
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return
    if (currentLpUrl.trim()) window.localStorage.setItem(storageKey, currentLpUrl)
  }, [storageKey, currentLpUrl])

  const generate = useMutation({
    mutationFn: async () => {
      if (!selectedClientId) throw new Error("Geen klant geselecteerd")
      const res = await fetch("/api/pedro/lp-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          clientId: selectedClientId,
          currentLpUrl: mode === "optimize-existing" ? currentLpUrl : undefined,
          stijl: mode === "scratch" ? stijl : undefined,
          lengte: mode === "scratch" ? lengte : undefined,
          steering: steering.trim() || undefined,
          pixelId: pixelId.trim() || undefined,
          webhookUrl: webhookUrl.trim() || undefined,
          utmStr: utmStr.trim() || undefined,
          brief: briefOverride,
          selectedAngles: anglesOverride,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "LP generate failed")
      }
      return res.json() as Promise<{ mode: Mode; lpPrompt: string; anglesUsed: number }>
    },
    onSuccess: ({ lpPrompt }) => {
      setLpPrompt(lpPrompt)
      onPromptGenerated?.(lpPrompt)
    },
  })

  const copyPrompt = async () => {
    if (!lpPrompt) return
    try {
      await navigator.clipboard.writeText(lpPrompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked - non-fatal */
    }
  }

  const canGenerate =
    !!selectedClientId &&
    (mode === "scratch" || (currentLpUrl.trim().length > 0 && steering.trim().length > 0))

  return (
    <div className="space-y-5">
      {!hideShellHeader && (
        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)]">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="font-heading font-semibold text-base tracking-tight">
                LP refresh
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Verbeter de bestaande landingspagina door de URL + wens te geven, of bouw vanaf
                scratch op basis van brief + angles.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Mode switcher — Roy 2026-06-11: paars/primary voor "verbeter
          bestaande" omdat dat in 95% van de gevallen het juiste pad is
          voor live klanten. Scratch is fallback voor onboarding. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ModeButton
          active={mode === "optimize-existing"}
          onClick={() => setMode("optimize-existing")}
          disabled={disableOptimizeMode}
          tone="primary"
          icon={Wand2}
          title="Verbeter bestaande LP"
          body={
            disableOptimizeMode
              ? "Nog geen live LP voor deze klant — onboarding bouwt 'm eerst vanaf scratch."
              : "Plak de huidige LP URL + wat je wilt veranderen. Pedro recreëert + verbetert."
          }
        />
        <ModeButton
          active={mode === "scratch"}
          onClick={() => setMode("scratch")}
          tone="outline"
          icon={RefreshCw}
          title="Bouw vanaf scratch"
          body="Geen URL nodig — Pedro bouwt op basis van brief + geselecteerde angles."
        />
      </div>

      {/* Mode-specific input panel */}
      {mode === "optimize-existing" ? (
        <section className="rounded-xl border border-border/60 bg-card/50 p-5 space-y-3">
          <Field
            label="Huidige LP URL"
            hint="bv. https://acme-leads.com — Pedro scrapet de live pagina."
          >
            <Input
              value={currentLpUrl}
              onChange={(e) => setCurrentLpUrl(e.target.value)}
              placeholder="https://..."
              className="text-sm"
            />
          </Field>
          <Field
            label="Wat moet er veranderen?"
            hint="Concreet. Bv. 'hero korter en pijnpunt-driven', 'social proof boven de fold', 'CTA naar Calendly ipv leadform'."
          >
            <textarea
              value={steering}
              onChange={(e) => setSteering(e.target.value)}
              rows={4}
              className="w-full text-sm rounded-md border border-border/60 bg-background px-3 py-2 leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 resize-y"
              placeholder="Beschrijf de gewenste aanpassingen…"
            />
          </Field>
        </section>
      ) : (
        <>
          <section className="rounded-xl border border-border/60 bg-card/50 p-5 space-y-3">
            <SectionHeader title="Stijl" body="Toon en visuele richting." />
            <ChipRow
              options={STIJL_OPTIONS}
              value={stijl}
              onChange={setStijl}
            />
          </section>
          <section className="rounded-xl border border-border/60 bg-card/50 p-5 space-y-3">
            <SectionHeader
              title="Lengte"
              body="Korter = sneller laden. Langer = meer overtuiging voor high-ticket."
            />
            <ChipRow
              options={LENGTE_OPTIONS}
              value={lengte}
              onChange={setLengte}
            />
          </section>
          <section className="rounded-xl border border-border/60 bg-card/50 p-5 space-y-3">
            <SectionHeader
              title="Optionele steering"
              body="Iets specifieks dat in deze nieuwe LP moet."
            />
            <Input
              value={steering}
              onChange={(e) => setSteering(e.target.value)}
              placeholder="bv. 'pijnpunt-driven hero', 'extra urgentie'"
              className="text-sm"
            />
          </section>
        </>
      )}

      {/* Tracking — shared between modes, collapsed by default? No, keep visible: pixel/webhook are easy to forget. */}
      <section className="rounded-xl border border-border/60 bg-card/50 p-5 space-y-3">
        <SectionHeader
          title="Pixel & tracking"
          body="Wordt direct in de Lovable prompt verwerkt — fbq init + Lead event + form-POST."
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Meta Pixel ID">
            <Input
              value={pixelId}
              onChange={(e) => setPixelId(e.target.value)}
              placeholder="bv. 1234567890123456"
              className="text-xs"
            />
          </Field>
          <Field label="Zapier webhook URL">
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.zapier.com/..."
              className="text-xs"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="UTM structuur">
              <Input
                value={utmStr}
                onChange={(e) => setUtmStr(e.target.value)}
                className="text-xs"
              />
            </Field>
          </div>
        </div>
      </section>

      {/* Generate */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted-foreground">
          {selectedClientId
            ? `Klant: ${selectedClientName || selectedClientId}`
            : "Selecteer eerst een klant"}
        </div>
        <Button
          onClick={() => generate.mutate()}
          disabled={!canGenerate || generate.isPending}
          className="gap-1.5"
        >
          {generate.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {lpPrompt ? "Opnieuw genereren" : "Genereer Lovable prompt"}
        </Button>
      </div>

      {generate.isError && (
        <p className="text-xs text-destructive">
          {generate.error instanceof Error ? generate.error.message : "Failed"}
        </p>
      )}

      {/* Output */}
      {lpPrompt && (
        <section className="rounded-xl border border-border/60 bg-card/50 p-5 space-y-3">
          <SectionHeader
            title="Lovable prompt"
            body="Kopieer en plak in Lovable om de pagina te bouwen."
          />
          <div className="rounded-lg border border-border/60 bg-background p-4 max-h-[500px] overflow-auto">
            <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono">
              {lpPrompt}
            </pre>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={copyPrompt} className="gap-1.5">
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              Kopieer
            </Button>
            <a
              href="https://lovable.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
            >
              Open Lovable <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        </section>
      )}
    </div>
  )
}

// ── Subcomponents ────────────────────────────────────────────────────────

function ModeButton({
  active,
  onClick,
  disabled,
  tone,
  icon: Icon,
  title,
  body,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  tone: "primary" | "outline"
  icon: typeof Wand2
  title: string
  body: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "text-left rounded-xl border p-4 transition-all flex items-start gap-3",
        disabled && "opacity-50 cursor-not-allowed",
        !disabled && "hover:border-primary/60",
        active && tone === "primary" && "border-primary bg-primary/10 ring-2 ring-primary/20",
        active && tone === "outline" && "border-foreground/40 bg-card",
        !active && "border-border/60 bg-card/40",
      )}
    >
      <div
        className={cn(
          "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
          active && tone === "primary" && "bg-primary text-primary-foreground",
          active && tone === "outline" && "bg-foreground/10 text-foreground",
          !active && "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div
          className={cn(
            "font-heading font-semibold text-sm",
            active && tone === "primary" && "text-primary",
          )}
        >
          {title}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{body}</div>
      </div>
    </button>
  )
}

function SectionHeader({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-[11px] text-muted-foreground mt-0.5">{body}</p>
    </div>
  )
}

function ChipRow({
  options,
  value,
  onChange,
}: {
  options: string[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
            value === opt
              ? "bg-primary/10 border-primary text-primary"
              : "bg-transparent border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary",
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground/80 leading-snug">{hint}</p>}
    </div>
  )
}
