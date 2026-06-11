import type { MondayClient } from "@/lib/integrations/monday"
import type { AccountManagerRevenue } from "@/types/targets"
import type { ClientState } from "./watchlist-summary"
import { DEFAULT_TEMPLATES, renderTemplate } from "./notification-config"
import { TEAMS } from "@/lib/teams"

const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL ?? "https://hub.rocketleads.com"

type LiveCategory = "action" | "watch" | "good"
type Buckets = Record<LiveCategory, number>

function isLive(cat: string | null | undefined): cat is LiveCategory {
  return cat === "action" || cat === "watch" || cat === "good"
}

function healthScore(b: Buckets): number | null {
  const total = b.action + b.watch + b.good
  if (total === 0) return null
  return Math.round((b.good / total) * 100)
}

function clientTeam(client: MondayClient): string | null {
  for (const team of TEAMS) {
    if (
      (client.campaignManager && team.members.includes(client.campaignManager)) ||
      (client.accountManager && team.members.includes(client.accountManager))
    ) {
      return team.name
    }
  }
  return null
}

function formatEuroCompact(amount: number): string {
  if (amount >= 1000) return `€${(amount / 1000).toFixed(1)}k`
  return `€${Math.round(amount)}`
}

const DAILY_GREETINGS: string[] = [
  "Goedemorgen amigos! ☕",
  "Buenos días team! 🌞",
  "Good morning crew!",
  "Hallo allemaal!",
  "Bonjour amigos!",
  "Hey team - nieuwe dag, nieuwe kansen 🚀",
  "Wakker worden - ☕ tijd voor Rocket Leads",
  "Goeiedag! Lekker bezig vandaag?",
  "Top of the morning!",
  "Olá amigos! ☀️",
  "Guten Morgen! ☕",
  "Salut team!",
  "Goedemorgen! Even bijpraten 📊",
  "Morning rockets 🚀",
  "Howdy team!",
]

const DAY_OF_WEEK_GREETINGS: Record<number, string[]> = {
  1: [
    "Happy Monday team! Nieuwe week 🚀",
    "Maandag - let's go amigos!",
    "Buenos lunes! Een frisse start ☀️",
  ],
  2: ["Happy Tuesday! ☕", "Lekkere dinsdag amigos"],
  3: ["Happy hump day team 🐪", "Woensdag - halverwege!"],
  4: ["Happy Thursday! ⚡"],
  5: ["Vrijdag amigos! Almost weekend 🎉", "Happy Friday team! ☀️"],
}

function pickGreeting(today: string, dayOfWeekUtc: number): string {
  const pool = [...DAILY_GREETINGS, ...(DAY_OF_WEEK_GREETINGS[dayOfWeekUtc] ?? [])]
  const seed = parseInt(today.replace(/-/g, ""), 10)
  return pool[seed % pool.length]
}

function medal(rank: number): string {
  if (rank === 1) return "🥇"
  if (rank === 2) return "🥈"
  if (rank === 3) return "🥉"
  return ` ${rank}.`
}

type TeamRow = {
  name: string
  buckets: Buckets
  score: number | null
  total: number
}

type TeamRevenue = {
  name: string
  revenue: number
  mrr: number
  newBusiness: number
}

type TeamWatchlistVars = {
  greeting: string
  score_line: string
  bucket_line: string
  healthy_count: number
  watch_count: number
  action_count: number
  cm_ranking_section: string
  revenue_ranking_section: string
  unassigned_section: string
  open_link: string
}

/**
 * Computes the variable bag for the team-wide channel summary. Two rankings:
 *   1. Watch List - campaign-manager teams sorted by health score
 *   2. Revenue - delivery-team revenue MTD sorted by total invoiced
 *
 * Only the two configured TEAMS are tracked - clients managed by anyone
 * outside those names are excluded entirely.
 */
