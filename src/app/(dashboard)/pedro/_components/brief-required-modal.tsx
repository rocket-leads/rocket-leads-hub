"use client"

import { useState, useCallback, useEffect } from "react"
import { Sparkles, Loader2, X, AlertTriangle, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  BrandColorsEditor,
  VisualStyleChips,
  type BrandColorRow,
} from "./brand-identity-controls"
import type { VisualStyleKey } from "@/lib/pedro/creative-settings"

/**
 * BriefRequiredModal - inline brief flow for Pedro Optimize.
 *
 * Reuses the existing Pedro Onboard brief shape (pedro_client_state.brief
 * JSONB with 8 fields) so we're not introducing a parallel schema. The
 * AI pre-fill button calls /api/pedro/auto-brief which already aggregates
 * ad bodies + Drive + Trengo + Fathom + Monday updates and returns a
 * structured draft; the CM reviews + edits + saves via the existing
 * /api/pedro/saved-versions endpoint.
 *
 * Why this matters (Roy 2026-06-09): without a baseline brief Pedro
 * hallucinates business models (Zumex B2C smoothie flop). Hard block on
 * creative-refresh until brief is filled - same completion bar as Pedro
 * Onboard (bedrijf + aanbod non-empty).
 */

/**
 * Visual style controls - Roy 2026-06-10.
 *
 * Two layers of choice for the CM, in order of authority:
 *   1. `visualStyleMode` (the broad source picker) - where Pedro should
 *      pull its visual reference from. `website` is the default and
 *      enables the per-element toggles below; the other three modes
 *      ignore the website fingerprint entirely.
 *   2. `websiteToggles` - fine-grained on/off per fingerprint element
 *      (colors / fonts / look-and-feel / logo). Only consulted when
 *      mode = "website". Stored regardless of mode so a mode-switch
 *      doesn't wipe what the CM picked.
 *
 * `fallbackFontHeading` kicks in whenever the fonts toggle is off OR the
 * mode isn't "website" - Pedro then uses a standard, slightly-bold font
 * (Inter / Manrope / Plus Jakarta Sans) instead of the scraped family.
 *
 * `customStylePrompt` is only used when mode = "custom" - verbatim text
 * the CM wants injected into the Gemini prompt.
 */
type VisualStyleMode = "website" | "drive_only" | "winning_ad_only" | "custom"
type FallbackFontKey = "inter" | "manrope" | "plus_jakarta"

type WebsiteToggles = {
  useColors: boolean
  useFonts: boolean
  useLookFeel: boolean
  useLogo: boolean
}

const DEFAULT_WEBSITE_TOGGLES: WebsiteToggles = {
  useColors: true,
  useFonts: true,
  useLookFeel: true,
  useLogo: true,
}

const FALLBACK_FONT_LABEL: Record<FallbackFontKey, string> = {
  inter: "Inter (SemiBold/Bold) - universeel, neutraal-modern",
  manrope: "Manrope (SemiBold) - geometric, iets friendlier",
  plus_jakarta: "Plus Jakarta Sans (SemiBold) - modern, iets meer karakter",
}

type BriefData = {
  bedrijf: string
  sector: string
  doel: string
  pijn: string
  aanbod: string
  usps: string
  hooksAM: string
  hooksExtra: string
  // - Visual style block (Roy 2026-06-10) -
  visualStyleMode: VisualStyleMode
  customStylePrompt: string
  websiteToggles: WebsiteToggles
  fallbackFontHeading: FallbackFontKey
}

const EMPTY_BRIEF: BriefData = {
  bedrijf: "",
  sector: "",
  doel: "",
  pijn: "",
  aanbod: "",
  usps: "",
  hooksAM: "",
  hooksExtra: "",
  visualStyleMode: "website",
  customStylePrompt: "",
  websiteToggles: DEFAULT_WEBSITE_TOGGLES,
  fallbackFontHeading: "inter",
}

/** Map the /auto-brief response shape onto the storage shape. Auto-brief
 *  uses different keys for historical reasons (doelgroep vs doel,
 *  pijnpunten vs pijn, marketingHooks vs hooksAM). The visual-style
 *  block is never sourced from auto-brief - those are CM decisions, not
 *  business facts - so they always come back as defaults that the merge
 *  step below will keep from whatever's already in state. */
