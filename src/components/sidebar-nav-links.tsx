"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Users, Eye, Target, Settings, Inbox, Video, Receipt } from "lucide-react"

const ICONS = { Users, Eye, Target, Settings, Inbox, Video, Receipt }

type NavItem = { href: string; label: string; icon: keyof typeof ICONS }

type BadgeCounts = { unreadUpdates: number; openTasks: number }

function InboxBadge() {
  // Polled every 60s — cheap (two indexed counts) and good enough for "I have new items".
  const { data } = useQuery<BadgeCounts>({
    queryKey: ["inbox-badge"],
    queryFn: () => fetch("/api/inbox/badge").then((r) => r.json()),
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  })

  const total = (data?.unreadUpdates ?? 0) + (data?.openTasks ?? 0)
  if (!total) return null

  return (
    <span className="ml-auto rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
      {total > 99 ? "99+" : total}
    </span>
  )
}

type Props = {
  items: NavItem[]
  /** Clients with at least one overdue Stripe invoice — they haven't paid us.
   *  Finance-only signal; non-finance users always see 0. */
  stripeOverdueCount?: number
  /** Clients past their `nextInvoiceDate` who still need an invoice sent.
   *  This is the "send-out queue" trigger — the primary signal finance asked
   *  the dot for. Finance-only. */
  invoicesToSendCount?: number
}

export function SidebarNavLinks({
  items,
  stripeOverdueCount = 0,
  invoicesToSendCount = 0,
}: Props) {
  const pathname = usePathname()
  // Combined dot — fires on either signal. We don't show a numeric badge
  // because the finance dashboard surfaces the breakdown one click away;
  // sidebar just needs to say "open Billing, there's something for you".
  const showBillingDot = stripeOverdueCount > 0 || invoicesToSendCount > 0
  const billingTitle = (() => {
    const parts: string[] = []
    if (invoicesToSendCount > 0) {
      parts.push(`${invoicesToSendCount} invoice${invoicesToSendCount === 1 ? "" : "s"} to send`)
    }
    if (stripeOverdueCount > 0) {
      parts.push(`${stripeOverdueCount} overdue payment${stripeOverdueCount === 1 ? "" : "s"}`)
    }
    return parts.join(" · ")
  })()

  return (
    <nav className="flex-1 px-3 space-y-0.5">
      <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-[0.15em] px-3 mb-2">
        Platform
      </p>
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon]
        const active = pathname.startsWith(href)
        const isInbox = href === "/inbox"
        const isBilling = href === "/billing"
        return (
          <Link
            key={href}
            href={href}
            className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-150 ${
              active
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <Icon className={`h-[17px] w-[17px] transition-colors ${active ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground"}`} />
            {label}
            {isInbox && <InboxBadge />}
            {isBilling && showBillingDot && (
              <span
                className="ml-auto h-2 w-2 rounded-full bg-primary"
                title={billingTitle}
                aria-label={billingTitle}
              />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
