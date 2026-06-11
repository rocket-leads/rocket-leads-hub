"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Copy,
  Check,
  Loader2,
  ArrowRight,
  Save,
  AlertCircle,
  Folder,
  Megaphone,
  Send,
  Sparkles,
  CircleDollarSign,
  Palette,
  Plus,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConnectedEntity } from "@/components/connected-entity"
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

type AutoSetupResult = {
  drive: {
    rootFolderId: string
    rootFolderUrl: string
    subfolders: Record<string, { id: string; url: string }>
    reused: boolean
  }
  metaBmConnectUrl: string
}

type PaymentStatus = {
  hasPaid: boolean
  lastPaidAt: number | null
  lastPaidAmount: number | null
}

type BriefDraft = {
  bedrijf: string
  sector: string
  websiteUrl: string
  doelgroep: string
  pijnpunten: string
  aanbod: string
  usps: string
  marketingHooks: string
}

const EMPTY_BRIEF: BriefDraft = {
  bedrijf: "",
  sector: "",
  websiteUrl: "",
  doelgroep: "",
  pijnpunten: "",
  aanbod: "",
  usps: "",
  marketingHooks: "",
}

/** Brand fingerprint captured from the client's website during kick-off.
 *  Shape mirrors `/api/pedro/analyze-website` output (minus `qualityVerdict`
 *  which Pedro recomputes anyway) so the handoff endpoint can return this
 *  straight into Pedro's `brand_style` slot with no remapping. AM may
 *  override the picked colors via hex inputs or swatch clicks. */
type BrandFingerprint = {
  primaryColor: string
  secondaryColor: string
  accentColor?: string
  headingFont?: string
  bodyFont?: string
  logoUrl?: string
  heroImageUrl?: string
  taglineHeadline?: string
  taglineSubline?: string
}

type ExtractedColor = {
  hex: string
  score: number
  source: string
  luminance: number
}

type AanbodLine = { included: boolean; pricePerMonth: string }
type Aanbod = NonNullable<KickoffContent["aanbod"]>
type FormField = { id: string; label: string; isDefault?: boolean }
type Automations = NonNullable<KickoffContent["automations"]>

// Defaults match Rocket Leads' standaard HTO pakket per company.md
// (€3.750 p/m totaal): Meta 1000 · Google 500 · Content 1000 ·
// Leadopvolging 750. Alleen Meta default ON omdat dat de basis is;
// AM tickt de rest aan voor het gekozen pakket. Prijzen blijven
// invulbaar — niet elke klant betaalt het standaard tarief.
const DEFAULT_AANBOD: Aanbod = {
  metaAds: { included: true, pricePerMonth: "1000" },
  googleAds: { included: false, pricePerMonth: "500" },
  contentShoot: { included: false, pricePerMonth: "1000" },
  leadOpvolging: { included: false, pricePerMonth: "750" },
  adBudget: { included: false, pricePerMonth: "" },
}

const DEFAULT_FORM_FIELDS: FormField[] = [
  { id: "naam", label: "Naam", isDefault: true },
  { id: "telefoon", label: "Telefoonnummer", isDefault: true },
  { id: "email", label: "E-mailadres", isDefault: true },
]

const DEFAULT_AUTOMATIONS: Automations = {
  monday: true,
  gmail: true,
  whatsappToClient: true,
  whatsappToLead: true,
}

const AANBOD_LINES: Array<{ key: keyof Aanbod; labelKey: string }> = [
  { key: "metaAds", labelKey: "onboarding.wizard.kickoff.aanbod.meta_ads" },
  { key: "googleAds", labelKey: "onboarding.wizard.kickoff.aanbod.google_ads" },
  { key: "contentShoot", labelKey: "onboarding.wizard.kickoff.aanbod.content_shoot" },
  { key: "leadOpvolging", labelKey: "onboarding.wizard.kickoff.aanbod.lead_opvolging" },
  { key: "adBudget", labelKey: "onboarding.wizard.kickoff.aanbod.ad_budget" },
]

const AUTOMATION_LINES: Array<{ key: keyof Automations; labelKey: string }> = [
  { key: "monday", labelKey: "onboarding.wizard.kickoff.automations.monday" },
  { key: "gmail", labelKey: "onboarding.wizard.kickoff.automations.gmail" },
  { key: "whatsappToClient", labelKey: "onboarding.wizard.kickoff.automations.wa_client" },
  { key: "whatsappToLead", labelKey: "onboarding.wizard.kickoff.automations.wa_lead" },
]

type KickoffContent = {
  autoSetup?: AutoSetupResult
  briefDraft?: BriefDraft
  brandStyle?: BrandFingerprint
  /** Top-N scored swatches from the website analyzer - kept around so
   *  the AM can re-pick after the call without re-running the scrape. */
  brandSwatches?: ExtractedColor[]
  /** Manual confirmation that the klant has added RL as partner in their
   *  Meta Business Manager. AM ticks this when the klant says they did
   *  the connect via the fixed info.rocketleads.com/explanation-meta
   *  guide link. Replaces the previous metaAdAccountId-proxy detection
   *  in Stap 4 (Roy 2026-06-11). */
  metaConnected?: { confirmedAt: string; confirmedBy: string }
  /** Manual confirmation that the klant uploaded brand content into the
   *  shared Drive folder. AM-driven signal (no more Drive file-count
   *  polling for the wait-on-client signal). */
  clientContentUploaded?: { confirmedAt: string; confirmedBy: string }
  /** When true, we drive the campaign on Rocket Leads' own ad account
   *  ("Clients Rocket Leads") instead of asking the klant to add us as
   *  partner. Flipping this on auto-fills `meta_ad_account_id` on
   *  Monday with the RL_OWN_AD_ACCOUNT_ID env var and signals that ad
   *  budget gets invoiced to the client by RL (instead of klant paying
   *  Meta directly). See process.md §"Onboarding Roadblocks" #3. */
  useRlAdAccount?: boolean
  /** What RL delivers, with monthly price per line item. AM tickt
   *  per service of we het leveren + vult de prijs per maand in.
   *  "adBudget" zit hier ook in zodat het altijd ingevuld kan worden
   *  — los van of de klant op z'n eigen ad account of het RL ad
   *  account draait. */
  aanbod?: {
    metaAds?: { included: boolean; pricePerMonth: string }
    googleAds?: { included: boolean; pricePerMonth: string }
    contentShoot?: { included: boolean; pricePerMonth: string }
    leadOpvolging?: { included: boolean; pricePerMonth: string }
    adBudget?: { included: boolean; pricePerMonth: string }
  }
  /** Eenmalige opstartkosten (default €0). Wordt opgeteld bij de
   *  eerste-factuur totaal maar niet bij de maandelijkse cyclus. */
  setupFee?: string
  /** Facturatie-ritme: 1 = per maand, 2 = per 2 maanden, 3 = per
   *  kwartaal. Per-service prijzen blijven altijd per-maand; deze
   *  picker bepaalt alleen wat de totalen-sectie toont en hoeveel
   *  de eerste factuur is. Sommige klanten betalen kwartaal vooruit
   *  voor de eerste-maand-gratis HTO-deal — dat wordt los toegepast
   *  als korting op de prijzen per service, niet via deze cycle. */
  billingCycle?: 1 | 2 | 3
  /** Lead-form fields the klant's landing page will ask. Hub seeds
   *  the three defaults (naam/telefoon/email); AM adds custom ones
   *  via the "+" button — typically bedrijfsnaam, branche, budget. */
  formFields?: Array<{
    id: string
    label: string
    /** Default fields can't be removed — only their label is
     *  technically editable. Custom fields are AM-added and
     *  fully editable + removable. */
    isDefault?: boolean
  }>
  /** Zapier-driven flows that fire on a new lead landing in Monday.
   *  All four default ON because that's the standard onboarding
   *  pakket; AM untickt wat niet van toepassing is. */
  automations?: {
    monday?: boolean
    gmail?: boolean
    whatsappToClient?: boolean
    whatsappToLead?: boolean
  }
  recapSentAt?: string
}

