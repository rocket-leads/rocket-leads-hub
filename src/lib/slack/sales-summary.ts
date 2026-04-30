import type { TargetsConfig } from "@/types/targets"
import { DEFAULT_TEMPLATES, renderTemplate } from "./notification-config"

const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL ?? "https://hub.rocketleads.com"

const STATUS = {
  taken: ["No deal/FU", "No deal", "DEAL"] as const,
  deals: ["DEAL"] as const,
  noShow: ["No show"] as const,
  rejected: ["Not interested", "Lead cancelation"] as const,
  empty: ["Qualified", "Gepland"] as const, // Past appointment but outcome not logged yet
}

export type RawTargetsItem = {
  /** Person from `wie_` column. */
  closer: string | null
  /** Lead name (Monday item name). */
  name: string
  /** datum_afspraak — YYYY-MM-DD or null. */
  datumAfspraak: string | null
  /** date3 — when the deal was actually closed, if any. */
  dateDeal: string | null
  /** status column text. */
  status: string
  /** numbers column — deal value in EUR. */
  dealValue: number
}

export type CloserSalesMetrics = {
  closer: string
  yesterday: {
    taken: number
    statusBreakdown: Record<string, number>
  }
  today: {
    planned: number
  }
  mtd: {
    taken: number
    deals: number
    revenue: number
    conversion: number | null
  }
  emptyOutcomes: Array<{ name: string; daysOverdue: number; status: string }>
}

function isInPast(dateStr: string | null, today: string): boolean {
  return !!dateStr && dateStr < today
}

