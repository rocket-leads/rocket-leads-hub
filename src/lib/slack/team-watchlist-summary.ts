import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { ClientState } from "./watchlist-summary"

const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL ?? "https://hub.rocketleads.com"
const HEALTH_TARGET = 75

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

/**
 * Day-aware mix-of-languages greetings. Picked deterministically by date so
 * cron retries within the same day stay consistent. Day-of-week specific
 * messages are weighted in for Mondays/Fridays so the room reads the rhythm
 * of the week.
 */
const DAILY_GREETINGS: string[] = [
  "Goedemorgen amigos! ☕",
  "Buenos días team! 🌞",
  "Good morning crew!",
  "Hallo allemaal!",
  "Bonjour amigos!",
  "Hey team — nieuwe dag, nieuwe kansen 🚀",
  "Wakker worden — ☕ tijd voor Rocket Leads",
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
    "Maandag — let's go amigos!",
    "Buenos lunes! Een frisse start ☀️",
  ],
  2: ["Happy Tuesday! ☕", "Lekkere dinsdag amigos"],
  3: ["Happy hump day team 🐪", "Woensdag — halverwege!"],
  4: ["Happy Thursday! ⚡"],
  5: ["Vrijdag amigos! Almost weekend 🎉", "Happy Friday team! ☀️"],
}

function pickGreeting(today: string, dayOfWeekUtc: number): string {
  const pool = [...DAILY_GREETINGS, ...(DAY_OF_WEEK_GREETINGS[dayOfWeekUtc] ?? [])]
  // Deterministic by date: same hash → same greeting all day.
  const seed = parseInt(today.replace(/-/g, ""), 10)
  return pool[seed % pool.length]
}

type CmRow = {
  cm: string
  buckets: Buckets
  score: number | null
  total: number
}

function ordinal(n: number): string {
  if (n === 1) return "1st"
  if (n === 2) return "2nd"
  if (n === 3) return "3rd"
  return `${n}th`
}

function medal(rank: number): string {
  if (rank === 1) return "🥇"
  if (rank === 2) return "🥈"
  if (rank === 3) return "🥉"
  return ` ${ordinal(rank)} `
}

/**
 * Builds the team-wide channel summary. Same top section as the personal DM
 * (greeting + health score + bucket counts) so the framing is consistent,
 * then a CM leaderboard and a few team-level observations.
 */
