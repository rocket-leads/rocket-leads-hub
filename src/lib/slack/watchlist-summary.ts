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
 * Health score as a percentage — same formula as the watchlist dashboard.
 * good / (action + watch + good) × 100. Returns null when no live clients
 * (no signal, no point pretending it's "100%").
 */
function healthScore(b: Buckets): number | null {
  const total = b.action + b.watch + b.good
  if (total === 0) return null
  return Math.round((b.good / total) * 100)
}

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

  const todayScore = healthScore(todayBuckets)
  const yesterdayScore = healthScore(yesterdayBuckets)
  const dayDelta =
    todayScore !== null && yesterdayScore !== null ? todayScore - yesterdayScore : null

  const todayDeteriorations = todayTransitions.filter((t) => SEVERITY[t.to] > SEVERITY[t.from])
  const todayImprovements = todayTransitions.filter((t) => SEVERITY[t.to] < SEVERITY[t.from])

  const lines: string[] = []

  // ── Greeting ── tone-aware based on delta + concerns mix.
  let greeting: string
  if (todayTransitions.length === 0 && milestones.length === 0 && dayDelta === 0) {
    greeting = "🌅 Goedemorgen. Niets veranderd sinds gisteren — alles stabiel."
  } else if (dayDelta !== null && dayDelta > 0 && todayDeteriorations.length === 0) {
    greeting = "🌅 Goedemorgen. Score omhoog vs gisteren — lekker bezig 🚀"
  } else if ((dayDelta !== null && dayDelta < 0) || todayDeteriorations.length > todayImprovements.length) {
    greeting = "🌅 Goedemorgen. Score onder druk — even letten op:"
  } else {
    greeting = "🌅 Goedemorgen. Een paar bewegingen overnight."
  }
  lines.push(greeting)
  lines.push("")

  // ── Score line + bucket counts ── matches the watchlist dashboard.
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
      const trend = vs > 1 ? `↑ vs 7d avg ${avgRounded}%` : vs < -1 ? `↓ vs 7d avg ${avgRounded}%` : `≈ 7d avg ${avgRounded}%`
      scoreParts.push(trend)
    } else {
      scoreParts.push("7d avg building…")
    }
    lines.push(scoreParts.join(" · "))
  }
  lines.push(
    `🟢 ${todayBuckets.good} healthy · 🟡 ${todayBuckets.watch} watch · 🔴 ${todayBuckets.action} action`,
  )
  lines.push("")

  // ── New concerns today ──
  if (todayDeteriorations.length > 0) {
    lines.push(`${todayDeteriorations.length} nieuwe ${todayDeteriorations.length === 1 ? "concern" : "concerns"} vandaag`)
    for (const t of todayDeteriorations.slice(0, 5)) {
      lines.push(`• ${t.name} → ${categoryLabel(t.to)} (was ${categoryLabel(t.from)}) — ${t.insight}`)
    }
    if (todayDeteriorations.length > 5) lines.push(`…en ${todayDeteriorations.length - 5} meer`)
    lines.push("")
  }

  // ── Persistence milestones (day 3 + day 7) ──
  const day3 = milestones.filter((m) => m.days === 3)
  const day7 = milestones.filter((m) => m.days === 7)
  if (day3.length > 0 || day7.length > 0) {
    lines.push("Persistent concerns")
    for (const m of day7.slice(0, 5)) {
      // Day 7 = escalation, bolded
      lines.push(`• *${m.name} — 7 dagen in ${categoryLabel(m.bucket)}* — ${m.insight}`)
    }
    for (const m of day3.slice(0, 5)) {
      lines.push(`• ${m.name} — 3 dagen in ${categoryLabel(m.bucket)} — ${m.insight}`)
    }
    const totalShown = Math.min(day7.length, 5) + Math.min(day3.length, 5)
    const totalAll = day3.length + day7.length
    if (totalAll > totalShown) lines.push(`…en ${totalAll - totalShown} meer`)
    lines.push("")
  }

  // ── Wins today ──
  if (todayImprovements.length > 0) {
    lines.push(`${todayImprovements.length} ${todayImprovements.length === 1 ? "win" : "wins"} vandaag`)
    for (const t of todayImprovements.slice(0, 5)) {
      lines.push(`• ${t.name} → ${categoryLabel(t.to)} (was ${categoryLabel(t.from)}) — ${t.insight}`)
    }
    if (todayImprovements.length > 5) lines.push(`…en ${todayImprovements.length - 5} meer`)
    lines.push("")
  }

  lines.push(`<${HUB_URL}/watchlist|Open Watchlist>`)

  return lines.join("\n")
}

/**
 * Compute a 7-day rolling average health-score percentage from the
 * watchlist_score_history cache. Each daily snapshot contributes its own
 * good / total ratio; we average those ratios. Same semantics as the
 * dashboard's "vs 7d avg" KPI card.
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
      const total = buckets.action + buckets.watch + buckets.good
      if (total > 0) scores.push((buckets.good / total) * 100)
    }
  }
  if (scores.length === 0) return null
  return scores.reduce((s, v) => s + v, 0) / scores.length
}
