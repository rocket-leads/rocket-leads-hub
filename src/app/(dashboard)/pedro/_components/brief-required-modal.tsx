"use client"

import { useState, useCallback } from "react"
import { Sparkles, Loader2, X, AlertTriangle, Check } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * BriefRequiredModal — inline brief flow for Pedro Optimize.
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
 * creative-refresh until brief is filled — same completion bar as Pedro
 * Onboard (bedrijf + aanbod non-empty).
 */

type BriefData = {
  bedrijf: string
  sector: string
  doel: string
  pijn: string
  aanbod: string
  usps: string
  hooksAM: string
  hooksExtra: string
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
}

/** Map the /auto-brief response shape onto the storage shape. Auto-brief
 *  uses different keys for historical reasons (doelgroep vs doel,
 *  pijnpunten vs pijn, marketingHooks vs hooksAM). */
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
  }
}

type Props = {
  clientId: string
  clientName: string
  /** Partial brief echoed back by the creative-refresh 409 — lets us
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
    }
  })
  const [autoGenerating, setAutoGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoBriefSourceNote, setAutoBriefSourceNote] = useState<string | null>(null)

  const generateDraft = useCallback(async () => {
    setAutoGenerating(true)
    setError(null)
    try {
      const res = await fetch("/api/pedro/auto-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      // Endpoint returns { brief, meta }. Brief uses auto-brief field
      // names (doelgroep / pijnpunten / marketingHooks), so we remap.
      const briefSource = json.brief ?? json
      const mapped = mapAutoBriefToStorage(briefSource)
      // Merge — only fill empty fields, keep what the CM already typed.
      setBrief((prev) => ({
        bedrijf: prev.bedrijf || mapped.bedrijf,
        sector: prev.sector || mapped.sector,
        doel: prev.doel || mapped.doel,
        pijn: prev.pijn || mapped.pijn,
        aanbod: prev.aanbod || mapped.aanbod,
        usps: prev.usps || mapped.usps,
        hooksAM: prev.hooksAM || mapped.hooksAM,
        hooksExtra: prev.hooksExtra || mapped.hooksExtra,
      }))
      // Source provenance: build a short hint from the meta flags so
      // the CM knows what Pedro looked at.
      const m = json.meta ?? {}
      const bits: string[] = []
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
  }, [clientId])

  const canSave = brief.bedrijf.trim().length > 0 && brief.aanbod.trim().length > 0

  const save = useCallback(async () => {
    if (!canSave || saving) return
    setSaving(true)
    setError(null)
    try {
      // Write to BOTH:
      //   1. pedro_client_state.brief — the "live draft" the gate reads
      //      from + every Pedro feature (creative-refresh, past-brief,
      //      cross-client lookup) uses as source of truth.
      //   2. pedro_stage_versions — the immutable version history so
      //      "Eerdere briefs" lists this save explicitly. Mirrors what
      //      Pedro Onboard does on "Save final version".
      // Step 1 must succeed; step 2 is best-effort so the gate unblocks
      // even if version history fails to write.
      const liveRes = await fetch("/api/pedro/client-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          campaignNumber: 1,
          brief,
        }),
      })
      if (!liveRes.ok) {
        const json = await liveRes.json().catch(() => ({}))
        throw new Error(json.error || `HTTP ${liveRes.status} (live brief)`)
      }

      // Best-effort version snapshot — don't fail the modal on this.
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

      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt")
      setSaving(false)
    }
  }, [canSave, saving, clientId, brief, onSaved])

  function setField<K extends keyof BriefData>(key: K, value: BriefData[K]) {
    setBrief((prev) => ({ ...prev, [key]: value }))
  }

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
        <div className="px-6 py-3 border-b border-border bg-muted/30 flex flex-wrap items-center gap-3">
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
            Vult alleen lege velden — laat wat je al typte intact.
          </span>
          {autoBriefSourceNote && (
            <span className="text-[11px] text-muted-foreground/70 italic w-full">
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
            placeholder="Concreet wat wordt verkocht. Prijsrange/business model — €5k apparaat, subscription, fee, etc."
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
            placeholder="Aanvullende ideeën — wat NIET werkt, wat de klant absoluut niet wil zeggen, branding nuances."
          />
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