function mapAutoBriefToStorage(autoBrief: Record<string, unknown>): BriefData {
  const get = (k: string) =>
    typeof autoBrief[k] === "string" ? (autoBrief[k] as string).trim() : ""
  return {
    bedrijf: get("bedrijf"),
    sector: get("sector"),
    doel: get("doelgroep") || get("doel"),
    pijn: get("pijnpunten") || get("pijn"),
    aanbod: get("aanbod"),
    usps: get("usps"),
    hooksAM: get("marketingHooks") || get("hooksAM"),
    hooksExtra: get("hooksExtra"),
    visualStyleMode: "website",
    customStylePrompt: "",
    websiteToggles: DEFAULT_WEBSITE_TOGGLES,
    fallbackFontHeading: "inter",
  }
}

/** Helpers for reading the visual-style block out of a partial brief
 *  echoed back by the gate. Defaults match EMPTY_BRIEF so a brief saved
 *  before 2026-06-10 (no visual-style fields at all) reads cleanly. */
function readVisualStyleMode(raw: unknown): VisualStyleMode {
  return raw === "drive_only" || raw === "winning_ad_only" || raw === "custom"
    ? raw
    : "website"
}
function readFallbackFont(raw: unknown): FallbackFontKey {
  return raw === "manrope" || raw === "plus_jakarta" ? raw : "inter"
}
function readWebsiteToggles(raw: unknown): WebsiteToggles {
  if (!raw || typeof raw !== "object") return DEFAULT_WEBSITE_TOGGLES
  const r = raw as Record<string, unknown>
  return {
    useColors: r.useColors !== false,
    useFonts: r.useFonts !== false,
    useLookFeel: r.useLookFeel !== false,
    useLogo: r.useLogo !== false,
  }
}

type Props = {
  clientId: string
  clientName: string
  /** Partial brief echoed back by the creative-refresh 409 - lets us
   *  preserve whatever's already filled (e.g., bedrijf typed but aanbod
   *  empty) when the modal opens. Null when there's truly nothing yet. */
  currentBrief?: Record<string, unknown> | null
  onSaved: () => void
  onCancel: () => void
}

