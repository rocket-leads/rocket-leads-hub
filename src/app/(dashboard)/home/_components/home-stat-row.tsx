import Link from "next/link"
import { Flame, Inbox, CreditCard, Wallet, ArrowUpRight } from "lucide-react"
import type { ReactNode } from "react"

const eur = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
})

type Stat = {
  href: string
  icon: ReactNode
  label: string
  value: string
  sub: string
  /** Purple gradient hero number - used for the headline (MRR) metric. */
  grad?: boolean
}

/**
 * 187N stat-card KPI row for the Home landing: four summary tiles derived from
 * the home data pass (clients needing attention, unread inbox, outstanding
 * billing, team MRR this month). Each tile is a link into the deep view.
 */
export function HomeStatRow({
  actionCount,
  unreadInbox,
  totalOutstanding,
  outstandingCount,
  teamMrr,
  teamMrrClientCount,
}: {
  actionCount: number
  unreadInbox: number
  totalOutstanding: number
  outstandingCount: number
  teamMrr: number
  teamMrrClientCount: number
}) {
  const stats: Stat[] = [
    {
      href: "/watchlist",
      icon: <Flame />,
      label: "Needs attention",
      value: String(actionCount),
      sub: actionCount === 0 ? "All clients healthy" : "Live clients on the Watch List",
    },
    {
      href: "/inbox",
      icon: <Inbox />,
      label: "Your inbox",
      value: String(unreadInbox),
      sub: unreadInbox === 0 ? "Inbox zero" : "Tasks + updates waiting",
    },
    {
      href: "/billing",
      icon: <CreditCard />,
      label: "Outstanding",
      value: eur.format(totalOutstanding),
      sub: outstandingCount === 0 ? "Nothing open" : `Across ${outstandingCount} client${outstandingCount === 1 ? "" : "s"}`,
    },
    {
      href: "/targets",
      icon: <Wallet />,
      label: "Team MRR",
      value: eur.format(teamMrr),
      sub: `${teamMrrClientCount} client${teamMrrClientCount === 1 ? "" : "s"} billing this month`,
      grad: true,
    },
  ]

  return (
    <div className="stat-row cols-4">
      {stats.map((s) => (
        <Link key={s.href} href={s.href} className="stat-card">
          <div className="row1">
            <div className="row1-left">
              <span className="icon-badge">{s.icon}</span>
              <span className="cat-label">{s.label}</span>
            </div>
            <span className="arrow-go">
              <ArrowUpRight />
            </span>
          </div>
          <div className={`hero-num${s.grad ? " grad" : ""}`}>{s.value}</div>
          <div className="sub-label" style={{ marginTop: 10, marginBottom: 0 }}>
            {s.sub}
          </div>
        </Link>
      ))}
    </div>
  )
}
