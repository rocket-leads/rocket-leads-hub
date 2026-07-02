"use client"

import { useQuery } from "@tanstack/react-query"
import {
  History,
  Send,
  Ban,
  FileX2,
  Bell,
  Banknote,
  FileMinus2,
  Building2,
  Receipt,
  Loader2,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { BillingEvent, BillingAction } from "@/lib/billing/audit"
import { BillingSectionShell } from "./billing-section-shell"

const ACTION_META: Record<BillingAction, { icon: LucideIcon; label: string; tone: string }> = {
  invoice_sent: { icon: Send, label: "Invoice sent", tone: "text-emerald-500" },
  invoice_voided: { icon: Ban, label: "Invoice voided", tone: "text-red-500" },
  invoice_uncollectible: { icon: FileX2, label: "Marked uncollectible", tone: "text-amber-500" },
  invoice_resent: { icon: Bell, label: "Reminder resent", tone: "text-muted-foreground" },
  invoice_paid_offline: { icon: Banknote, label: "Marked paid (bank transfer)", tone: "text-emerald-500" },
  credit_note: { icon: FileMinus2, label: "Credit note issued", tone: "text-amber-500" },
  customer_updated: { icon: Building2, label: "Customer details updated", tone: "text-muted-foreground" },
  vat_updated: { icon: Receipt, label: "VAT number updated", tone: "text-muted-foreground" },
}

function fmtEuro(n: number): string {
  return `€${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function BillingAuditLog({ mondayItemId }: { mondayItemId: string }) {
  const query = useQuery<{ events: BillingEvent[] }>({
    queryKey: ["billing-events", mondayItemId],
    queryFn: async () => {
      const r = await fetch(`/api/clients/${mondayItemId}/billing-events`)
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? "Failed to load billing history")
      return data
    },
  })

  const events = query.data?.events ?? []

  return (
    <BillingSectionShell
      icon={History}
      title="Billing history"
      subtitle="Every invoice send, correction and customer edit made from the Hub - who, when, how much."
    >
      {query.isLoading ? (
        <div className="py-6 text-center text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/50 p-6 text-center text-sm text-muted-foreground">
          No billing actions recorded yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => {
            const meta = ACTION_META[e.action]
            const Icon = meta?.icon ?? History
            return (
              <li key={e.id} className="flex items-start gap-3 text-sm">
                <div className="h-7 w-7 rounded-md bg-muted/50 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className={`h-3.5 w-3.5 ${meta?.tone ?? "text-muted-foreground"}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {meta?.label ?? e.action}
                      {e.invoiceNumber && (
                        <span className="ml-1.5 font-mono text-xs text-muted-foreground">{e.invoiceNumber}</span>
                      )}
                    </span>
                    {e.amountEur != null && (
                      <span className="tabular-nums text-xs text-foreground/80 shrink-0">{fmtEuro(e.amountEur)}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground/70">
                    {fmtWhen(e.createdAt)}
                    {e.actorEmail && <span> · {e.actorEmail}</span>}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </BillingSectionShell>
  )
}
