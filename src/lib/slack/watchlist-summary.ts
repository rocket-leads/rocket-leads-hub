import { categorize } from "@/lib/watchlist/categorize"
import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"

const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL ?? "https://hub.rocketleads.com"

export type ClientState = {
  category: "action" | "watch" | "good" | "no-data"
  prev_category: "action" | "watch" | "good" | "no-data" | null
  since_date: string // YYYY-MM-DD
}

type LiveCategory = "action" | "watch" | "good"

const SEVERITY: Record<LiveCategory, number> = { good: 0, watch: 1, action: 2 }
// Higher score = healthier portfolio.
const SCORE_WEIGHT: Record<LiveCategory, number> = { action: -3, watch: -1, good: 1 }

function categoryLabel(cat: LiveCategory): string {
  return cat === "action" ? "Action" : cat === "watch" ? "Watch" : "Healthy"
}

function isLive(cat: string | null | undefined): cat is LiveCategory {
  return cat === "action" || cat === "watch" || cat === "good"
}

function daysBetween(fromYmd: string, toYmd: string): number {
  // Assumes both inputs are YYYY-MM-DD; date arithmetic in UTC to avoid DST drift.
  const a = Date.UTC(+fromYmd.slice(0, 4), +fromYmd.slice(5, 7) - 1, +fromYmd.slice(8, 10))
  const b = Date.UTC(+toYmd.slice(0, 4), +toYmd.slice(5, 7) - 1, +toYmd.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

/** Bucket counts for { action, watch, good }. */
type Buckets = Record<LiveCategory, number>

/**
 * Daily Slack summary that focuses on changes — what moved between buckets
 * since yesterday — plus a daily score comparison and persistence milestones
 * (day 3 / day 7 in Action or Watch).
 *
 * Mute logic: a transition surfaces only on day 0. To prevent repeating the
 * same notification day after day, persistent stays in Action/Watch resurface
 * exactly on day 3 (warning) and day 7 (escalation, bolded). Days 1-2, 4-6,
 * and 8+ are silent.
 */
export function buildWatchlistDailySummary(opts: {
  visibleClients: MondayClient[]
  kpiMap: Record<string, KpiSummary>
  states: Map<string, ClientState>
  today: string // YYYY-MM-DD
  /** 7-day rolling average score (computed by caller from score_history). null if unavailable. */
  sevenDayAvgScore: number | null
}): string {
  const { visibleClients, kpiMap, states, today, sevenDayAvgScore } = opts

  type Transition = {
    name: string
    from: LiveCategory
    to: LiveCategory
    insight: string
  }
  type Milestone = {
    name: string
    bucket: LiveCategory
    days: 3 | 7
    insight: string
  }

  const todayTransitions: Transition[] = []
  const milestones: Milestone[] = []
  const todayBuckets: Buckets = { action: 0, watch: 0, good: 0 }
  const yesterdayBuckets: Buckets = { action: 0, watch: 0, good: 0 }

  for (const client of visibleClients) {
    const state = states.get(client.mondayItemId)
    if (!state || !isLive(state.category)) continue // Skip no-data

    todayBuckets[state.category]++

    const transitionedToday = state.since_date === today && state.prev_category !== null
    if (transitionedToday && isLive(state.prev_category)) {
      yesterdayBuckets[state.prev_category]++
      const kpi = kpiMap[client.mondayItemId]
      const { insight } = categorize(client, kpi)
      todayTransitions.push({
        name: client.name,
        from: state.prev_category,
        to: state.category,
        insight,
      })
    } else {
      yesterdayBuckets[state.category]++
    }

    // Persistence milestone: show clients that have been in Action or Watch
    // for exactly 3 or 7 days. Only for concerns (Action / Watch) — wins are
    // celebrated once, no re-mention needed.
    if (!transitionedToday && (state.category === "action" || state.category === "watch")) {
      const daysIn = daysBetween(state.since_date, today)
      if (daysIn === 3 || daysIn === 7) {
        const kpi = kpiMap[client.mondayItemId]
        const { insight } = categorize(client, kpi)
        milestones.push({ name: client.name, bucket: state.category, days: daysIn, insight })
      }
    }
  }

  const score = (b: Buckets) =>
    b.good * SCORE_WEIGHT.good + b.watch * SCORE_WEIGHT.watch + b.action * SCORE_WEIGHT.action
  const todayScore = score(todayBuckets)
  const yesterdayScore = score(yesterdayBuckets)
  const dayDelta = todayScore - yesterdayScore

  const todayDeteriorations = todayTransitions.filter((t) => SEVERITY[t.to] > SEVERITY[t.from])
  const todayImprovements = todayTransitions.filter((t) => SEVERITY[t.to] < SEVERITY[t.from])

  const lines: string[] = []

  // ── Greeting ── chosen to feel motivational without being saccharine. Driven
  // by score delta + 7-day average so quiet days still have a personality.
  let greeting: string
  if (todayTransitions.length === 0 && milestones.length === 0 && dayDelta === 0) {
    greeting = "Goedemorgen. Niets veranderd sinds gisteren — alles stabiel."
  } else if (dayDelta > 0 && todayDeteriorations.length === 0) {
    greeting = "Goedemorgen. Score boven gisteren — lekker bezig 🚀"
  } else if (dayDelta < 0 || todayDeteriorations.length > todayImprovements.length) {
    greeting = "Goedemorgen. Score onder gisteren — even letten op:"
  } else {
    greeting = "Goedemorgen. Een paar bewegingen overnight."
  }
  lines.push(greeting)
  lines.push("")

  // ── Score line ──
  const scoreParts: string[] = [`Score: *${todayScore}*`]
  if (dayDelta > 0) scoreParts.push(`↑ ${dayDelta} vs gisteren`)
  else if (dayDelta < 0) scoreParts.push(`↓ ${Math.abs(dayDelta)} vs gisteren`)
  else scoreParts.push("↔ vs gisteren")
  if (sevenDayAvgScore !== null) {
    const avgRounded = Math.round(sevenDayAvgScore * 10) / 10
    const vs = todayScore - sevenDayAvgScore
    const trend = vs > 0.5 ? `↑ vs 7d avg ${avgRounded}` : vs < -0.5 ? `↓ vs 7d avg ${avgRounded}` : `≈ 7d avg ${avgRounded}`
    scoreParts.push(trend)
  }
  lines.push(scoreParts.join(" · "))
  lines.push("")

  // ── New concerns today ──
  if (todayDeteriorations.length > 0) {
    lines.push(`*${todayDeteriorations.length} nieuwe ${todayDeteriorations.length === 1 ? "concern" : "concerns"} vandaag*`)
    for (const t of todayDeteriorations.slice(0, 5)) {
      lines.push(`• *${t.name}* → ${categoryLabel(t.to)} (was ${categoryLabel(t.from)}) — ${t.insight}`)
    }
    if (todayDeteriorations.length > 5) lines.push(`_…en ${todayDeteriorations.length - 5} meer_`)
    lines.push("")
  }

  // ── Persistence milestones (day 3 + day 7) ──
  const day3 = milestones.filter((m) => m.days === 3)
  const day7 = milestones.filter((m) => m.days === 7)
  if (day3.length > 0 || day7.length > 0) {
    lines.push("*Persistent concerns*")
    for (const m of day7.slice(0, 5)) {
      // Day 7 = escalation, bolded
      lines.push(`• *${m.name}* — *7 dagen* in ${categoryLabel(m.bucket)} — ${m.insight}`)
    }
    for (const m of day3.slice(0, 5)) {
      lines.push(`• ${m.name} — 3 dagen in ${categoryLabel(m.bucket)} — ${m.insight}`)
    }
    const totalShown = Math.min(day7.length, 5) + Math.min(day3.length, 5)
    const totalAll = day3.length + day7.length
    if (totalAll > totalShown) lines.push(`_…en ${totalAll - totalShown} meer_`)
    lines.push("")
  }

  // ── Wins today ──
  if (todayImprovements.length > 0) {
    lines.push(`*${todayImprovements.length} ${todayImprovements.length === 1 ? "win" : "wins"} vandaag*`)
    for (const t of todayImprovements.slice(0, 5)) {
      lines.push(`• *${t.name}* → ${categoryLabel(t.to)} (was ${categoryLabel(t.from)}) — ${t.insight}`)
    }
    if (todayImprovements.length > 5) lines.push(`_…en ${todayImprovements.length - 5} meer_`)
    lines.push("")
  }

  // ── Now line + link ──
  lines.push(`Now: ${todayBuckets.good} healthy · ${todayBuckets.watch} watch · ${todayBuckets.action} action`)
  lines.push(`<${HUB_URL}/watchlist|→ Open watchlist>`)

  return lines.join("\n")
}

/**
 * Compute a 7-day rolling average score from the watchlist_score_history cache.
 * Pass the snapshot map keyed by date (YYYY-MM-DD), pre-filtered to the user's
 * relevant slice (e.g. their CM bucket totals or `_all` for admins).
 */
export function computeSevenDayAvgScore(
  history: Record<string, { action: number; watch: number; good: number }>,
  todayYmd: string,
): number | null {
  const cutoff = new Date(`${todayYmd}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - 7)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const scores: number[] = []
  for (const [date, buckets] of Object.entries(history)) {
    if (date >= cutoffStr && date < todayYmd) {
      scores.push(
        buckets.good * SCORE_WEIGHT.good +
          buckets.watch * SCORE_WEIGHT.watch +
          buckets.action * SCORE_WEIGHT.action,
      )
    }
  }
  if (scores.length === 0) return null
  return scores.reduce((s, v) => s + v, 0) / scores.length
}