export function computeCloserMetrics(
  items: RawTargetsItem[],
  closerName: string,
  today: string,
  yesterday: string,
  monthStart: string,
): CloserSalesMetrics {
  const yesterdayMetrics = { taken: 0, statusBreakdown: {} as Record<string, number> }
  let todayPlanned = 0
  const mtd = { taken: 0, deals: 0, revenue: 0 }
  const emptyOutcomes: Array<{ name: string; daysOverdue: number; status: string }> = []

  for (const item of items) {
    if (item.closer !== closerName) continue

    // Yesterday: appointments held yesterday
    if (item.datumAfspraak === yesterday) {
      if (
        STATUS.taken.includes(item.status as typeof STATUS.taken[number]) ||
        STATUS.noShow.includes(item.status as typeof STATUS.noShow[number]) ||
        STATUS.empty.includes(item.status as typeof STATUS.empty[number])
      ) {
        yesterdayMetrics.taken++
        yesterdayMetrics.statusBreakdown[item.status] =
          (yesterdayMetrics.statusBreakdown[item.status] ?? 0) + 1
      }
    }

    // Today: planned appointments (any status — we count what's on the agenda)
    if (item.datumAfspraak === today) {
      todayPlanned++
    }

    // MTD: appointments held this month
    if (
      item.datumAfspraak &&
      item.datumAfspraak >= monthStart &&
      item.datumAfspraak <= today &&
      STATUS.taken.includes(item.status as typeof STATUS.taken[number])
    ) {
      mtd.taken++
    }

    // MTD deals — by dateDeal
    if (
      item.dateDeal &&
      item.dateDeal >= monthStart &&
      item.dateDeal <= today &&
      STATUS.deals.includes(item.status as typeof STATUS.deals[number])
    ) {
      mtd.deals++
      mtd.revenue += item.dealValue
    }

    // Empty outcomes: past appointment + status still pre-call
    if (
      isInPast(item.datumAfspraak, today) &&
      STATUS.empty.includes(item.status as typeof STATUS.empty[number])
    ) {
      const daysOverdue = Math.round(
        (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${item.datumAfspraak}T00:00:00Z`).getTime()) /
          86_400_000,
      )
      emptyOutcomes.push({ name: item.name, daysOverdue, status: item.status })
    }
  }

  return {
    closer: closerName,
    yesterday: yesterdayMetrics,
    today: { planned: todayPlanned },
    mtd: {
      ...mtd,
      conversion: mtd.taken > 0 ? mtd.deals / mtd.taken : null,
    },
    emptyOutcomes: emptyOutcomes.sort((a, b) => b.daysOverdue - a.daysOverdue),
  }
}

function formatPercent(n: number | null): string {
  if (n === null) return "—"
  return `${Math.round(n * 100)}%`
}

function formatEuro(amount: number): string {
  if (amount >= 1000) return `€${(amount / 1000).toFixed(1)}k`
  return `€${Math.round(amount)}`
}

function statusBreakdownLine(breakdown: Record<string, number>): string {
  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return "geen calls"
  return entries.map(([s, n]) => `${n}× ${s}`).join(" · ")
}

type CloserSalesVars = {
  first_name: string
  closer_name: string
  yesterday_lines: string
  today_lines: string
  mtd_lines: string
  month_label: string
  action_items_section: string
  open_link: string
}

/**
 * Computes variable bag for a closer/setter's personal sales DM.
 */
export function computeCloserSalesVars(opts: {
  metrics: CloserSalesMetrics
  targets: TargetsConfig | null
  yesterday: string
  monthLabel: string
}): CloserSalesVars {
  const { metrics, targets, monthLabel } = opts
  const firstName = metrics.closer.split(" ")[0]

  // Yesterday lines
  const yesterdayLines: string[] = []
  if (metrics.yesterday.taken === 0) {
    yesterdayLines.push("• Geen calls gepland gisteren")
  } else {
    yesterdayLines.push(`• ${metrics.yesterday.taken} call${metrics.yesterday.taken === 1 ? "" : "s"} totaal`)
    yesterdayLines.push(`• ${statusBreakdownLine(metrics.yesterday.statusBreakdown)}`)
  }

  // Today lines
  const todayLines: string[] = []
  if (metrics.today.planned === 0) {
    todayLines.push("• Geen calls gepland 🎉")
  } else {
    todayLines.push(`• ${metrics.today.planned} call${metrics.today.planned === 1 ? "" : "s"} ingepland`)
  }

  // MTD lines
  const dealTarget = targets?.deals ?? 0
  const revenueTarget = targets?.revenue ?? 0
  const mtdLines: string[] = []
  mtdLines.push(`• ${metrics.mtd.taken} taken call${metrics.mtd.taken === 1 ? "" : "s"}`)
  if (dealTarget > 0) mtdLines.push(`• ${metrics.mtd.deals}/${dealTarget} deals`)
  else mtdLines.push(`• ${metrics.mtd.deals} deal${metrics.mtd.deals === 1 ? "" : "s"} closed`)
  if (revenueTarget > 0) mtdLines.push(`• ${formatEuro(metrics.mtd.revenue)} / ${formatEuro(revenueTarget)} revenue`)
  else if (metrics.mtd.revenue > 0) mtdLines.push(`• ${formatEuro(metrics.mtd.revenue)} revenue`)
  if (metrics.mtd.conversion !== null) {
    mtdLines.push(`• Conversion: ${formatPercent(metrics.mtd.conversion)} (target 30%)`)
  }

  // Action items section (header + bullets)
  let action_items_section = ""
  if (metrics.emptyOutcomes.length > 0) {
    const block: string[] = []
    block.push(
      `*Action items — ${metrics.emptyOutcomes.length} empty call outcome${metrics.emptyOutcomes.length === 1 ? "" : "s"}*`,
    )
    for (const item of metrics.emptyOutcomes.slice(0, 6)) {
      const daysLabel = item.daysOverdue === 1 ? "1 dag" : `${item.daysOverdue} dagen`
      block.push(`• ${item.name} — ${daysLabel} terug, status nog "${item.status}"`)
    }
    if (metrics.emptyOutcomes.length > 6) {
      block.push(`…en ${metrics.emptyOutcomes.length - 6} meer`)
    }
    action_items_section = block.join("\n")
  }

  return {
    first_name: firstName,
    closer_name: metrics.closer,
    yesterday_lines: yesterdayLines.join("\n"),
    today_lines: todayLines.join("\n"),
    mtd_lines: mtdLines.join("\n"),
    month_label: monthLabel,
    action_items_section,
    open_link: `<${HUB_URL}/targets|Open Targets>`,
  }
}

export function buildCloserSalesDm(
  opts: Parameters<typeof computeCloserSalesVars>[0],
  template?: string | null,
): string {
  const vars = computeCloserSalesVars(opts)
  return renderTemplate(template ?? DEFAULT_TEMPLATES.personal_sales, vars)
}

type TeamSalesVars = {
  greeting: string
  yesterday_lines: string
  today_lines: string
  mtd_lines: string
  month_label: string
  leaderboard_section: string
  action_items_line: string
  open_link: string
}

/**
 * Channel summary — aggregates metrics across all closers for the team view.
 */
export function computeTeamSalesVars(opts: {
  perCloser: CloserSalesMetrics[]
  targets: TargetsConfig | null
  monthLabel: string
  today: string
}): TeamSalesVars {
  const { perCloser, targets, monthLabel, today } = opts

  const totals = {
    yesterdayTaken: 0,
    yesterdayBreakdown: {} as Record<string, number>,
    todayPlanned: 0,
    mtdTaken: 0,
    mtdDeals: 0,
    mtdRevenue: 0,
    emptyOutcomes: 0,
  }
  for (const m of perCloser) {
    totals.yesterdayTaken += m.yesterday.taken
    for (const [status, n] of Object.entries(m.yesterday.statusBreakdown)) {
      totals.yesterdayBreakdown[status] = (totals.yesterdayBreakdown[status] ?? 0) + n
    }
    totals.todayPlanned += m.today.planned
    totals.mtdTaken += m.mtd.taken
    totals.mtdDeals += m.mtd.deals
    totals.mtdRevenue += m.mtd.revenue
    totals.emptyOutcomes += m.emptyOutcomes.length
  }
  const teamConversion = totals.mtdTaken > 0 ? totals.mtdDeals / totals.mtdTaken : null

  const leaderboard = [...perCloser].sort((a, b) => {
    if (b.mtd.deals !== a.mtd.deals) return b.mtd.deals - a.mtd.deals
    return (b.mtd.conversion ?? 0) - (a.mtd.conversion ?? 0)
  })

  const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay()
  const greetings = [
    "Goedemorgen sales team! ☕",
    "Buenos días team!",
    "Good morning crew!",
    "Hey sales rockets 🚀",
    "Morning amigos!",
  ]
  const dayGreetings: Record<number, string[]> = {
    1: ["Happy Monday team! 🚀"],
    2: ["Happy Tuesday! ☕"],
    3: ["Happy hump day! 🐪"],
    4: ["Happy Thursday! ⚡"],
    5: ["Vrijdag amigos! Almost weekend 🎉"],
  }
  const pool = [...greetings, ...(dayGreetings[dayOfWeek] ?? [])]
  const seed = parseInt(today.replace(/-/g, ""), 10)
  const greeting = pool[seed % pool.length]

  // Yesterday lines
  const yesterdayLines: string[] = []
  if (totals.yesterdayTaken === 0) {
    yesterdayLines.push("• Geen calls")
  } else {
    yesterdayLines.push(`• ${totals.yesterdayTaken} call${totals.yesterdayTaken === 1 ? "" : "s"} totaal`)
    yesterdayLines.push(`• ${statusBreakdownLine(totals.yesterdayBreakdown)}`)
  }

  // Today lines
  const todayLines: string[] = [
    `• ${totals.todayPlanned} call${totals.todayPlanned === 1 ? "" : "s"} ingepland`,
  ]

  // MTD lines
  const dealTarget = targets?.deals ?? 0
  const revenueTarget = targets?.revenue ?? 0
  const mtdLines: string[] = [`• ${totals.mtdTaken} taken calls`]
  if (dealTarget > 0) mtdLines.push(`• ${totals.mtdDeals}/${dealTarget} deals`)
  else mtdLines.push(`• ${totals.mtdDeals} deals`)
  if (revenueTarget > 0) mtdLines.push(`• ${formatEuro(totals.mtdRevenue)} / ${formatEuro(revenueTarget)} revenue`)
  else mtdLines.push(`• ${formatEuro(totals.mtdRevenue)} revenue`)
  if (teamConversion !== null) {
    mtdLines.push(`• Conversion: ${formatPercent(teamConversion)} (target 30%)`)
  }

  // Leaderboard section
  let leaderboard_section = ""
  if (leaderboard.length > 0 && totals.mtdDeals > 0) {
    const block: string[] = ["*Leaderboard — deze maand*"]
    leaderboard.slice(0, 5).forEach((row, idx) => {
      const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : ` ${idx + 1}.`
      const conv = row.mtd.conversion === null ? "—" : formatPercent(row.mtd.conversion)
      block.push(
        `${medal} ${row.closer} — *${row.mtd.deals} deals* · ${formatEuro(row.mtd.revenue)} · ${conv}`,
      )
    })
    leaderboard_section = block.join("\n")
  }

  // Action items line
  let action_items_line = ""
  if (totals.emptyOutcomes > 0) {
    action_items_line = `*Action items*: ${totals.emptyOutcomes} empty call outcome${totals.emptyOutcomes === 1 ? "" : "s"} verspreid over het team — checken in Monday.`
  }

  return {
    greeting,
    yesterday_lines: yesterdayLines.join("\n"),
    today_lines: todayLines.join("\n"),
    mtd_lines: mtdLines.join("\n"),
    month_label: monthLabel,
    leaderboard_section,
    action_items_line,
    open_link: `<${HUB_URL}/targets|Open Targets>`,
  }
}

export function buildTeamSalesSummary(
  opts: Parameters<typeof computeTeamSalesVars>[0],
  template?: string | null,
): string {
  const vars = computeTeamSalesVars(opts)
  return renderTemplate(template ?? DEFAULT_TEMPLATES.team_sales, vars)
}
