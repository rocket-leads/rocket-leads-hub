"use client"

import { useQuery } from "@tanstack/react-query"
import Image from "next/image"
import {
  User,
  Briefcase,
  Wallet,
  CreditCard,
  ExternalLink,
} from "lucide-react"
import { BackButton } from "./back-button"
import { StatusEditCell } from "@/app/(dashboard)/clients/_components/status-edit-cell"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { mondayStatusToHub } from "@/lib/clients/status"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import type { MondayClient } from "@/lib/integrations/monday"
import type { BillingData, InvoiceRow } from "@/lib/integrations/stripe"

function getInitials(name: string): string {
  return name
    .split(/[\s\-&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
}

function fmtEuro(v: number): string {
  return `€${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
}

function fmtBudget(adBudget: string): string {
  if (!adBudget) return "—"
  if (adBudget.startsWith("€")) return adBudget
  const n = Number(adBudget.replace(/[^0-9.-]/g, ""))
  if (!isFinite(n) || n === 0) return adBudget
  return `€${n.toLocaleString("en-GB")}`
}

type PaymentSummary =
  | { kind: "complete" }
  | { kind: "open"; count: number; amount: number }
  | { kind: "overdue"; count: number; amount: number }

function summarize(invoices: InvoiceRow[] | undefined): PaymentSummary | null {
  if (!invoices) return null
  const overdue = invoices.filter((i) => i.status === "overdue")
  const open = invoices.filter((i) => i.status === "open")
  if (overdue.length > 0) {
    return {
      kind: "overdue",
      count: overdue.length,
      amount: overdue.reduce((s, i) => s + (i.amountDue - i.amountPaid), 0),
    }
  }
  if (open.length > 0) {
    return {
      kind: "open",
      count: open.length,
      amount: open.reduce((s, i) => s + (i.amountDue - i.amountPaid), 0),
    }
  }
  return { kind: "complete" }
}

function PaymentInline({ summary, locale }: { summary: PaymentSummary | null; locale: Locale }) {
  if (!summary) return <span className="text-muted-foreground/40">—</span>
  if (summary.kind === "complete") {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-500 font-medium">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {t("client.header.payment.paid", locale)}
      </span>
    )
  }
  if (summary.kind === "open") {
    return (
      <span className="inline-flex items-center gap-1.5 text-amber-500 font-medium">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        {t("client.header.payment.open", locale, { count: String(summary.count), amount: fmtEuro(summary.amount) })}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-red-500 font-medium">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      {t("client.header.payment.overdue", locale, { count: String(summary.count), amount: fmtEuro(summary.amount) })}
    </span>
  )
}

type Props = {
  client: MondayClient
  canViewBilling: boolean
}

export function ClientHeader({ client, canViewBilling }: Props) {
  const locale = useLocale()
  const hubStatus = mondayStatusToHub(client.campaignStatus, client.boardType)

  // Same queryKey as the tab notification dot uses — React Query dedupes the fetch.
  const billingQuery = useQuery<Partial<BillingData>>({
    queryKey: ["billing-check", client.mondayItemId],
    queryFn: () =>
      client.stripeCustomerId
        ? fetch(`/api/clients/${client.mondayItemId}/billing?stripeCustomerId=${client.stripeCustomerId}`).then((r) => r.json())
        : Promise.resolve({}),
    enabled: !!client.stripeCustomerId && canViewBilling,
    staleTime: 5 * 60 * 1000,
  })

  const paymentSummary = summarize(billingQuery.data?.invoices)

  // Quick links to the canonical view of this client in each external system.
  // Brand SVGs/PNGs live in /public/logos/brands so the marks render at their
  // real colors (Meta blue, Monday tri-dot, Drive multi-color triangle, etc.)
  // — closer to what the user sees when they actually visit those tools.
  const quickLinks: Array<{ label: string; logo: string; href: string }> = [
    ...(client.metaAdAccountId
      ? [{
          label: "Meta",
          logo: "/logos/brands/meta.svg",
          href: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${client.metaAdAccountId.replace("act_", "")}`,
        }]
      : []),
    ...(client.clientBoardId
      ? [{
          label: "Monday",
          logo: "/logos/brands/monday.svg",
          href: `https://rocketleads-team.monday.com/boards/${client.clientBoardId}`,
        }]
      : []),
    ...(client.googleDriveId
      ? [{
          label: "Drive",
          logo: "/logos/brands/google-drive.svg",
          href: `https://drive.google.com/drive/folders/${client.googleDriveId}`,
        }]
      : []),
  ]

  return (
    <div className="mb-6">
      <div className="flex items-center mb-5">
        <BackButton />
        {/* Global client search moved to the dashboard topbar so it's reachable
            from every page, not just the client detail surface. */}
      </div>

      <div className="-mx-4 px-4 py-4 rounded-xl bg-gradient-to-r from-muted/30 to-transparent">
        <div className="flex items-start justify-between gap-4">
          {/* Left: Avatar + name + status */}
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center shrink-0 shadow-sm shadow-primary/10">
              <span className="text-sm font-heading font-bold text-white tracking-tight">
                {getInitials(client.name)}
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <h1 className="text-2xl font-heading font-bold tracking-tight">{client.name}</h1>
                <StatusEditCell
                  mondayItemId={client.mondayItemId}
                  status={hubStatus}
                  readOnly={client.boardType === "onboarding"}
                />
                {/* Board type pill — same shape/size as the Live status pill, just a
                    neutral grey + lowercase label so it reads as a passive tag. */}
                <span className="inline-flex items-center rounded-md px-2.5 py-1 text-[13px] font-medium bg-muted/60 text-muted-foreground">
                  {client.boardType}
                </span>
              </div>
              {/* Inline meta row — first name + AM + CM + Budget + Payment, separated
                  by middle dots. Replaces the previous separate row below. */}
              <MetaRow
                firstName={client.firstName}
                accountManager={client.accountManager}
                campaignManager={client.campaignManager}
                adBudget={client.adBudget}
                showPayment={!!client.stripeCustomerId && canViewBilling}
                paymentSummary={paymentSummary}
                locale={locale}
              />
            </div>
          </div>

          {/* Right: Quick links to external systems */}
          {quickLinks.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              {quickLinks.map(({ label, logo, href }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-foreground/80")}
                >
                  <Image
                    src={logo}
                    alt=""
                    width={14}
                    height={14}
                    className="h-4 w-4 object-contain"
                    unoptimized
                  />
                  {label}
                  <ExternalLink className="h-3.5 w-3.5 opacity-50" />
                </a>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

function MetaRow({
  firstName,
  accountManager,
  campaignManager,
  adBudget,
  showPayment,
  paymentSummary,
  locale,
}: {
  firstName: string
  accountManager: string
  campaignManager: string
  adBudget: string
  showPayment: boolean
  paymentSummary: PaymentSummary | null
  locale: Locale
}) {
  // Build the visible items first so we know where to drop separators.
  const items: React.ReactNode[] = []

  if (firstName) {
    items.push(
      <span key="first" className="text-muted-foreground/70">
        {firstName}
      </span>,
    )
  }
  if (accountManager) {
    items.push(
      <span key="am" className="inline-flex items-center gap-1.5">
        <User className="h-3.5 w-3.5 text-muted-foreground/40" />
        <span className="text-muted-foreground/40">{t("client.header.am", locale)}</span>
        <span className="text-foreground/80 font-medium">{accountManager}</span>
      </span>,
    )
  }
  if (campaignManager) {
    items.push(
      <span key="cm" className="inline-flex items-center gap-1.5">
        <Briefcase className="h-3.5 w-3.5 text-muted-foreground/40" />
        <span className="text-muted-foreground/40">{t("client.header.cm", locale)}</span>
        <span className="text-foreground/80 font-medium">{campaignManager}</span>
      </span>,
    )
  }
  if (adBudget) {
    items.push(
      <span key="budget" className="inline-flex items-center gap-1.5">
        <Wallet className="h-3.5 w-3.5 text-muted-foreground/40" />
        <span className="text-muted-foreground/40">{t("client.header.budget", locale)}</span>
        <span className="text-foreground/80 font-medium tabular-nums">{fmtBudget(adBudget)}</span>
      </span>,
    )
  }
  if (showPayment) {
    items.push(
      <span key="payment" className="inline-flex items-center gap-1.5">
        <CreditCard className="h-3.5 w-3.5 text-muted-foreground/40" />
        <span className="text-muted-foreground/40">{t("client.header.payment", locale)}</span>
        <PaymentInline summary={paymentSummary} locale={locale} />
      </span>,
    )
  }

  if (items.length === 0) return null

  return (
    <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-xs">
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-x-2">
          {i > 0 && <span className="text-muted-foreground/30 select-none">·</span>}
          {item}
        </span>
      ))}
    </div>
  )
}
