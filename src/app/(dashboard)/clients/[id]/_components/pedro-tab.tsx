"use client"

import { useCallback, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import {
  Sparkles,
  AlertCircle,
  ExternalLink,
  Globe,
  Loader2,
  CheckCircle2,
  Wand2,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import { PedroSettingsPanel } from "@/app/(dashboard)/pedro/_components/pedro-settings-panel"

/**
 * Per-client Pedro configuration. Roy 2026-06-14: replaced the old
 * version/refresh history view — the client modal is now the canonical
 * surface for *setting up* Pedro per klant (brief, kick-off scan,
 * branding, creative settings) instead of just reporting on it. Advanced
 * authoring (angles, script, creatives) still lives in /pedro itself.
 *
 * Three stacked sections under the header:
 *   1. Creative Briefing — read-only snapshot + auto-create + edit-in-pedro
 *   2. Kick-off — website scan that persists detected brand_style
 *   3. PedroSettingsPanel — reuse of the optimize-page panel (Bronnen /
 *      Output / Look & feel / Brand identity incl. brand-colour editor)
 */

type AutoBriefMeta = {
  source?: string
  autoTriggered?: boolean
  triggeredAt?: string
  triggeredFromMeeting?: string
  fathomRecordingId?: string | null
}

type ClientState = {
  client_id: string
  campaign_number: number
  brief: Record<string, string> | null
  selected_angles: unknown[] | null
  script_text: string | null
  creatives: unknown
  lp: unknown
  ad_copy: unknown
  auto_brief_meta: AutoBriefMeta | null
  created_at: string
  updated_at: string
}

type ClientStateResponse = { state: ClientState | null }

function fmtDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(locale === "nl" ? "nl-NL" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function StatusPill({ state, locale }: { state: ClientState | null; locale: Locale }) {
  if (!state) {
    return (
      <span className="st-label idle">
        <span className="sd" />
        {t("client.pedro.status.not_started", locale)}
      </span>
    )
  }
  const isAutoDraft = state.auto_brief_meta?.autoTriggered === true
  const wasEdited =
    state.updated_at && state.created_at
      ? new Date(state.updated_at).getTime() - new Date(state.created_at).getTime() > 60_000
      : false
  if (isAutoDraft && !wasEdited) {
    return (
      <span className="st-label pending">
        <span className="sd" />
        {t("client.pedro.status.auto_draft", locale)}
      </span>
    )
  }
  return (
    <span className="st-label live">
      <span className="sd" />
      {t("client.pedro.status.active", locale, { n: String(state.campaign_number) })}
    </span>
  )
}

type Props = {
  mondayItemId: string
  clientName: string
  googleDriveId: string | null
  initialWebsiteUrl?: string | null
}

export function PedroTab({
  mondayItemId,
  clientName,
  googleDriveId,
  initialWebsiteUrl,
}: Props) {
  const locale = useLocale()

  // Bump on writes that change `brand_style` (kick-off scan), so the
  // embedded PedroSettingsPanel re-mounts and re-fetches `detected.*`.
  // The panel only loads on (open, clientId) — without this it'd render
  // stale colours after a successful scan.
  const [panelRefreshKey, setPanelRefreshKey] = useState(0)

  const { data, isLoading } = useQuery<ClientStateResponse>({
    queryKey: ["pedro-client-state", mondayItemId],
    queryFn: () =>
      fetch(`/api/pedro/client-state?clientId=${mondayItemId}`).then((r) => r.json()),
    staleTime: 60 * 1000,
  })

  const state = data?.state ?? null

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── Header card ── */}
      <Card>
        <CardContent className="py-5">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-heading font-semibold text-base">Pedro</h3>
            <StatusPill state={state} locale={locale} />
          </div>
          <p className="text-sm text-muted-foreground mt-1.5">
            {state
              ? `Brief en instellingen voor ${clientName}. Laatste wijziging ${fmtDate(state.updated_at, locale)}.`
              : `Configureer brief, branding en creative-instellingen voor ${clientName}.`}
          </p>
          {state?.auto_brief_meta?.source && (
            <p className="text-xs text-muted-foreground/70 italic mt-1">
              {state.auto_brief_meta.source}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Creative Briefing ── */}
      <BriefingSection
        mondayItemId={mondayItemId}
        clientName={clientName}
        state={state}
      />

      {/* ── Kick-off · website scan + branding ── */}
      <KickoffSection
        mondayItemId={mondayItemId}
        initialUrl={initialWebsiteUrl ?? ""}
        onScanned={() => setPanelRefreshKey((k) => k + 1)}
      />

      {/* ── Pedro instellingen (Bronnen / Output / Look & feel / Brand identity) ──
          Re-use the same panel that lives on /pedro/optimize. `open` is
          always true here because this tab IS the settings surface; the
          panel's own auto-close-after-save is suppressed by omitting the
          onClose callback. The `key` bump above forces a re-mount + fresh
          fetch of `detected.*` after a website scan lands new colours. */}
      <PedroSettingsPanel
        key={`pedro-settings-${panelRefreshKey}`}
        open
        clientId={mondayItemId}
        clientName={clientName}
        googleDriveId={googleDriveId}
      />

      {/* ── Footer: advanced authoring lives in /pedro ── */}
      <p className="text-[11px] text-muted-foreground/60 text-center pt-2">
        Voor angles, scripts en het maken van creatives:{" "}
        <Link
          href={`/pedro/onboard?clientId=${mondayItemId}`}
          className="text-primary hover:underline inline-flex items-center gap-1"
        >
          open Pedro
          <ExternalLink className="h-3 w-3" />
        </Link>
      </p>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Creative Briefing
// Read-only snapshot of the existing brief, plus the two CM actions
// that matter most from this surface: auto-create (for clients without
// any brief yet) and regenerate / hand off to full Pedro for editing.
// ──────────────────────────────────────────────────────────────────────

const BRIEF_FIELDS: Array<{ key: string; label: string }> = [
  { key: "bedrijf", label: "Bedrijf" },
  { key: "sector", label: "Sector" },
  { key: "doel", label: "Doelgroep" },
  { key: "pijn", label: "Pijnpunten" },
  { key: "aanbod", label: "Aanbod" },
  { key: "usps", label: "USPs" },
  { key: "hooksAM", label: "Marketing hooks" },
]

function BriefingSection({
  mondayItemId,
  clientName,
  state,
}: {
  mondayItemId: string
  clientName: string
  state: ClientState | null
}) {
  const queryClient = useQueryClient()
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasBrief =
    !!state?.brief &&
    Object.values(state.brief).some((v) => typeof v === "string" && v.trim().length > 0)

  const runAutoBrief = useCallback(async () => {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch("/api/pedro/auto-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: mondayItemId }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)

      // /api/pedro/auto-brief returns the brief in API field-names
      // (doelgroep / pijnpunten / marketingHooks). The Pedro client-state
      // schema uses the form-key shape (doel / pijn / hooksAM). Translate.
      const b = json.brief as {
        bedrijf?: string
        sector?: string
        doelgroep?: string
        pijnpunten?: string
        aanbod?: string
        usps?: string
        marketingHooks?: string
        source?: string
      }
      const brief = {
        bedrijf: b.bedrijf ?? "",
        sector: b.sector ?? "",
        doel: b.doelgroep ?? "",
        pijn: b.pijnpunten ?? "",
        aanbod: b.aanbod ?? "",
        usps: b.usps ?? "",
        hooksAM: b.marketingHooks ?? "",
      }
      const targetCampaign = state?.campaign_number ?? 1
      const saveRes = await fetch("/api/pedro/client-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: mondayItemId,
          campaignNumber: targetCampaign,
          brief,
          auto_brief_meta: {
            source: b.source ?? "auto-brief",
            autoTriggered: true,
            triggeredAt: new Date().toISOString(),
          },
        }),
      })
      if (!saveRes.ok) {
        const j = await saveRes.json().catch(() => ({}))
        throw new Error(j.error || `Brief opslaan mislukt (HTTP ${saveRes.status})`)
      }
      await queryClient.invalidateQueries({ queryKey: ["pedro-client-state", mondayItemId] })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Brief aanmaken mislukt")
    } finally {
      setGenerating(false)
    }
  }, [mondayItemId, queryClient, state])

  return (
    <Card>
      <CardContent className="py-5 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-heading font-semibold text-sm">Creative Briefing</h4>
          {state?.campaign_number != null && (
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 font-semibold">
              Campagne #{state.campaign_number}
            </span>
          )}
        </div>

        {hasBrief ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {BRIEF_FIELDS.map(({ key, label }) => {
                const value = state?.brief?.[key] ?? ""
                if (!value.trim()) return null
                return (
                  <div key={key} className="space-y-1">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
                      {label}
                    </div>
                    <div className="text-sm text-foreground whitespace-pre-line line-clamp-3">
                      {value}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-2 pt-3 border-t border-border/40">
              <Link
                href={`/pedro/onboard?tab=brief&clientId=${mondayItemId}`}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-md border border-border text-foreground hover:bg-accent transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Bewerk in Pedro
              </Link>
              <button
                type="button"
                onClick={runAutoBrief}
                disabled={generating}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                title="Vul de brief opnieuw met AI op basis van Monday, Trengo en website"
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                Regenereer met AI
              </button>
            </div>
          </>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 space-y-3 text-center">
            <p className="text-sm text-muted-foreground">
              Nog geen brief voor{" "}
              <span className="font-medium text-foreground">{clientName}</span>. Pedro pakt
              context uit Monday, Trengo en de website en vult automatisch in.
            </p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={runAutoBrief}
                disabled={generating}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                Maak brief aan met AI
              </button>
              <Link
                href={`/pedro/onboard?tab=brief&clientId=${mondayItemId}`}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-md border border-border text-foreground hover:bg-accent transition-colors"
              >
                Of vul handmatig in
              </Link>
            </div>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-600 dark:text-red-400 inline-flex items-center gap-1.5">
            <AlertCircle className="h-3 w-3" />
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Kick-off · website scan
// Run analyze-website and persist the resulting brand_style to the
// client-state row so PedroSettingsPanel (below) shows the freshly
// detected colours / fonts. onScanned bumps the panel's key so it
// re-mounts and re-fetches its `detected.*` block.
// ──────────────────────────────────────────────────────────────────────

function KickoffSection({
  mondayItemId,
  initialUrl,
  onScanned,
}: {
  mondayItemId: string
  initialUrl: string
  onScanned: () => void
}) {
  const queryClient = useQueryClient()
  const [url, setUrl] = useState(initialUrl)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<null | {
    colors: string[]
    headingFont: string | null
    bodyFont: string | null
    logoUrl: string | null
  }>(null)
  const [error, setError] = useState<string | null>(null)

  const handleAnalyze = useCallback(async () => {
    if (!url.trim()) {
      setError("Vul eerst een website-URL in")
      return
    }
    setAnalyzing(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch("/api/pedro/analyze-website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)
      const brandStyle = json.brandStyle as Record<string, unknown> | undefined
      if (!brandStyle) throw new Error("Geen brand-data uit website")
      const saveRes = await fetch("/api/pedro/client-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: mondayItemId,
          campaignNumber: 1,
          brand_style: brandStyle,
        }),
      })
      if (!saveRes.ok) {
        const j = await saveRes.json().catch(() => ({}))
        throw new Error(j.error || `Brand opslaan mislukt (HTTP ${saveRes.status})`)
      }
      const colors = [
        brandStyle.primaryColor,
        brandStyle.secondaryColor,
        brandStyle.accentColor,
      ].filter((c): c is string => typeof c === "string" && c.startsWith("#"))
      setResult({
        colors,
        headingFont: (brandStyle.headingFont as string | null) ?? null,
        bodyFont: (brandStyle.bodyFont as string | null) ?? null,
        logoUrl: (brandStyle.logoUrl as string | null) ?? null,
      })
      await queryClient.invalidateQueries({ queryKey: ["pedro-client-state", mondayItemId] })
      onScanned()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Website-scan mislukt")
    } finally {
      setAnalyzing(false)
    }
  }, [mondayItemId, queryClient, url, onScanned])

  return (
    <Card>
      <CardContent className="py-5 space-y-4">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <h4 className="font-heading font-semibold text-sm">
            Kick-off · website + branding
          </h4>
        </div>
        <p className="text-xs text-muted-foreground -mt-1">
          Scrape de website van de klant zodat Pedro kleuren, fonts en logo kent. Het
          resultaat landt automatisch in de Brand identity sectie hieronder.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://klant-website.nl"
            className="flex-1 h-9 px-3 rounded-md border border-border bg-background text-sm"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={analyzing || !url.trim()}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {analyzing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Globe className="h-3.5 w-3.5" />
            )}
            Analyseer
          </button>
        </div>

        {result && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Website gescand — branding bijgewerkt
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {result.colors.map((c) => (
                <div
                  key={c}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-border/60 bg-background text-xs"
                >
                  <span
                    className="h-3 w-3 rounded border border-border/60"
                    style={{ backgroundColor: c }}
                  />
                  <code className="font-mono">{c}</code>
                </div>
              ))}
              {(result.headingFont || result.bodyFont) && (
                <span className="text-xs text-muted-foreground">
                  {result.headingFont ?? "—"}
                  {result.bodyFont && result.bodyFont !== result.headingFont
                    ? ` · ${result.bodyFont}`
                    : ""}
                </span>
              )}
              {result.logoUrl && (
                <a
                  href={result.logoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  Logo <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-600 dark:text-red-400 inline-flex items-center gap-1.5">
            <AlertCircle className="h-3 w-3" />
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