/**
 * Stap 1 - Live kick-off tool. AM opens this *during* the kick-off call.
 *
 * On first mount, auto-setup creates the Drive folder tree + generates
 * the Meta BM connect URL placeholder. Two resources surface to share
 * with the client (Drive folder + Meta BM connect link) - Stripe payment
 * is intentionally NOT a resource here because payment is a precondition
 * for the kick-off per process.md; we just show paid-yes/no based on the
 * linked Stripe customer ID.
 *
 * Hub connections use the standard `ConnectedEntity` picker (same UX as
 * client Settings tab) so the AM can typeahead-pick Trengo/Stripe/Monday
 * board straight from the wizard. Each pick writes through to Monday +
 * mirrors to Supabase via the existing edit code path.
 */
export function KickoffLiveStep({
  step,
  mondayItemId,
  client,
  locale,
  nextKey,
  onStepSaved,
}: Props) {
  const queryClient = useQueryClient()
  const content = (step.content as KickoffContent | null) ?? {}
  const autoSetup = content.autoSetup

  // ── Auto-setup trigger ──
  const setupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/clients/${mondayItemId}/onboarding/setup`, {
        method: "POST",
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Setup failed")
      }
      return res.json() as Promise<AutoSetupResult>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["onboarding-wizard", mondayItemId],
      })
    },
  })
  useEffect(() => {
    if (!autoSetup && !setupMutation.isPending && !setupMutation.isError) {
      setupMutation.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSetup])

  // ── Payment status polling ──
  // 30s refetch while the AM has this step open. We don't poll while
  // backgrounded; React Query's default `refetchOnWindowFocus` covers
  // the case where the AM tabs over to Stripe to mark something paid.
  const paymentQuery = useQuery<PaymentStatus>({
    queryKey: ["onboarding-payment-status", mondayItemId, client.stripeCustomerId],
    queryFn: () =>
      fetch(`/api/clients/${mondayItemId}/onboarding/payment-status`).then((r) => r.json()),
    refetchInterval: 30 * 1000,
    staleTime: 25 * 1000,
  })

  // ── Brief draft (local controlled state + debounced save) ──
  const [briefDraft, setBriefDraft] = useState<BriefDraft>(() => ({
    ...EMPTY_BRIEF,
    ...(content.briefDraft ?? {}),
  }))
  const [briefDirty, setBriefDirty] = useState(false)

  // ── Aanbod (RL services + monthly prices) ──
  const [aanbod, setAanbod] = useState<Aanbod>(() => ({
    ...DEFAULT_AANBOD,
    ...(content.aanbod ?? {}),
  }))
  const updateAanbodLine = (
    key: keyof Aanbod,
    patch: Partial<AanbodLine>,
  ) => {
    setAanbod((prev) => ({
      ...prev,
      [key]: {
        included: prev[key]?.included ?? false,
        pricePerMonth: prev[key]?.pricePerMonth ?? "",
        ...patch,
      },
    }))
    setBriefDirty(true)
  }
  const [setupFee, setSetupFee] = useState<string>(() => content.setupFee ?? "0")
  const [billingCycle, setBillingCycle] = useState<1 | 2 | 3>(
    () => content.billingCycle ?? 1,
  )

  // Derived totals.
  const monthlyTotal = (Object.values(aanbod) as AanbodLine[]).reduce(
    (sum, line) => (line?.included ? sum + (parseFloat(line.pricePerMonth) || 0) : sum),
    0,
  )
  const cycleTotal = monthlyTotal * billingCycle
  const setupFeeNum = parseFloat(setupFee) || 0
  const firstInvoiceTotal = cycleTotal + setupFeeNum

  // ── Formulier leads (lead-form fields the LP will collect) ──
  const [formFields, setFormFields] = useState<FormField[]>(
    () => content.formFields ?? DEFAULT_FORM_FIELDS,
  )
  const addFormField = () => {
    setFormFields((prev) => [
      ...prev,
      { id: `field_${Date.now()}`, label: "" },
    ])
    setBriefDirty(true)
  }
  const updateFormFieldLabel = (id: string, label: string) => {
    setFormFields((prev) => prev.map((f) => (f.id === id ? { ...f, label } : f)))
    setBriefDirty(true)
  }
  const removeFormField = (id: string) => {
    setFormFields((prev) => prev.filter((f) => f.id !== id || f.isDefault))
    setBriefDirty(true)
  }

  // ── Automations (Zapier flows) ──
  const [automations, setAutomations] = useState<Automations>(() => ({
    ...DEFAULT_AUTOMATIONS,
    ...(content.automations ?? {}),
  }))
  const toggleAutomation = (key: keyof Automations) => {
    setAutomations((prev) => ({ ...prev, [key]: !prev[key] }))
    setBriefDirty(true)
  }

  // ── Manual resource toggles ──
  // Two AM-confirmed signals replace auto-detection on Drive + Meta.
  // Wait-status reads both from this step's content. Single mutation
  // shape — pass which field flips and the desired value.
  const driveContentUploaded = Boolean(content.clientContentUploaded?.confirmedAt)
  const metaConnected = Boolean(content.metaConnected?.confirmedAt)
  const useRlAdAccount = Boolean(content.useRlAdAccount)

  const toggleResource = useMutation({
    mutationFn: async (vars: {
      key: "clientContentUploaded" | "metaConnected" | "useRlAdAccount"
      next: boolean
    }) => {
      // Build the new content blob — handles each toggle's own shape.
      const patch: Partial<KickoffContent> = {}
      if (vars.key === "useRlAdAccount") {
        patch.useRlAdAccount = vars.next
      } else {
        patch[vars.key] = vars.next
          ? { confirmedAt: new Date().toISOString(), confirmedBy: "" }
          : undefined
      }
      const res = await fetch(`/api/clients/${mondayItemId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepKey: step.key,
          done: false,
          content: { ...content, ...patch },
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Toggle failed")
      }

      // Side-effect: when "we draaien op RL ad account" toggles ON,
      // auto-fill metaAdAccountId on Monday with the RL ad account ID
      // from env. Best-effort — UI shows an error toast on failure
      // but the wizard state stays consistent (toggle reverts if the
      // PATCH below throws). Untoggling does NOT clear the field
      // because the AM may have already pasted a different ID.
      if (vars.key === "useRlAdAccount" && vars.next) {
        await fetch(`/api/clients/${mondayItemId}/onboarding/rl-ad-account`, {
          method: "POST",
        }).catch(() => undefined)
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["onboarding-wizard", mondayItemId],
      })
      queryClient.invalidateQueries({
        queryKey: ["onboarding-wait-status", mondayItemId],
      })
    },
  })

  // ── Brand fingerprint (captured live; primary/secondary/accent
  // hexes are AM-editable so the website scrape doesn't lock anyone
  // in if it mis-picks). ──
  const [brandStyle, setBrandStyle] = useState<BrandFingerprint | null>(
    () => content.brandStyle ?? null,
  )
  const [brandSwatches, setBrandSwatches] = useState<ExtractedColor[]>(
    () => content.brandSwatches ?? [],
  )
  const [brandDirty, setBrandDirty] = useState(false)

  const updateBrandColor = (
    field: "primaryColor" | "secondaryColor" | "accentColor",
    hex: string,
  ) => {
    setBrandStyle((b) => {
      if (!b) {
        return field === "primaryColor"
          ? { primaryColor: hex, secondaryColor: "" }
          : { primaryColor: "", secondaryColor: "", [field]: hex }
      }
      return { ...b, [field]: hex }
    })
    setBrandDirty(true)
  }

  const analyzeBrand = useMutation({
    mutationFn: async () => {
      const url = briefDraft.websiteUrl.trim()
      if (!url) throw new Error(t("onboarding.wizard.kickoff.brand.no_url", locale))
      const res = await fetch(`/api/pedro/analyze-website`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Brand analysis failed")
      }
      return res.json() as Promise<{
        brandStyle: BrandFingerprint
        extractedColors?: ExtractedColor[]
      }>
    },
    onSuccess: (data) => {
      setBrandStyle(data.brandStyle)
      setBrandSwatches(data.extractedColors ?? [])
      setBrandDirty(true)
      // Best-effort: kick off the logo + hero download to Drive in
      // the background. Failures don't undo the brand-style update —
      // the assets just won't be in Drive. The AM can re-run by
      // hitting Analyze again, or manually drop the files in.
      void fetch(`/api/clients/${mondayItemId}/onboarding/save-brand-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logoUrl: data.brandStyle.logoUrl,
          heroImageUrl: data.brandStyle.heroImageUrl,
        }),
      }).catch(() => undefined)
    },
  })

  // ── Pre-fill brief from Monday updates + Trengo + meetings ──
  // Reuses the existing Pedro auto-brief generator. Useful before the
  // kick-off transcript lands — it pulls whatever Monday updates the
  // sales team already wrote, plus any Trengo conversation history,
  // and fills the brief fields from there. AM-typed values are
  // preserved; AI output only fills the blanks.
  const prefillBrief = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pedro/auto-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: mondayItemId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Pre-fill failed")
      }
      return res.json() as Promise<{ brief: Partial<BriefDraft> }>
    },
    onSuccess: ({ brief }) => {
      // Merge in only the fields the AM hasn't filled yet — never
      // overwrite work. trim() comparison so a stray space doesn't
      // count as "already filled".
      setBriefDraft((prev) => {
        const next = { ...prev }
        ;(Object.keys(EMPTY_BRIEF) as Array<keyof BriefDraft>).forEach((key) => {
          if ((next[key] ?? "").trim() === "" && brief[key]) {
            next[key] = brief[key] as string
          }
        })
        return next
      })
      setBriefDirty(true)
    },
  })

  // Debounced persist for both brief edits AND brand-style edits - same
  // step content blob, so we batch them through one timer. Reads the
  // freshest local state each fire because `content` may be stale.
  useEffect(() => {
    if (!briefDirty && !brandDirty) return
    const handle = setTimeout(() => {
      void fetch(`/api/clients/${mondayItemId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepKey: step.key,
          done: false,
          content: {
            ...content,
            briefDraft,
            aanbod,
            setupFee,
            billingCycle,
            formFields,
            automations,
            ...(brandStyle ? { brandStyle } : {}),
            ...(brandSwatches.length > 0 ? { brandSwatches } : {}),
          },
        }),
      })
      setBriefDirty(false)
      setBrandDirty(false)
    }, 3000)
    return () => clearTimeout(handle)
  }, [
    briefDirty,
    brandDirty,
    briefDraft,
    aanbod,
    setupFee,
    billingCycle,
    formFields,
    automations,
    brandStyle,
    brandSwatches,
    content,
    mondayItemId,
    step.key,
  ])

  const updateBrief = <K extends keyof BriefDraft>(field: K, value: string) => {
    setBriefDraft((b) => ({ ...b, [field]: value }))
    setBriefDirty(true)
  }

  // ── Recap dialog ──
  // Opens a preview with the AI-generated recap message (or fallback
  // skeleton when the transcript hasn't landed). AM edits + copies +
  // sends via their preferred channel, then marks as sent so the
  // timestamp persists.
  const [recapOpen, setRecapOpen] = useState(false)
  const handleMarkRecapSent = async () => {
    await fetch(`/api/clients/${mondayItemId}/onboarding`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stepKey: step.key,
        done: false,
        content: { ...content, recapSentAt: new Date().toISOString() },
      }),
    })
    queryClient.invalidateQueries({
      queryKey: ["onboarding-wizard", mondayItemId],
    })
    setRecapOpen(false)
  }

  // ── Mark step done ──
  const markDone = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/clients/${mondayItemId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepKey: step.key,
          done: true,
          content: { ...content, briefDraft },
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Mark done failed")
      }
      return res.json()
    },
    onSuccess: () => onStepSaved(nextKey),
  })

  const companyName = client.companyName || client.name || ""

  return (
    <div className="space-y-5">
      {/* Auto-setup banner */}
      {!autoSetup && (
        <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 flex items-center gap-3">
          {setupMutation.isError ? (
            <>
              <AlertCircle className="h-4 w-4 text-destructive" />
              <span className="text-xs text-destructive">
                {setupMutation.error instanceof Error
                  ? setupMutation.error.message
                  : "Setup failed"}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setupMutation.mutate()}>
                {t("onboarding.wizard.kickoff.setup.retry", locale)}
              </Button>
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">
                {t("onboarding.wizard.kickoff.setup.running", locale)}
              </span>
            </>
          )}
        </div>
      )}

      {/* Hub connections - typeahead pickers writing straight to Monday */}
      <section className="rounded-xl border border-border/60 bg-card/50 p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          {t("onboarding.wizard.kickoff.hub_connections.title", locale)}
        </h3>
        <div className="space-y-2">
          <ConnectedEntity
            mondayItemId={mondayItemId}
            fieldKey="trengo_contact_id"
            value={client.trengoContactId}
            label={t("onboarding.wizard.kickoff.picker.trengo", locale)}
            service="trengo-contact"
            companyName={companyName}
          />
          <ConnectedEntity
            mondayItemId={mondayItemId}
            fieldKey="stripe_customer_id"
            value={client.stripeCustomerId}
            label={t("onboarding.wizard.kickoff.picker.stripe", locale)}
            service="stripe-customer"
            companyName={companyName}
          />
          <ConnectedEntity
            mondayItemId={mondayItemId}
            fieldKey="client_board_id"
            value={client.clientBoardId}
            label={t("onboarding.wizard.kickoff.picker.monday_board", locale)}
            service="monday-board"
            companyName={companyName}
          />
          <ConnectedEntity
            mondayItemId={mondayItemId}
            fieldKey="google_drive_id"
            value={client.googleDriveId}
            label={t("onboarding.wizard.kickoff.picker.drive", locale)}
            service="drive-folder"
            companyName={companyName}
          />
        </div>
      </section>

      {/* Klant-acties — checkbox per item. AM tickt zodra de klant
          de actie bevestigd heeft (Roy 2026-06-11). Stap 4 wait-on-
          client leest deze signalen i.p.v. auto-detectie. */}
      <section className="rounded-xl border border-border/60 bg-card/50 p-4">
        <h3 className="text-sm font-semibold mb-3">
          {t("onboarding.wizard.kickoff.resources.title", locale)}
        </h3>
        <div className="space-y-2">
          <CheckboxResourceRow
            label={t("onboarding.wizard.kickoff.resource.drive.checkbox", locale)}
            url={autoSetup?.drive.rootFolderUrl ?? null}
            urlLabel={t("onboarding.wizard.kickoff.resource.drive.open", locale)}
            checked={driveContentUploaded}
            onToggle={(v) =>
              toggleResource.mutate({ key: "clientContentUploaded", next: v })
            }
            pending={
              toggleResource.isPending &&
              toggleResource.variables?.key === "clientContentUploaded"
            }
            disabled={!autoSetup}
          />
          <CheckboxResourceRow
            label={t("onboarding.wizard.kickoff.resource.meta_bm.checkbox", locale)}
            url={autoSetup?.metaBmConnectUrl ?? null}
            urlLabel={t("onboarding.wizard.kickoff.resource.meta_bm.open", locale)}
            checked={metaConnected}
            onToggle={(v) =>
              toggleResource.mutate({ key: "metaConnected", next: v })
            }
            pending={
              toggleResource.isPending &&
              toggleResource.variables?.key === "metaConnected"
            }
            disabled={!autoSetup || useRlAdAccount}
          />
          {/* RL ad-account toggle — when ticked the Meta-connect row
              above becomes irrelevant (we don't need the klant's BM),
              and Hub auto-fills meta_ad_account_id with the RL account
              + flips Monday status to "Rocket Leads". */}
          <label className="flex items-start gap-3 text-xs pl-3 pt-2 mt-1 border-t border-border/30 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useRlAdAccount}
              disabled={toggleResource.isPending}
              onChange={(e) =>
                toggleResource.mutate({ key: "useRlAdAccount", next: e.target.checked })
              }
              className="h-4 w-4 rounded border-input accent-primary mt-0.5"
            />
            <div className="flex-1">
              <div className={cn("font-medium", useRlAdAccount ? "text-foreground" : "text-muted-foreground")}>
                {t("onboarding.wizard.kickoff.rl_ad_account.label", locale)}
              </div>
              <div className="text-[11px] text-muted-foreground/80 mt-0.5">
                {t("onboarding.wizard.kickoff.rl_ad_account.hint", locale)}
              </div>
            </div>
          </label>

          {/* Ad-budget input verhuisd naar de Aanbod-sectie boven de
              brief — moet ook ingevuld worden als klant op eigen
              ad-account draait (Roy 2026-06-11). */}
        </div>
      </section>

      {/* Live status - payment indicator (polled) */}
      <section className="rounded-xl border border-border/60 bg-card/50 p-4">
        <h3 className="text-sm font-semibold mb-3">
          {t("onboarding.wizard.kickoff.status.title", locale)}
        </h3>
        <PaymentStatusRow
          status={paymentQuery.data}
          loading={paymentQuery.isLoading}
          hasCustomerId={Boolean(client.stripeCustomerId)}
          locale={locale}
        />
      </section>

      {/* Aanbod — wat we leveren + prijs per maand + cycle picker. */}
      <section className="rounded-xl border border-border/60 bg-card/50 p-4">
        <h3 className="text-sm font-semibold mb-1">
          {t("onboarding.wizard.kickoff.aanbod.title", locale)}
        </h3>
        <p className="text-[11px] text-muted-foreground mb-3">
          {t("onboarding.wizard.kickoff.aanbod.hint", locale)}
        </p>

        {/* Cycle picker + setup fee — top row */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-3 pb-3 border-b border-border/30">
          <div className="flex-1">
            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              {t("onboarding.wizard.kickoff.aanbod.cycle.label", locale)}
            </label>
            <div className="inline-flex rounded-md border border-border bg-background overflow-hidden">
              {([1, 2, 3] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setBillingCycle(c)
                    setBriefDirty(true)
                  }}
                  className={cn(
                    "px-3 py-1.5 text-xs transition-colors",
                    billingCycle === c
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted/50 text-muted-foreground",
                  )}
                >
                  {c === 1
                    ? t("onboarding.wizard.kickoff.aanbod.cycle.monthly", locale)
                    : c === 2
                      ? t("onboarding.wizard.kickoff.aanbod.cycle.two_months", locale)
                      : t("onboarding.wizard.kickoff.aanbod.cycle.quarterly", locale)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              {t("onboarding.wizard.kickoff.aanbod.setup_fee.label", locale)}
            </label>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">€</span>
              <Input
                type="number"
                inputMode="numeric"
                value={setupFee}
                onChange={(e) => {
                  setSetupFee(e.target.value)
                  setBriefDirty(true)
                }}
                placeholder="0"
                className="h-8 w-24 text-xs"
              />
              <span className="text-[10px] text-muted-foreground/70">eenmalig</span>
            </div>
          </div>
        </div>

        {/* Service lines */}
        <div className="space-y-1.5">
          {AANBOD_LINES.map(({ key, labelKey }) => {
            const line = aanbod[key] ?? { included: false, pricePerMonth: "" }
            return (
              <AanbodRow
                key={key}
                label={t(labelKey as Parameters<typeof t>[0], locale)}
                included={line.included}
                pricePerMonth={line.pricePerMonth}
                onToggle={() => updateAanbodLine(key, { included: !line.included })}
                onPriceChange={(v) => updateAanbodLine(key, { pricePerMonth: v })}
              />
            )
          })}
        </div>

        {/* Totals */}
        <div className="mt-3 pt-3 border-t border-border/30 space-y-1 text-xs">
          <TotalRow
            label={t("onboarding.wizard.kickoff.aanbod.totals.per_month", locale)}
            amount={monthlyTotal}
          />
          {billingCycle > 1 && (
            <TotalRow
              label={
                billingCycle === 2
                  ? t("onboarding.wizard.kickoff.aanbod.totals.per_2_months", locale)
                  : t("onboarding.wizard.kickoff.aanbod.totals.per_quarter", locale)
              }
              amount={cycleTotal}
              muted
            />
          )}
          {setupFeeNum > 0 && (
            <TotalRow
              label={t("onboarding.wizard.kickoff.aanbod.totals.setup_fee", locale)}
              amount={setupFeeNum}
              muted
              suffix="eenmalig"
            />
          )}
          <TotalRow
            label={t("onboarding.wizard.kickoff.aanbod.totals.first_invoice", locale)}
            amount={firstInvoiceTotal}
            bold
          />
        </div>
      </section>

      {/* Brief template - fill live during the call */}
      <section className="rounded-xl border border-border/60 bg-card/50 p-4">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h3 className="text-sm font-semibold">
            {t("onboarding.wizard.kickoff.brief.title", locale)}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {briefDirty
                ? t("onboarding.wizard.kickoff.brief.saving", locale)
                : countFilled(briefDraft) > 0
                  ? t("onboarding.wizard.kickoff.brief.saved", locale)
                  : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => prefillBrief.mutate()}
              disabled={prefillBrief.isPending}
              className="gap-1.5 h-7 text-xs"
              title={t("onboarding.wizard.kickoff.brief.prefill.hint", locale)}
            >
              {prefillBrief.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {t("onboarding.wizard.kickoff.brief.prefill.btn", locale)}
            </Button>
          </div>
        </div>
        {prefillBrief.isError && (
          <div className="mb-3 text-[11px] text-destructive">
            {prefillBrief.error instanceof Error
              ? prefillBrief.error.message
              : "Pre-fill failed"}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={t("onboarding.wizard.brief.field.bedrijf", locale)}>
            <Input
              value={briefDraft.bedrijf}
              onChange={(e) => updateBrief("bedrijf", e.target.value)}
              placeholder={companyName}
            />
          </Field>
          <Field label={t("onboarding.wizard.brief.field.sector", locale)}>
            <Input
              value={briefDraft.sector}
              onChange={(e) => updateBrief("sector", e.target.value)}
            />
          </Field>
        </div>

        <Field label={t("onboarding.wizard.brief.field.websiteUrl", locale)} className="mt-3">
          <Input
            value={briefDraft.websiteUrl}
            onChange={(e) => updateBrief("websiteUrl", e.target.value)}
            placeholder="https://"
          />
        </Field>

        <Field label={t("onboarding.wizard.brief.field.doelgroep", locale)} className="mt-3">
          <textarea
            value={briefDraft.doelgroep}
            onChange={(e) => updateBrief("doelgroep", e.target.value)}
            rows={2}
            className={textareaCls}
            placeholder={t("onboarding.wizard.brief.placeholder.doelgroep", locale)}
          />
        </Field>

        <Field label={t("onboarding.wizard.brief.field.pijnpunten", locale)} className="mt-3">
          <textarea
            value={briefDraft.pijnpunten}
            onChange={(e) => updateBrief("pijnpunten", e.target.value)}
            rows={2}
            className={textareaCls}
            placeholder={t("onboarding.wizard.brief.placeholder.pijnpunten", locale)}
          />
        </Field>

        <Field label={t("onboarding.wizard.brief.field.aanbod", locale)} className="mt-3">
          <textarea
            value={briefDraft.aanbod}
            onChange={(e) => updateBrief("aanbod", e.target.value)}
            rows={2}
            className={textareaCls}
            placeholder={t("onboarding.wizard.brief.placeholder.aanbod", locale)}
          />
        </Field>

        <Field label={t("onboarding.wizard.brief.field.usps", locale)} className="mt-3">
          <textarea
            value={briefDraft.usps}
            onChange={(e) => updateBrief("usps", e.target.value)}
            rows={2}
            className={textareaCls}
            placeholder={t("onboarding.wizard.brief.placeholder.usps", locale)}
          />
        </Field>

        <Field label={t("onboarding.wizard.brief.field.marketingHooks", locale)} className="mt-3">
          <textarea
            value={briefDraft.marketingHooks}
            onChange={(e) => updateBrief("marketingHooks", e.target.value)}
            rows={3}
            className={textareaCls}
            placeholder={t("onboarding.wizard.brief.placeholder.marketingHooks", locale)}
          />
        </Field>
      </section>

      {/* Formulier leads — vragen op de landingspagina. Eerste 3 zijn
          de standaard (naam/telefoon/email, niet verwijderbaar);
          AM voegt custom vragen toe via plus-knop. */}
      <section className="rounded-xl border border-border/60 bg-card/50 p-4">
        <h3 className="text-sm font-semibold mb-1">
          {t("onboarding.wizard.kickoff.form_fields.title", locale)}
        </h3>
        <p className="text-[11px] text-muted-foreground mb-3">
          {t("onboarding.wizard.kickoff.form_fields.hint", locale)}
        </p>
        <div className="space-y-1.5">
          {formFields.map((field) => (
            <FormFieldRow
              key={field.id}
              field={field}
              onLabelChange={(label) => updateFormFieldLabel(field.id, label)}
              onRemove={() => removeFormField(field.id)}
              addLabel={t("onboarding.wizard.kickoff.form_fields.label_placeholder", locale)}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addFormField}
            className="gap-1.5 mt-2"
          >
            <Plus className="h-3 w-3" />
            {t("onboarding.wizard.kickoff.form_fields.add", locale)}
          </Button>
        </div>
      </section>

      {/* Automations — Zapier flows die afgaan bij een nieuwe lead.
          Default alles aan want dat is het standaard pakket; AM
          untickt alleen wat niet geldt. */}
      <section className="rounded-xl border border-border/60 bg-card/50 p-4">
        <h3 className="text-sm font-semibold mb-1">
          {t("onboarding.wizard.kickoff.automations.title", locale)}
        </h3>
        <p className="text-[11px] text-muted-foreground mb-3">
          {t("onboarding.wizard.kickoff.automations.hint", locale)}
        </p>
        <div className="space-y-1.5">
          {AUTOMATION_LINES.map(({ key, labelKey }) => (
            <label
              key={key}
              className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/30 cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={automations[key] ?? false}
                onChange={() => toggleAutomation(key)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <span className={cn("text-sm", automations[key] ? "text-foreground" : "text-muted-foreground")}>
                {t(labelKey as Parameters<typeof t>[0], locale)}
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* Brand identity - pulled from the website URL above. Pedro
          pre-fills its `brand_style` from this so the CM never has to
          re-extract colors. Hex codes are AM-editable. */}
      <BrandIdentitySection
        websiteUrl={briefDraft.websiteUrl}
        brandStyle={brandStyle}
        swatches={brandSwatches}
        analyzing={analyzeBrand.isPending}
        error={analyzeBrand.isError ? (analyzeBrand.error instanceof Error ? analyzeBrand.error.message : "Failed") : null}
        onAnalyze={() => analyzeBrand.mutate()}
        onUpdateColor={updateBrandColor}
        locale={locale}
      />

      <RecapDialog
        open={recapOpen}
        onOpenChange={setRecapOpen}
        mondayItemId={mondayItemId}
        sentAt={content.recapSentAt}
        onMarkSent={handleMarkRecapSent}
        locale={locale}
      />

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
        <Button
          variant="ghost"
          className="gap-1.5"
          onClick={() => setRecapOpen(true)}
        >
          <Send className="h-3.5 w-3.5" />
          {content.recapSentAt
            ? t("onboarding.wizard.kickoff.send_recap.again", locale)
            : t("onboarding.wizard.kickoff.send_recap", locale)}
        </Button>
        <Button
          onClick={() => markDone.mutate()}
          disabled={markDone.isPending}
          className="gap-1.5"
        >
          {markDone.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : step.done ? (
            <Save className="h-3.5 w-3.5" />
          ) : (
            <ArrowRight className="h-3.5 w-3.5" />
          )}
          {step.done
            ? t("onboarding.wizard.kickoff.save_and_continue", locale)
            : t("onboarding.wizard.kickoff.mark_done", locale)}
        </Button>
      </div>

      {markDone.isError && (
        <div className="text-xs text-destructive">
          {markDone.error instanceof Error ? markDone.error.message : "Failed"}
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────

function PaymentStatusRow({
  status,
  loading,
  hasCustomerId,
  locale,
}: {
  status: PaymentStatus | undefined
  loading: boolean
  hasCustomerId: boolean
  locale: Locale
}) {
  const paid = status?.hasPaid === true
  const label = !hasCustomerId
    ? t("onboarding.wizard.kickoff.status.payment.no_customer", locale)
    : loading
      ? t("onboarding.wizard.kickoff.status.payment.checking", locale)
      : paid
        ? t("onboarding.wizard.kickoff.status.payment.paid", locale)
        : t("onboarding.wizard.kickoff.status.payment.unpaid", locale)

  return (
    <div className="flex items-center gap-3 text-xs">
      <CircleDollarSign
        className={cn(
          "h-4 w-4 shrink-0",
          paid ? "text-emerald-500" : "text-amber-500",
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="font-medium">
          {t("onboarding.wizard.kickoff.status.payment.label", locale)}
        </div>
        <div className={cn("text-muted-foreground", paid && "text-emerald-700 dark:text-emerald-400")}>
          {label}
          {paid && status?.lastPaidAt && (
            <span className="text-muted-foreground/70 ml-1">
              · {formatRelativeShort(status.lastPaidAt, locale)}
              {status.lastPaidAmount != null && (
                <> · €{status.lastPaidAmount.toLocaleString("nl-NL")}</>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Checkbox-driven resource card. The checkbox IS the primary state
 * affordance — left edge, large enough to read at a glance. Right edge
 * carries a Copy + Open-link pair so the AM can share the URL with
 * the klant without disturbing the checked state. Roy 2026-06-11
 * UX direction: "het hele item zou een checkbox moeten zijn".
 */
function CheckboxResourceRow({
  label,
  url,
  urlLabel,
  checked,
  onToggle,
  pending,
  disabled,
}: {
  label: string
  url: string | null
  urlLabel: string
  checked: boolean
  onToggle: (next: boolean) => void
  pending: boolean
  disabled: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        checked
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-border/60 bg-card/30 hover:bg-muted/30",
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(!checked)}
        disabled={disabled || pending}
        className="shrink-0 h-5 w-5 rounded-md border-2 flex items-center justify-center transition-colors"
        style={{
          borderColor: checked ? "rgb(16 185 129)" : "rgb(148 163 184 / 0.5)",
          background: checked ? "rgb(16 185 129)" : "transparent",
        }}
        aria-label={checked ? "Uncheck" : "Check"}
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin text-white" />
        ) : checked ? (
          <Check className="h-3 w-3 text-white" />
        ) : null}
      </button>
      <div className="flex-1 min-w-0">
        <div className={cn("text-sm font-medium", checked && "text-emerald-700 dark:text-emerald-400")}>
          {label}
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[11px] text-muted-foreground hover:text-primary truncate block transition-colors"
          >
            {urlLabel}
          </a>
        )}
      </div>
      {url && (
        <Button
          size="sm"
          variant="ghost"
          onClick={copy}
          disabled={disabled}
          className="h-7 w-7 p-0 shrink-0"
          title="Copy link"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
      )}
    </div>
  )
}

/**
 * Eén totaal-regel onderaan de Aanbod sectie. Format: "Label: €X,XXX"
 * met optioneel een suffix (eenmalig, etc.). Bold variant voor het
 * eerste-betaling totaal zodat het visueel oppopt.
 */
function TotalRow({
  label,
  amount,
  bold,
  muted,
  suffix,
}: {
  label: string
  amount: number
  bold?: boolean
  muted?: boolean
  suffix?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3",
        bold && "pt-1.5 mt-1.5 border-t border-border/40 text-sm font-semibold",
        muted && !bold && "text-muted-foreground",
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">
        €{amount.toLocaleString("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
        {suffix && (
          <span className="ml-1 text-[10px] text-muted-foreground/70 font-normal">
            {suffix}
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * Eén regel in de Aanbod sectie: checkbox links, label midden, prijs
 * input rechts (alleen actief wanneer de checkbox aan staat).
 */
function AanbodRow({
  label,
  included,
  pricePerMonth,
  onToggle,
  onPriceChange,
}: {
  label: string
  included: boolean
  pricePerMonth: string
  onToggle: () => void
  onPriceChange: (v: string) => void
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors",
        included ? "bg-emerald-500/5" : "hover:bg-muted/30",
      )}
    >
      <input
        type="checkbox"
        checked={included}
        onChange={onToggle}
        className="h-4 w-4 rounded border-input accent-primary"
      />
      <span className={cn("flex-1 text-sm", included ? "text-foreground" : "text-muted-foreground")}>
        {label}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-xs text-muted-foreground">€</span>
        <Input
          type="number"
          inputMode="numeric"
          value={pricePerMonth}
          onChange={(e) => onPriceChange(e.target.value)}
          placeholder="0"
          disabled={!included}
          className="h-7 w-20 text-xs"
        />
        <span className="text-[10px] text-muted-foreground/70">/mnd</span>
      </div>
    </div>
  )
}

/**
 * Eén veld-rij in de Formulier leads sectie. Default fields tonen
 * geen verwijder-X (Naam/Telefoon/Email zijn altijd verplicht); custom
 * fields hebben volledige edit + delete.
 */
function FormFieldRow({
  field,
  onLabelChange,
  onRemove,
  addLabel,
}: {
  field: FormField
  onLabelChange: (v: string) => void
  onRemove: () => void
  addLabel: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/30 transition-colors">
      <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
      <Input
        value={field.label}
        onChange={(e) => onLabelChange(e.target.value)}
        readOnly={field.isDefault}
        placeholder={addLabel}
        className={cn(
          "h-7 text-xs flex-1",
          field.isDefault && "bg-muted/40 cursor-default",
        )}
      />
      {!field.isDefault && (
        <button
          type="button"
          onClick={onRemove}
          className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
          aria-label="Verwijder"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

/**
 * Post-kick-off recap dialog. Renders the template-generated message
 * in an editable textarea so the AM can tweak before sending, plus a
 * Copy-to-clipboard button. Trengo-API-direct send wordt later wired —
 * voor nu kopieert AM en plakt in Trengo / WhatsApp. "Markeer als
 * verzonden" knop persistt de timestamp zodat we de status in de
 * footer kunnen tonen.
 */
function RecapDialog({
  open,
  onOpenChange,
  mondayItemId,
  sentAt,
  onMarkSent,
  locale,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  mondayItemId: string
  sentAt?: string
  onMarkSent: () => Promise<void> | void
  locale: Locale
}) {
  const [draft, setDraft] = useState("")
  const [copied, setCopied] = useState(false)
  const [marking, setMarking] = useState(false)
  const [source, setSource] = useState<
    "ai_from_transcript" | "fallback_no_transcript" | "fallback_short_transcript" | null
  >(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/clients/${mondayItemId}/onboarding/generate-recap`,
        { method: "POST" },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Generate failed")
      }
      const data = (await res.json()) as {
        body: string
        source:
          | "ai_from_transcript"
          | "fallback_no_transcript"
          | "fallback_short_transcript"
      }
      setDraft(data.body)
      setSource(data.source)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generate failed")
    } finally {
      setLoading(false)
    }
  }

  // Auto-fetch on open. If the dialog re-opens with content already in
  // the draft we keep it (AM might have closed/reopened to copy again).
  useEffect(() => {
    if (open && draft.length === 0 && !loading) {
      void generate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(draft)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleMarkSent = async () => {
    setMarking(true)
    try {
      await onMarkSent()
    } finally {
      setMarking(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("onboarding.wizard.kickoff.recap.title", locale)}</DialogTitle>
          <DialogDescription>
            {source === "ai_from_transcript"
              ? t("onboarding.wizard.kickoff.recap.source.ai", locale)
              : source === "fallback_no_transcript"
                ? t("onboarding.wizard.kickoff.recap.source.no_transcript", locale)
                : source === "fallback_short_transcript"
                  ? t("onboarding.wizard.kickoff.recap.source.short_transcript", locale)
                  : t("onboarding.wizard.kickoff.recap.description", locale)}
          </DialogDescription>
        </DialogHeader>

        {loading && draft.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-sm">
              {t("onboarding.wizard.kickoff.recap.generating", locale)}
            </span>
          </div>
        ) : (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={18}
            className={cn(
              "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
              "placeholder:text-muted-foreground/50 resize-y",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0",
            )}
          />
        )}

        {error && (
          <p className="text-[11px] text-destructive">{error}</p>
        )}

        {sentAt && (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
            {t("onboarding.wizard.kickoff.recap.sent_at", locale)}
            {new Date(sentAt).toLocaleString(locale === "en" ? "en-GB" : "nl-NL", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => generate()}
            disabled={loading}
            className="gap-1.5"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {t("onboarding.wizard.kickoff.recap.regenerate", locale)}
          </Button>
          <Button variant="outline" onClick={handleCopy} className="gap-1.5" disabled={!draft}>
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied
              ? t("onboarding.wizard.kickoff.recap.copied", locale)
              : t("onboarding.wizard.kickoff.recap.copy", locale)}
          </Button>
          <Button onClick={handleMarkSent} disabled={marking || !draft} className="gap-1.5">
            {marking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {t("onboarding.wizard.kickoff.recap.mark_sent", locale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResourceRow({
  icon: Icon,
  label,
  url,
  disabled,
  hint,
}: {
  icon: typeof Folder
  label: string
  url: string | null
  disabled: boolean
  hint?: string
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex items-center gap-3 text-xs">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground truncate">{url ?? hint ?? "-"}</div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={copy}
        disabled={disabled || !url}
        className="h-8 gap-1"
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-500" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  )
}

/**
 * Brand identity - lives in its own section so the AM can do the
 * website fingerprint as a discrete step after typing the URL above.
 * Empty state: just the Analyze button + hint. Loaded state: three
 * editable hex inputs (primary / secondary / accent) with live color
 * swatches + a row of extracted swatches the AM can click to override
 * the auto-pick. Heading/body fonts are display-only. Persists through
 * the parent's debounced PATCH (same `content` blob as the brief).
 */
function BrandIdentitySection({
  websiteUrl,
  brandStyle,
  swatches,
  analyzing,
  error,
  onAnalyze,
  onUpdateColor,
  locale,
}: {
  websiteUrl: string
  brandStyle: BrandFingerprint | null
  swatches: ExtractedColor[]
  analyzing: boolean
  error: string | null
  onAnalyze: () => void
  onUpdateColor: (
    field: "primaryColor" | "secondaryColor" | "accentColor",
    hex: string,
  ) => void
  locale: Locale
}) {
  const hasUrl = websiteUrl.trim().length > 0
  return (
    <section className="rounded-xl border border-border/60 bg-card/50 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Palette className="h-3.5 w-3.5 text-primary" />
          {t("onboarding.wizard.kickoff.brand.title", locale)}
        </h3>
        <Button
          size="sm"
          variant={brandStyle ? "outline" : "default"}
          onClick={onAnalyze}
          disabled={analyzing || !hasUrl}
          title={!hasUrl ? t("onboarding.wizard.kickoff.brand.no_url", locale) : undefined}
          className="gap-1.5"
        >
          {analyzing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {analyzing
            ? t("onboarding.wizard.kickoff.brand.analyzing", locale)
            : t("onboarding.wizard.kickoff.brand.analyze_btn", locale)}
        </Button>
      </div>

      {!brandStyle && (
        <p className="text-xs text-muted-foreground">
          {hasUrl
            ? t("onboarding.wizard.kickoff.brand.analyze_hint", locale)
            : t("onboarding.wizard.kickoff.brand.no_url", locale)}
        </p>
      )}

      {error && (
        <div className="mt-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {brandStyle && (
        <div className="space-y-3">
          {/* Editable hex inputs for the 3 brand colors. Primary always
              shows; accent only if the analyzer picked one. */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(["primaryColor", "secondaryColor", "accentColor"] as const).map((field) => {
              const value = brandStyle[field] ?? ""
              if (field === "accentColor" && !value) return null
              const label =
                field === "primaryColor"
                  ? t("onboarding.wizard.kickoff.brand.color.primary", locale)
                  : field === "secondaryColor"
                    ? t("onboarding.wizard.kickoff.brand.color.secondary", locale)
                    : t("onboarding.wizard.kickoff.brand.color.accent", locale)
              return (
                <Field key={field} label={label}>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-9 w-9 shrink-0 rounded-md border border-border/60"
                      style={{ backgroundColor: value || "transparent" }}
                    />
                    <Input
                      value={value}
                      onChange={(e) => onUpdateColor(field, e.target.value)}
                      placeholder="#000000"
                      className="font-mono text-xs"
                    />
                  </div>
                </Field>
              )
            })}
          </div>

          {/* Display-only font picks. We don't let the AM override here -
              if the picked font is wrong, the CM tunes it in Pedro. */}
          {(brandStyle.headingFont || brandStyle.bodyFont) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
              {brandStyle.headingFont && (
                <div>
                  <span className="text-[10px] uppercase tracking-wide block mb-0.5">
                    {t("onboarding.wizard.kickoff.brand.font.heading", locale)}
                  </span>
                  <span className="font-medium text-foreground">{brandStyle.headingFont}</span>
                </div>
              )}
              {brandStyle.bodyFont && (
                <div>
                  <span className="text-[10px] uppercase tracking-wide block mb-0.5">
                    {t("onboarding.wizard.kickoff.brand.font.body", locale)}
                  </span>
                  <span className="font-medium text-foreground">{brandStyle.bodyFont}</span>
                </div>
              )}
            </div>
          )}

          {/* Quick-pick swatches - top extracted colors with origin tags.
              Click sets primary, shift-click sets secondary. Same UX as
              Pedro's brand swatches so the muscle memory transfers. */}
          {swatches.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                {t("onboarding.wizard.kickoff.brand.swatches_hint", locale)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {swatches.slice(0, 8).map((c) => {
                  const isPrimary = c.hex === brandStyle.primaryColor
                  const isSecondary = c.hex === brandStyle.secondaryColor
                  return (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={(e) =>
                        e.shiftKey
                          ? onUpdateColor("secondaryColor", c.hex)
                          : onUpdateColor("primaryColor", c.hex)
                      }
                      title={`${c.hex} · ${c.source}`}
                      className={cn(
                        "h-7 w-7 rounded-md border-2 transition-transform",
                        isPrimary
                          ? "border-emerald-500/60 scale-110"
                          : isSecondary
                            ? "border-primary scale-110"
                            : "border-border/40 hover:scale-105",
                      )}
                      style={{ backgroundColor: c.hex }}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

const textareaCls = cn(
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
  "placeholder:text-muted-foreground/50 resize-y",
  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0",
)

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      {children}
    </label>
  )
}

function countFilled(b: BriefDraft): number {
  return Object.values(b).filter((v) => v.trim().length > 0).length
}

/** Compact "X min/uur/dagen geleden" for payment timestamps. */
function formatRelativeShort(unixSeconds: number, locale: Locale): string {
  const diffMs = Date.now() - unixSeconds * 1000
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return locale === "en" ? "just now" : "zojuist"
  if (min < 60) return locale === "en" ? `${min}m ago` : `${min}m geleden`
  const hr = Math.floor(min / 60)
  if (hr < 24) return locale === "en" ? `${hr}h ago` : `${hr}u geleden`
  const days = Math.floor(hr / 24)
  return locale === "en" ? `${days}d ago` : `${days}d geleden`
}