export function BriefRequiredModal({
  clientId,
  clientName,
  currentBrief,
  onSaved,
  onCancel,
}: Props) {
  // Prefill non-empty fields from the partial brief that came back with
  // the 409. Same key shape as storage (no auto-brief field-name remap
  // needed here).
  const [brief, setBrief] = useState<BriefData>(() => {
    if (!currentBrief) return EMPTY_BRIEF
    return {
      bedrijf: typeof currentBrief.bedrijf === "string" ? currentBrief.bedrijf : "",
      sector: typeof currentBrief.sector === "string" ? currentBrief.sector : "",
      doel: typeof currentBrief.doel === "string" ? currentBrief.doel : "",
      pijn: typeof currentBrief.pijn === "string" ? currentBrief.pijn : "",
      aanbod: typeof currentBrief.aanbod === "string" ? currentBrief.aanbod : "",
      usps: typeof currentBrief.usps === "string" ? currentBrief.usps : "",
      hooksAM: typeof currentBrief.hooksAM === "string" ? currentBrief.hooksAM : "",
      hooksExtra: typeof currentBrief.hooksExtra === "string" ? currentBrief.hooksExtra : "",
      visualStyleMode: readVisualStyleMode(currentBrief.visualStyleMode),
      customStylePrompt:
        typeof currentBrief.customStylePrompt === "string"
          ? currentBrief.customStylePrompt
          : "",
      websiteToggles: readWebsiteToggles(currentBrief.websiteToggles),
      fallbackFontHeading: readFallbackFont(currentBrief.fallbackFontHeading),
    }
  })
  const [autoGenerating, setAutoGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoBriefSourceNote, setAutoBriefSourceNote] = useState<string | null>(null)

  // Website URL voor AI brief gen + brand fingerprint capture. Roy
  // 2026-06-11: zonder een website heeft Pedro vrijwel niets om op te
  // bouwen wanneer er geen kick-off / evaluation in het systeem zit.
  // Optioneel - leeg laten = geen scrape, geen fingerprint.
  const [websiteUrl, setWebsiteUrl] = useState<string>(() => {
    if (!currentBrief) return ""
    const u = (currentBrief as Record<string, unknown>).websiteUrl
    return typeof u === "string" ? u : ""
  })
  // Brand fingerprint van analyze-website, opgevangen op generate en
  // gepersist naar pedro_client_state.brand_style bij save. UI gebruikt
  // dit alleen voor het "kleuren opgehaald" hintje.
  const [capturedBrandStyle, setCapturedBrandStyle] = useState<Record<string, unknown> | null>(null)

  // Brand identity from pedro_creative_settings — same data the Optimizer
  // settings panel edits. Roy 2026-06-14: the CM wants to tag primary /
  // secondary / accent + pick look-and-feel chips while filling the
  // briefing, instead of having to navigate to a separate panel after.
  // Loaded on mount, saved alongside the brief.
  const [brandColors, setBrandColors] = useState<BrandColorRow[]>([])
  const [visualStyles, setVisualStyles] = useState<VisualStyleKey[]>([])
  const [detectedSource, setDetectedSource] = useState<"pdf" | "website" | "none">("none")
  const [brandColorInjection, setBrandColorInjection] = useState<boolean>(true)
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/pedro/clients/${encodeURIComponent(clientId)}/settings`,
          { cache: "no-store" },
        )
        if (!res.ok) return
        const json = await res.json()
        if (cancelled) return
        const effective = (json?.effective ?? {}) as {
          brandColors?: BrandColorRow[]
          visualStyles?: VisualStyleKey[]
          brandColorInjection?: boolean
        }
        const detected = (json?.detected ?? {}) as { source?: "pdf" | "website" | "none" }
        setBrandColors(Array.isArray(effective.brandColors) ? effective.brandColors : [])
        setVisualStyles(Array.isArray(effective.visualStyles) ? effective.visualStyles : [])
        setDetectedSource(detected.source ?? "none")
        if (typeof effective.brandColorInjection === "boolean") {
          setBrandColorInjection(effective.brandColorInjection)
        }
      } catch {
        /* non-blocking — the modal still saves the brief without brand-identity */
      } finally {
        if (!cancelled) setSettingsLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  const generateDraft = useCallback(async () => {
    setAutoGenerating(true)
    setError(null)
    try {
      const trimmedUrl = websiteUrl.trim()
      // Fire brief gen + brand fingerprint in parallel. Brand fingerprint
      // is fail-soft - missing colors shouldn't block the brief.
      const [briefRes, brandRes] = await Promise.all([
        fetch("/api/pedro/auto-brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, websiteUrl: trimmedUrl }),
        }),
        trimmedUrl
          ? fetch("/api/pedro/analyze-website", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: trimmedUrl }),
            }).catch(() => null)
          : Promise.resolve(null),
      ])

      const json = await briefRes.json()
      if (!briefRes.ok || json.error) {
        throw new Error(json.error || `HTTP ${briefRes.status}`)
      }

      // Brand fingerprint: success = stash for save, failure = silent.
      if (brandRes && brandRes.ok) {
        try {
          const brandJson = await brandRes.json()
          if (brandJson?.brandStyle && typeof brandJson.brandStyle === "object") {
            setCapturedBrandStyle(brandJson.brandStyle as Record<string, unknown>)
          }
        } catch {
          /* fingerprint failure is non-blocking */
        }
      }

      // Endpoint returns { brief, meta }. Brief uses auto-brief field
      // names (doelgroep / pijnpunten / marketingHooks), so we remap.
      const briefSource = json.brief ?? json
      const mapped = mapAutoBriefToStorage(briefSource)
      // Merge - only fill empty fields, keep what the CM already typed.
      // Visual-style block is NEVER touched by auto-brief: those are CM
      // decisions about how Pedro should USE the brief, not facts about
      // the business.
      setBrief((prev) => ({
        bedrijf: prev.bedrijf || mapped.bedrijf,
        sector: prev.sector || mapped.sector,
        doel: prev.doel || mapped.doel,
        pijn: prev.pijn || mapped.pijn,
        aanbod: prev.aanbod || mapped.aanbod,
        usps: prev.usps || mapped.usps,
        hooksAM: prev.hooksAM || mapped.hooksAM,
        hooksExtra: prev.hooksExtra || mapped.hooksExtra,
        visualStyleMode: prev.visualStyleMode,
        customStylePrompt: prev.customStylePrompt,
        websiteToggles: prev.websiteToggles,
        fallbackFontHeading: prev.fallbackFontHeading,
      }))
      // Source provenance: build a short hint from the meta flags so
      // the CM knows what Pedro looked at.
      const m = json.meta ?? {}
      const bits: string[] = []
      if (m.hasWebsite) bits.push("website tekst")
      if (m.hasKickoffMeeting) bits.push("Fathom kick-off")
      if (m.hasKickoffUpdate) bits.push("Monday kick-off update")
      if (m.hasLatestEval) bits.push("recente evaluatie")
      if (m.hasTrengo) bits.push("Trengo gesprekken")
      if (m.monthlyUpdateCount > 0) bits.push(`${m.monthlyUpdateCount} Monday updates`)
      setAutoBriefSourceNote(
        bits.length > 0
          ? `Op basis van: ${bits.join(" · ")}`
          : "Op basis van wat in de Hub beschikbaar is voor deze klant.",
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "Genereren mislukt")
    } finally {
      setAutoGenerating(false)
    }
  }, [clientId, websiteUrl])

  const canSave = brief.bedrijf.trim().length > 0 && brief.aanbod.trim().length > 0

  const save = useCallback(async () => {
    if (!canSave || saving) return
    setSaving(true)
    setError(null)
    try {
      // Write to BOTH:
      //   1. pedro_client_state.brief - the "live draft" the gate reads
      //      from + every Pedro feature (creative-refresh, past-brief,
      //      cross-client lookup) uses as source of truth.
      //   2. pedro_stage_versions - the immutable version history so
      //      "Eerdere briefs" lists this save explicitly. Mirrors what
      //      Pedro Onboard does on "Save final version".
      // Step 1 must succeed; step 2 is best-effort so the gate unblocks
      // even if version history fails to write.
      // Roy 2026-06-11: ook de captured brand fingerprint persist'en zodat
      // Pedro direct kleuren + fonts heeft voor Gemini, zonder dat de CM
      // het manueel naar Onboard hoeft te brengen. Alleen schrijven als
      // we 'm hebben - laat een eerder opgeslagen fingerprint intact.
      const liveBody: Record<string, unknown> = {
        clientId,
        campaignNumber: 1,
        brief,
      }
      if (capturedBrandStyle) liveBody.brand_style = capturedBrandStyle
      const liveRes = await fetch("/api/pedro/client-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(liveBody),
      })
      if (!liveRes.ok) {
        const json = await liveRes.json().catch(() => ({}))
        throw new Error(json.error || `HTTP ${liveRes.status} (live brief)`)
      }

      // Best-effort version snapshot - don't fail the modal on this.
      fetch("/api/pedro/saved-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          stage: "brief",
          data: brief,
          campaignNumber: 1,
        }),
      }).catch((e) => {
        console.warn("[brief-required-modal] saved-versions write failed (non-blocking):", e)
      })

      // Brand identity (brand colours + look & feel chips) goes to
      // pedro_creative_settings via the same endpoint the Optimizer panel
      // uses. Best-effort: the brief save is the gate, this is a UX-only
      // convenience so the CM doesn't have to re-open the settings panel.
      if (settingsLoaded) {
        fetch(`/api/pedro/clients/${encodeURIComponent(clientId)}/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            settings: {
              brandColors,
              visualStyles,
              brandColorInjection,
            },
          }),
        }).catch((e) => {
          console.warn("[brief-required-modal] settings write failed (non-blocking):", e)
        })
      }

      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt")
      setSaving(false)
    }
  }, [
    canSave,
    saving,
    clientId,
    brief,
    capturedBrandStyle,
    onSaved,
    settingsLoaded,
    brandColors,
    visualStyles,
    brandColorInjection,
  ])

  function setField<K extends keyof BriefData>(key: K, value: BriefData[K]) {
    setBrief((prev) => ({ ...prev, [key]: value }))
  }

  function setWebsiteToggle<K extends keyof WebsiteToggles>(
    key: K,
    value: WebsiteToggles[K],
  ) {
    setBrief((prev) => ({
      ...prev,
      websiteToggles: { ...prev.websiteToggles, [key]: value },
    }))
  }

  // Disabling the per-element toggles in non-website modes is purely a
  // UX cue - the prompt builder reads `visualStyleMode` first and only
  // consults the toggles when it's "website". State stays editable
  // (via the data flow) so a mode-flip back to website finds the CM's
  // last choices intact.
  const togglesDisabled = brief.visualStyleMode !== "website"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-6 py-4 border-b border-border bg-card">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-xs uppercase tracking-wide font-semibold text-amber-600 dark:text-amber-400">
                Brief vereist
              </span>
            </div>
            <h2 className="font-heading font-semibold text-lg">
              Creative briefing voor {clientName}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Pedro heeft een baseline brief nodig voordat hij creative refreshes kan
              voorstellen. Vul de basis in (Bedrijf + Aanbod zijn verplicht), of laat
              Pedro een concept maken op basis van ad copies, Drive en Monday updates.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Sluiten"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* AI generate row */}
        <div className="px-6 py-3 border-b border-border bg-muted/30 space-y-2.5">
          {/* Website URL: optioneel, maar in praktijk de sterkste bron
              als er geen kick-off/eval is. Roy 2026-06-11. */}
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="brief-website-url"
              className="text-[11px] font-medium text-muted-foreground shrink-0"
            >
              Website van de klant
            </label>
            <input
              id="brief-website-url"
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              disabled={autoGenerating || saving}
              placeholder="www.bedrijf.nl"
              className="flex-1 min-w-[200px] h-8 px-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
            />
            <span className="text-[10.5px] text-muted-foreground/70">
              Pedro scrape&apos;t homepage + over-ons en haalt brand kleuren / fonts op.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={generateDraft}
              disabled={autoGenerating || saving}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {autoGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {autoGenerating ? "Pedro analyseert context..." : "Genereer concept met Pedro"}
            </button>
            <span className="text-xs text-muted-foreground">
              Vult alleen lege velden - laat wat je al typte intact.
            </span>
            {capturedBrandStyle && (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                <Check className="h-3 w-3" />
                Brand kleuren + fonts opgehaald van website
              </span>
            )}
          </div>
          {autoBriefSourceNote && (
            <span className="text-[11px] text-muted-foreground/70 italic block">
              {autoBriefSourceNote}
            </span>
          )}
        </div>

        {/* Form */}
        <div className="px-6 py-5 grid grid-cols-2 gap-3.5">
          <BriefField
            label="Bedrijfsnaam"
            required
            value={brief.bedrijf}
            onChange={(v) => setField("bedrijf", v)}
            multiline={false}
            placeholder="Bv. Zumex / Juice Concepts"
          />
          <BriefField
            label="Sector"
            value={brief.sector}
            onChange={(v) => setField("sector", v)}
            multiline={false}
            placeholder="Bv. Industriële sapmachines voor horeca"
          />
          <BriefField
            label="Doelgroep / ICP"
            value={brief.doel}
            onChange={(v) => setField("doel", v)}
            multiline
            rows={3}
            placeholder="B2B/B2C, type bedrijf, omzetklasse, regio."
          />
          <BriefField
            label="Pijnpunten"
            value={brief.pijn}
            onChange={(v) => setField("pijn", v)}
            multiline
            rows={3}
            placeholder="Wat houdt de doelgroep wakker?"
          />
          <BriefField
            label="Aanbod / dienst"
            required
            value={brief.aanbod}
            onChange={(v) => setField("aanbod", v)}
            multiline
            rows={3}
            colSpan2
            placeholder="Concreet wat wordt verkocht. Prijsrange/business model - €5k apparaat, subscription, fee, etc."
          />
          <BriefField
            label="USPs"
            value={brief.usps}
            onChange={(v) => setField("usps", v)}
            multiline
            rows={3}
            placeholder="Wat maakt deze klant uniek?"
          />
          <BriefField
            label="Marketing hooks (account manager)"
            value={brief.hooksAM}
            onChange={(v) => setField("hooksAM", v)}
            multiline
            rows={3}
            placeholder="Bewezen invalshoeken die je weet dat werken."
          />
          <BriefField
            label="Extra hooks (campaign manager)"
            value={brief.hooksExtra}
            onChange={(v) => setField("hooksExtra", v)}
            multiline
            rows={3}
            colSpan2
            placeholder="Aanvullende ideeën - wat NIET werkt, wat de klant absoluut niet wil zeggen, branding nuances."
          />
        </div>

        {/* Visual-style controls - Roy 2026-06-10. Sits below the business
            brief because these are decisions ABOUT how Pedro uses the
            brief, not facts about the client. Collapsed look (no header
            divider above) so it reads as one continuous form. */}
        <div className="px-6 pb-5">
          <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3.5 space-y-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80 mb-0.5">
                Visual style
              </h3>
              <p className="text-[11px] text-muted-foreground/70">
                Bepaal welke referentie Pedro pakt voor het visuele DNA van de creatives. Met de toggles eronder kun je per element kiezen of Pedro het meeneemt - handig als de website-stijl op één punt zwak is maar de rest klopt.
              </p>
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-[11px] font-medium text-muted-foreground mb-1">
                Bron voor visuele stijl
              </legend>
              <ModeRadio
                checked={brief.visualStyleMode === "website"}
                onChange={() => setField("visualStyleMode", "website")}
                title="Match website"
                hint="Pedro leunt op de scraped fingerprint van hun website (kleuren, fonts, look & feel, logo)."
              />
              <ModeRadio
                checked={brief.visualStyleMode === "drive_only"}
                onChange={() => setField("visualStyleMode", "drive_only")}
                title="Match Drive folder only"
                hint="Negeer de website. Pedro werkt alleen met de foto's in de Google Drive folder van de klant."
              />
              <ModeRadio
                checked={brief.visualStyleMode === "winning_ad_only"}
                onChange={() => setField("visualStyleMode", "winning_ad_only")}
                title="Match winning ad only"
                hint="Negeer site + Drive. Pedro itereert puur op de stijl van de huidige winning ad."
              />
              <ModeRadio
                checked={brief.visualStyleMode === "custom"}
                onChange={() => setField("visualStyleMode", "custom")}
                title="Custom prompt"
                hint="Schrijf zelf wat Pedro visueel moet aanhouden. Vervangt alle automatische referenties."
              />
              {brief.visualStyleMode === "custom" && (
                <textarea
                  value={brief.customStylePrompt}
                  onChange={(e) => setField("customStylePrompt", e.target.value)}
                  rows={3}
                  placeholder="Bv. 'cinematic kitchen interior, warm lighting, premium copper accents, no people, magazine-style composition'"
                  className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 resize-y"
                />
              )}
            </fieldset>

            <div
              className={cn(
                "rounded-md border border-border/40 bg-background/60 px-3 py-2.5 space-y-2",
                togglesDisabled && "opacity-60",
              )}
            >
              <div className="text-[11px] font-medium text-muted-foreground">
                Van de website - wat Pedro mag meenemen
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <ToggleRow
                  label="Brand colors"
                  checked={brief.websiteToggles.useColors}
                  onChange={(v) => setWebsiteToggle("useColors", v)}
                  disabled={togglesDisabled}
                />
                <ToggleRow
                  label="Look & feel (layout vibe)"
                  checked={brief.websiteToggles.useLookFeel}
                  onChange={(v) => setWebsiteToggle("useLookFeel", v)}
                  disabled={togglesDisabled}
                />
                <ToggleRow
                  label="Fonts"
                  checked={brief.websiteToggles.useFonts}
                  onChange={(v) => setWebsiteToggle("useFonts", v)}
                  disabled={togglesDisabled}
                />
                <ToggleRow
                  label="Logo"
                  checked={brief.websiteToggles.useLogo}
                  onChange={(v) => setWebsiteToggle("useLogo", v)}
                  disabled={togglesDisabled}
                />
              </div>
              {togglesDisabled && (
                <p className="text-[10.5px] text-muted-foreground/60 italic">
                  Toggles staan uit omdat de mode hierboven niet &ldquo;Match website&rdquo; is.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground inline-flex items-center gap-1.5">
                Fallback font
                <span className="text-muted-foreground/50">
                  · gebruikt wanneer Fonts uit staat of de site geen bruikbare font heeft
                </span>
              </label>
              <select
                value={brief.fallbackFontHeading}
                onChange={(e) =>
                  setField(
                    "fallbackFontHeading",
                    e.target.value as FallbackFontKey,
                  )
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {(Object.keys(FALLBACK_FONT_LABEL) as FallbackFontKey[]).map(
                  (k) => (
                    <option key={k} value={k}>
                      {FALLBACK_FONT_LABEL[k]}
                    </option>
                  ),
                )}
              </select>
            </div>

            {/* Look & feel chips — Roy 2026-06-14. Same picker as in the
                Optimizer settings panel; binds to the same
                pedro_creative_settings.visualStyles array so what you
                pick here drives what Pedro composes. */}
            <div className="rounded-md border border-border/40 bg-background/60 px-3 py-2.5 space-y-2">
              <div className="text-[11px] font-medium text-muted-foreground">
                Look &amp; feel
                <span className="text-muted-foreground/50">
                  {" "}· stijl-attributen die Pedro combineert in het beeld
                </span>
              </div>
              {settingsLoaded ? (
                <VisualStyleChips value={visualStyles} onChange={setVisualStyles} />
              ) : (
                <div className="text-[11px] text-muted-foreground/60 italic">
                  Look &amp; feel laden…
                </div>
              )}
            </div>

            {/* Brand colour role editor — Roy 2026-06-14. Same editor as
                in the Optimizer settings panel; binds to the same
                pedro_creative_settings.brandColors blob so the primary /
                secondary / accent tags survive across both surfaces. */}
            <div className="rounded-md border border-border/40 bg-background/60 px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-medium text-muted-foreground">
                  Brand colours · primary / secondary / accent
                </div>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={brandColorInjection}
                    onChange={(e) => setBrandColorInjection(e.target.checked)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  Injecteer in image prompts
                </label>
              </div>
              {settingsLoaded ? (
                <BrandColorsEditor
                  colors={brandColors}
                  detectedSource={detectedSource}
                  disabled={!brandColorInjection}
                  onChange={setBrandColors}
                />
              ) : (
                <div className="text-[11px] text-muted-foreground/60 italic">
                  Brand colours laden…
                </div>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-6 mb-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 px-6 py-3 border-t border-border bg-card">
          <div className="text-xs text-muted-foreground">
            {!canSave ? (
              <span>
                Bedrijf en Aanbod zijn verplicht voor je kan opslaan.
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Check className="h-3 w-3" /> Klaar om op te slaan
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="inline-flex items-center h-9 px-3.5 rounded-md text-sm font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              Annuleer
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!canSave || saving}
              className={cn(
                "inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-sm font-medium transition-opacity",
                "bg-primary text-primary-foreground hover:opacity-90",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {saving ? "Opslaan..." : "Opslaan + door naar refresh"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ModeRadio({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean
  onChange: () => void
  title: string
  hint: string
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-2.5 rounded-md px-2.5 py-2 cursor-pointer transition-colors",
        checked ? "bg-background border border-primary/40" : "hover:bg-background/50 border border-transparent",
      )}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 accent-primary"
      />
      <span className="flex-1 min-w-0">
        <span className="text-[12.5px] font-medium block leading-tight">{title}</span>
        <span className="text-[10.5px] text-muted-foreground/70 leading-tight block mt-0.5">
          {hint}
        </span>
      </span>
    </label>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 text-[12.5px] cursor-pointer select-none",
        disabled && "cursor-not-allowed",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-primary"
      />
      <span>{label}</span>
    </label>
  )
}

function BriefField({
  label,
  value,
  onChange,
  multiline,
  rows = 3,
  required,
  placeholder,
  colSpan2,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  rows?: number
  required?: boolean
  placeholder?: string
  colSpan2?: boolean
}) {
  const baseClasses =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
  return (
    <div className={cn("flex flex-col gap-1.5", colSpan2 && "col-span-2")}>
      <label className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className={cn(baseClasses, "resize-y")}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={baseClasses}
        />
      )}
    </div>
  )
}