export function computeTeamWatchlistVars(opts: {
  liveClients: MondayClient[]
  states: Map<string, ClientState>
  byAccountManager: AccountManagerRevenue[]
  today: string
  sevenDayAvgScore: number | null
}): TeamWatchlistVars {
  const { liveClients, states, byAccountManager, today, sevenDayAvgScore } = opts

  const totalBuckets: Buckets = { action: 0, watch: 0, good: 0 }
  const yesterdayBuckets: Buckets = { action: 0, watch: 0, good: 0 }
  const perTeam = new Map<string, Buckets>()
  for (const team of TEAMS) perTeam.set(team.name, { action: 0, watch: 0, good: 0 })

  for (const client of liveClients) {
    const teamName = clientTeam(client)
    if (!teamName) continue

    const state = states.get(client.mondayItemId)
    if (!state || !isLive(state.category)) continue

    totalBuckets[state.category]++
    if (state.since_date === today && state.prev_category && isLive(state.prev_category)) {
      yesterdayBuckets[state.prev_category]++
    } else {
      yesterdayBuckets[state.category]++
    }
    perTeam.get(teamName)![state.category]++
  }

  const todayScore = healthScore(totalBuckets)
  const yesterdayScore = healthScore(yesterdayBuckets)
  const dayDelta =
    todayScore !== null && yesterdayScore !== null ? todayScore - yesterdayScore : null

  // Team watchlist rows - sorted by health score desc.
  const teamRows: TeamRow[] = []
  for (const team of TEAMS) {
    const buckets = perTeam.get(team.name)!
    const total = buckets.action + buckets.watch + buckets.good
    teamRows.push({ name: team.name, buckets, score: healthScore(buckets), total })
  }
  teamRows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.total - a.total)

  // Team revenue rows - sum delivery's byAccountManager rows per team.
  const amByName = new Map<string, AccountManagerRevenue>()
  for (const am of byAccountManager) amByName.set(am.name, am)

  const revenueRows: TeamRevenue[] = []
  for (const team of TEAMS) {
    let revenue = 0
    let mrr = 0
    let newBusiness = 0
    for (const member of team.members) {
      const row = amByName.get(member)
      if (!row) continue
      revenue += row.revenue
      mrr += row.mrr
      newBusiness += row.newBusiness
    }
    revenueRows.push({ name: team.name, revenue, mrr, newBusiness })
  }
  revenueRows.sort((a, b) => b.revenue - a.revenue)

  const dayOfWeekUtc = new Date(`${today}T00:00:00Z`).getUTCDay()
  const greeting = pickGreeting(today, dayOfWeekUtc)

  // ── Score line (no bold - template controls bold) ──
  let score_line = ""
  if (todayScore !== null) {
    const scoreParts: string[] = [`Health score: ${todayScore}%`]
    if (dayDelta !== null) {
      if (dayDelta > 0) scoreParts.push(`↑ ${dayDelta}pt vs gisteren`)
      else if (dayDelta < 0) scoreParts.push(`↓ ${Math.abs(dayDelta)}pt vs gisteren`)
      else scoreParts.push("↔ vs gisteren")
    }
    if (sevenDayAvgScore !== null) {
      const avgRounded = Math.round(sevenDayAvgScore)
      const vs = todayScore - sevenDayAvgScore
      const trend =
        vs > 1 ? `↑ vs 7d avg ${avgRounded}%` : vs < -1 ? `↓ vs 7d avg ${avgRounded}%` : `≈ 7d avg ${avgRounded}%`
      scoreParts.push(trend)
    } else {
      scoreParts.push("7d avg building…")
    }
    score_line = scoreParts.join(" · ")
  }

  const bucket_line = `🟢 ${totalBuckets.good} healthy · 🟡 ${totalBuckets.watch} watch · 🔴 ${totalBuckets.action} action`

  // ── CM ranking section ──
  let cm_ranking_section = ""
  if (teamRows.some((r) => r.total > 0)) {
    const block: string[] = ["*Campaign Manager ranking*"]
    teamRows.forEach((row, idx) => {
      const rank = idx + 1
      const scoreStr = row.score === null ? "-" : `${row.score}%`
      block.push(
        `${medal(rank)} ${row.name} - *${scoreStr}* · 🟢 ${row.buckets.good} · 🟡 ${row.buckets.watch} · 🔴 ${row.buckets.action}`,
      )
    })
    cm_ranking_section = block.join("\n")
  }

  // ── Revenue ranking section ──
  let revenue_ranking_section = ""
  if (revenueRows.some((r) => r.revenue > 0)) {
    const block: string[] = ["*Revenue ranking - deze maand*"]
    revenueRows.forEach((row, idx) => {
      const rank = idx + 1
      block.push(
        `${medal(rank)} ${row.name} - *${formatEuroCompact(row.revenue)}* (MRR ${formatEuroCompact(row.mrr)} · new biz ${formatEuroCompact(row.newBusiness)})`,
      )
    })
    revenue_ranking_section = block.join("\n")
  }

  // ── Unassigned section ──
  // Surfaced from delivery's byAccountManager. Renders only when there's actual unassigned
  // revenue so the team can spot leakage and act on it (Stripe customer ↔ Monday item).
  let unassigned_section = ""
  const unassigned = byAccountManager.find((am) => am.name === "Unassigned")
  if (unassigned && unassigned.revenue > 0) {
    const customerLabel = `${unassigned.customers} customer${unassigned.customers === 1 ? "" : "s"}`
    unassigned_section = [
      "*Unassigned revenue*",
      `⚠️ *${formatEuroCompact(unassigned.revenue)}* via ${customerLabel} (MRR ${formatEuroCompact(unassigned.mrr)} · new biz ${formatEuroCompact(unassigned.newBusiness)} · ad ${formatEuroCompact(unassigned.adBudget)})`,
      `<${HUB_URL}/targets|Koppel in Targets → Delivery>`,
    ].join("\n")
  }

  return {
    greeting,
    score_line,
    bucket_line,
    healthy_count: totalBuckets.good,
    watch_count: totalBuckets.watch,
    action_count: totalBuckets.action,
    cm_ranking_section,
    revenue_ranking_section,
    unassigned_section,
    open_link: `<${HUB_URL}/watchlist|Open Watchlist>`,
  }
}

export function buildTeamWatchlistSummary(
  opts: Parameters<typeof computeTeamWatchlistVars>[0],
  template?: string | null,
): string {
  const vars = computeTeamWatchlistVars(opts)
  return renderTemplate(template ?? DEFAULT_TEMPLATES.team_watchlist, vars)
}