export function buildTeamWatchlistSummary(opts: {
  liveClients: MondayClient[]
  states: Map<string, ClientState>
  today: string
  sevenDayAvgScore: number | null
}): string {
  const { liveClients, states, today, sevenDayAvgScore } = opts

  const totalBuckets: Buckets = { action: 0, watch: 0, good: 0 }
  const yesterdayBuckets: Buckets = { action: 0, watch: 0, good: 0 }
  const perCm = new Map<string, Buckets>()

  for (const client of liveClients) {
    const state = states.get(client.mondayItemId)
    if (!state || !isLive(state.category)) continue

    totalBuckets[state.category]++

    // Yesterday reconstruction — invert today's transitions only
    if (state.since_date === today && state.prev_category && isLive(state.prev_category)) {
      yesterdayBuckets[state.prev_category]++
    } else {
      yesterdayBuckets[state.category]++
    }

    const cm = client.campaignManager?.trim() || "Unassigned"
    if (!perCm.has(cm)) perCm.set(cm, { action: 0, watch: 0, good: 0 })
    perCm.get(cm)![state.category]++
  }

  const todayScore = healthScore(totalBuckets)
  const yesterdayScore = healthScore(yesterdayBuckets)
  const dayDelta =
    todayScore !== null && yesterdayScore !== null ? todayScore - yesterdayScore : null

  // Build CM rows, sorted by health score desc. Skip CMs with no live clients.
  const cmRows: CmRow[] = []
  for (const [cm, buckets] of perCm.entries()) {
    const total = buckets.action + buckets.watch + buckets.good
    if (total === 0) continue
    cmRows.push({ cm, buckets, score: healthScore(buckets), total })
  }
  // Stable sort: by score desc, then by deal-with-most-clients first as tiebreaker.
  cmRows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.total - a.total)

  const dayOfWeekUtc = new Date(`${today}T00:00:00Z`).getUTCDay()
  const greeting = pickGreeting(today, dayOfWeekUtc)

  const lines: string[] = []
  lines.push(greeting)
  lines.push("")

  // ── Team score line + bucket counts ──
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
    lines.push(`*${scoreParts.join(" · ")}*`)
  }
  lines.push(
    `🟢 ${totalBuckets.good} healthy · 🟡 ${totalBuckets.watch} watch · 🔴 ${totalBuckets.action} action`,
  )
  lines.push("")

  // ── Campaign Manager leaderboard ──
  if (cmRows.length > 0) {
    lines.push("*🏆 Campaign Manager ranking*")
    cmRows.forEach((row, idx) => {
      const rank = idx + 1
      const scoreStr = row.score === null ? "—" : `${row.score}%`
      const isUnassigned = row.cm === "Unassigned"
      const cmLabel = isUnassigned ? "_Unassigned_" : row.cm
      lines.push(
        `${medal(rank)} ${cmLabel} — *${scoreStr}* · 🟢 ${row.buckets.good} · 🟡 ${row.buckets.watch} · 🔴 ${row.buckets.action}`,
      )
    })
    lines.push("")
  }

  // ── Team pulse — short observations ──
  const observations: string[] = []
  const cmsAtTarget = cmRows.filter((r) => r.score !== null && r.score >= HEALTH_TARGET)
  const cmsBelowTarget = cmRows.filter((r) => r.score !== null && r.score < HEALTH_TARGET)
  const cmAvg =
    cmRows.length > 0
      ? Math.round(cmRows.reduce((s, r) => s + (r.score ?? 0), 0) / cmRows.length)
      : null
  const topCm = cmRows[0]
  const lowestCm = cmRows[cmRows.length - 1]

  if (cmsAtTarget.length > 0 && cmRows.length > 1) {
    observations.push(
      `${cmsAtTarget.length} van ${cmRows.length} CMs zit op of boven het ${HEALTH_TARGET}% target`,
    )
  }
  if (cmsBelowTarget.length >= 2) {
    observations.push(`${cmsBelowTarget.length} CMs onder target — focus op Action items deze week`)
  }
  if (topCm && cmAvg !== null && topCm.score !== null && topCm.score - cmAvg >= 10) {
    observations.push(
      `${topCm.cm} leidt met ${topCm.score}% (${topCm.score - cmAvg}pt boven team-gemiddelde van ${cmAvg}%)`,
    )
  }
  if (
    lowestCm &&
    lowestCm.cm !== topCm?.cm &&
    lowestCm.buckets.action >= 3 &&
    !lowestCm.cm.includes("Unassigned")
  ) {
    observations.push(`${lowestCm.cm} heeft ${lowestCm.buckets.action} clients in Action — extra aandacht`)
  }
  if (totalBuckets.action === 0) {
    observations.push("Geen enkele klant in Action vandaag — top performance team 🚀")
  }
  if (dayDelta !== null && dayDelta >= 5) {
    observations.push(`Team score sprong ${dayDelta}pt omhoog vs gisteren — lekker bezig`)
  } else if (dayDelta !== null && dayDelta <= -5) {
    observations.push(`Team score zakte ${Math.abs(dayDelta)}pt vs gisteren — tijd voor stand-up?`)
  }

  if (observations.length > 0) {
    lines.push("*Team pulse*")
    for (const o of observations.slice(0, 4)) lines.push(`• ${o}`)
    lines.push("")
  }

  lines.push(`<${HUB_URL}/watchlist|Open Watchlist>`)

  return lines.join("\n")
}
