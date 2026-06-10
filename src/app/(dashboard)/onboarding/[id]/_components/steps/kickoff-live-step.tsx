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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

type KickoffContent = {
  autoSetup?: AutoSetupResult
  briefDraft?: BriefDraft
  recapSentAt?: string
}

/**
 * Stap 1 — Live kick-off tool. AM opens this *during* the kick-off call.
 *
 * On first mount, auto-setup creates the Drive folder tree + generates
 * the Meta BM connect URL placeholder. Two resources surface to share
 * with the client (Drive folder + Meta BM connect link) — Stripe payment
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

  useEffect(() => {
    if (!briefDirty) return
    const handle = setTimeout(() => {
      void fetch(`/api/clients/${mondayItemId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepKey: step.key,
          done: false,
          content: { ...content, briefDraft },
        }),
      })
      setBriefDirty(false)
    }, 3000)
    return () => clearTimeout(handle)
  }, [briefDirty, briefDraft, content, mondayItemId, step.key])

  const updateBrief = <K extends keyof BriefDraft>(field: K, value: string) => {
    setBriefDraft((b) => ({ ...b, [field]: value }))
    setBriefDirty(true)
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

  const briefHasMin = countFilled(briefDraft) >= 5
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

      {/* Hub connections — typeahead pickers writing straight to Monday */}
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

      {/* Resources — share with client (Drive + Meta BM only) */}
      <section className="rounded-xl border border-border/60 bg-card/50 p-4">
        <h3 className="text-sm font-semibold mb-3">
          {t("onboarding.wizard.kickoff.resources.title", locale)}
        </h3>
        <div className="space-y-2">
          <ResourceRow
            icon={Folder}
            label={t("onboarding.wizard.kickoff.resource.drive", locale)}
            url={autoSetup?.drive.rootFolderUrl ?? null}
            disabled={!autoSetup}
          />
          <ResourceRow
            icon={Megaphone}
            label={t("onboarding.wizard.kickoff.resource.meta_bm", locale)}
            url={autoSetup?.metaBmConnectUrl ?? null}
            disabled={!autoSetup}
            hint={t("onboarding.wizard.kickoff.resource.meta_bm.hint", locale)}
          />
        </div>
      </section>

      {/* Live status — payment indicator (polled) */}
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

      {/* Brief template — fill live during the call */}
      <section className="rounded-xl border border-border/60 bg-card/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">
            {t("onboarding.wizard.kickoff.brief.title", locale)}
          </h3>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {briefDirty
              ? t("onboarding.wizard.kickoff.brief.saving", locale)
              : countFilled(briefDraft) > 0
                ? t("onboarding.wizard.kickoff.brief.saved", locale)
                : ""}
          </span>
        </div>

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

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
        <Button variant="ghost" className="gap-1.5" disabled title="Sprint 2">
          <Send className="h-3.5 w-3.5" />
          {t("onboarding.wizard.kickoff.send_recap", locale)}
        </Button>
        <Button
          onClick={() => markDone.mutate()}
          disabled={markDone.isPending || !briefHasMin}
          className="gap-1.5"
          title={!briefHasMin ? t("onboarding.wizard.kickoff.brief.needs_fields", locale) : undefined}
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
        <div className="text-muted-foreground truncate">{url ?? hint ?? "—"}</div>
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
