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
    /** Total calls "in scope" yesterday — resolved + empty. Drives the "X calls totaal" line. */
    taken: number
    /** Status counts for *resolved* outcomes only (No show / No deal / DEAL). Empty stays out. */
    statusBreakdown: Record<string, number>
    /** How many of yesterday's calls are still on Qualified / Gepland. */
    empty: number
  }
  today: {
    planned: number
  }
  mtd: {
    /** Booked calls = appointments in MTD where status is taken / no-show / empty. */
    booked: number
    /** Taken calls = booked calls that resulted in an actual call (excludes no-show + empty). */
    taken: number
    /** Show-up rate = taken / booked. Null when nothing is booked yet. */
    showRate: number | null
    deals: number
    revenue: number
    conversion: number | null
  }
  /** Past appointments still on a pre-call status — backlog the closer should log. */
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
  const yesterdayMetrics = { taken: 0, statusBreakdown: {} as Record<string, number>, empty: 0 }
  let todayPlanned = 0
  const mtd = { booked: 0, taken: 0, deals: 0, revenue: 0 }
  const emptyOutcomes: Array<{ name: string; daysOverdue: number; status: string }> = []

  const isTaken = (s: string) => STATUS.taken.includes(s as typeof STATUS.taken[number])
  const isNoShow = (s: string) => STATUS.noShow.includes(s as typeof STATUS.noShow[number])
  const isEmpty = (s: string) => STATUS.empty.includes(s as typeof STATUS.empty[number])

  for (const item of items) {
    if (item.closer !== closerName) continue

    // Yesterday: appointments held yesterday — split resolved status counts from empty
    // so the channel can show "Nx empty call outcomes" as its own line.
    if (item.datumAfspraak === yesterday) {
      if (isTaken(item.status) || isNoShow(item.status)) {
        yesterdayMetrics.taken++
        yesterdayMetrics.statusBreakdown[item.status] =
          (yesterdayMetrics.statusBreakdown[item.status] ?? 0) + 1
      } else if (isEmpty(item.status)) {
        yesterdayMetrics.taken++ // total still counts the empty rows
        yesterdayMetrics.empty++
      }
    }

    // Today: planned appointments (any status — we count what's on the agenda)
    if (item.datumAfspraak === today) {
      todayPlanned++
    }

    // MTD: appointments dated within the month and at-or-before today, where the
    // status is anything that was actually booked (taken / no-show / empty).
    if (
      item.datumAfspraak &&
      item.datumAfspraak >= monthStart &&
      item.datumAfspraak <= today &&
      (isTaken(item.status) || isNoShow(item.status) || isEmpty(item.status))
    ) {
      mtd.booked++
      if (isTaken(item.status)) mtd.taken++
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

    // Empty outcomes: any past appointment still pre-call. Surfaced as a backlog
    // — the closer should log every call eventually, this list is the to-do.
    if (
      isInPast(item.datumAfspraak, today) &&
      isEmpty(item.status)
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
      showRate: mtd.booked > 0 ? mtd.taken / mtd.booked : null,
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

  // Yesterday lines — total, then resolved status breakdown, then empty count as own row.
  const yesterdayLines: string[] = []
  if (metrics.yesterday.taken === 0) {
    yesterdayLines.push("• Geen calls gepland gisteren")
  } else {
    yesterdayLines.push(`• ${metrics.yesterday.taken} call${metrics.yesterday.taken === 1 ? "" : "s"} totaal`)
    if (Object.keys(metrics.yesterday.statusBreakdown).length > 0) {
      yesterdayLines.push(`• ${statusBreakdownLine(metrics.yesterday.statusBreakdown)}`)
    }
    if (metrics.yesterday.empty > 0) {
      yesterdayLines.push(`• ${metrics.yesterday.empty}× empty call outcomes`)
    }
  }

  // Today lines
  const todayLines: string[] = []
  if (metrics.today.planned === 0) {
    todayLines.push("• Geen calls gepland 🎉")
  } else {
    todayLines.push(`• ${metrics.today.planned} call${metrics.today.planned === 1 ? "" : "s"} ingepland`)
  }

  // MTD lines — order: booked → taken → show-up → deals → revenue → conversion.
  const dealTarget = targets?.deals ?? 0
  const revenueTarget = targets?.revenue ?? 0
  const mtdLines: string[] = []
  mtdLines.push(`• ${metrics.mtd.booked} booked call${metrics.mtd.booked === 1 ? "" : "s"}`)
  mtdLines.push(`• ${metrics.mtd.taken} taken call${metrics.mtd.taken === 1 ? "" : "s"}`)
  if (metrics.mtd.showRate !== null) {
    mtdLines.push(`• Show-up: ${formatPercent(metrics.mtd.showRate)} (target 80%)`)
  }
  if (dealTarget > 0) mtdLines.push(`• ${metrics.mtd.deals}/${dealTarget} deals`)
  else mtdLines.push(`• ${metrics.mtd.deals} deal${metrics.mtd.deals === 1 ? "" : "s"} closed`)
  if (revenueTarget > 0) mtdLines.push(`• ${formatEuro(metrics.mtd.revenue)} / ${formatEuro(revenueTarget)} revenue`)
  else if (metrics.mtd.revenue > 0) mtdLines.push(`• ${formatEuro(metrics.mtd.revenue)} revenue`)
  if (metrics.mtd.conversion !== null) {
    mtdLines.push(`• Conversion: ${formatPercent(metrics.mtd.conversion)} (target 30%)`)
  }

  // Action items section — past appointments still on a pre-call status (backlog).
  let action_items_section = ""
  if (metrics.emptyOutcomes.length > 0) {
    const n = metrics.emptyOutcomes.length
    const block: string[] = [
      `*Action items — ${n} empty call outcome${n === 1 ? "" : "s"}*`,
    ]
    for (const item of metrics.emptyOutcomes.slice(0, 6)) {
      const daysLabel = item.daysOverdue === 1 ? "1 dag" : `${item.daysOverdue} dagen`
      block.push(`• ${item.name} — ${daysLabel} terug, status nog "${item.status}"`)
    }
    if (n > 6) {
      block.push(`…en ${n - 6} meer`)
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
    yesterdayEmpty: 0,
    todayPlanned: 0,
    mtdBooked: 0,
    mtdTaken: 0,
    mtdDeals: 0,
    mtdRevenue: 0,
    emptyOutcomes: 0,
  }
  for (const m of perCloser) {
    totals.yesterdayTaken += m.yesterday.taken
    totals.yesterdayEmpty += m.yesterday.empty
    for (const [status, n] of Object.entries(m.yesterday.statusBreakdown)) {
      totals.yesterdayBreakdown[status] = (totals.yesterdayBreakdown[status] ?? 0) + n
    }
    totals.todayPlanned += m.today.planned
    totals.mtdBooked += m.mtd.booked
    totals.mtdTaken += m.mtd.taken
    totals.mtdDeals += m.mtd.deals
    totals.mtdRevenue += m.mtd.revenue
    totals.emptyOutcomes += m.emptyOutcomes.length
  }
  const teamConversion = totals.mtdTaken > 0 ? totals.mtdDeals / totals.mtdTaken : null
  const teamShowRate = totals.mtdBooked > 0 ? totals.mtdTaken / totals.mtdBooked : null

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

  // Per-closer breakdowns for yesterday / today — surfaces *who* the calls belong
  // to so the channel can read accountability at a glance.
  const firstName = (full: string) => full.split(" ")[0]
  const formatPerCloser = (rows: Array<{ closer: string; n: number }>): string =>
    rows
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n)
      .map((r) => `${firstName(r.closer)} ${r.n}`)
      .join(" · ")

  const yesterdayPerCloser = formatPerCloser(
    perCloser.map((m) => ({ closer: m.closer, n: m.yesterday.taken })),
  )
  const todayPerCloser = formatPerCloser(
    perCloser.map((m) => ({ closer: m.closer, n: m.today.planned })),
  )
  const emptyPerCloser = formatPerCloser(
    perCloser.map((m) => ({ closer: m.closer, n: m.emptyOutcomes.length })),
  )

  // Yesterday lines — total (with per-closer split), resolved status breakdown,
  // then empty-call-outcomes count as its own row so it stands out.
  const yesterdayLines: string[] = []
  if (totals.yesterdayTaken === 0) {
    yesterdayLines.push("• Geen calls")
  } else {
    const suffix = yesterdayPerCloser ? ` — ${yesterdayPerCloser}` : ""
    yesterdayLines.push(`• ${totals.yesterdayTaken} call${totals.yesterdayTaken === 1 ? "" : "s"} totaal${suffix}`)
    if (Object.keys(totals.yesterdayBreakdown).length > 0) {
      yesterdayLines.push(`• ${statusBreakdownLine(totals.yesterdayBreakdown)}`)
    }
    if (totals.yesterdayEmpty > 0) {
      yesterdayLines.push(`• ${totals.yesterdayEmpty}× empty call outcomes`)
    }
  }

  // Today lines
  const todaySuffix = todayPerCloser ? ` — ${todayPerCloser}` : ""
  const todayLines: string[] = [
    `• ${totals.todayPlanned} call${totals.todayPlanned === 1 ? "" : "s"} ingepland${todaySuffix}`,
  ]

  // MTD lines — booked → taken → show-up → deals → revenue → conversion.
  const dealTarget = targets?.deals ?? 0
  const revenueTarget = targets?.revenue ?? 0
  const mtdLines: string[] = []
  mtdLines.push(`• ${totals.mtdBooked} booked call${totals.mtdBooked === 1 ? "" : "s"}`)
  mtdLines.push(`• ${totals.mtdTaken} taken call${totals.mtdTaken === 1 ? "" : "s"}`)
  if (teamShowRate !== null) {
    mtdLines.push(`• Show-up: ${formatPercent(teamShowRate)} (target 80%)`)
  }
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

  // Action items line — per-closer breakdown of empty call outcomes so the channel
  // sees exactly who needs to update what (was: a single team-wide total).
  let action_items_line = ""
  if (totals.emptyOutcomes > 0) {
    action_items_line = `*Action items — empty call outcomes*: ${emptyPerCloser} — checken in Monday`
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
