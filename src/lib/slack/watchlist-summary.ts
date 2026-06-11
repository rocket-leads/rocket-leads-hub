import { categorize } from "@/lib/watchlist/categorize"
import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import { DEFAULT_TEMPLATES, renderTemplate } from "./notification-config"

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
 * Health score as a percentage - same formula as the watchlist dashboard.
 * good / (action + watch + good) × 100. Returns null when no live clients
 * (no signal, no point pretending it's "100%").
 */
function healthScore(b: Buckets): number | null {
  const total = b.action + b.watch + b.good
  if (total === 0) return null
  return Math.round((b.good / total) * 100)
}

type WatchlistVars = {
  greeting: string
  score_line: string
  bucket_line: string
  healthy_count: number
  watch_count: number
  action_count: number
  concerns_section: string
  wins_section: string
  persistent_section: string
  open_link: string
}

/**
 * Computes the variable bag for the personal watchlist DM. Pure function -
 * the cron route then renders it against the user-configured (or default)
 * template.
 *
 * Mute logic: a transition surfaces only on day 0. To prevent repeating the
 * same notification day after day, persistent stays in Action/Watch resurface
 * exactly on day 3 (warning) and day 7 (escalation, bolded). Days 1-2, 4-6,
 * and 8+ are silent.
 */
export function computeWatchlistVars(opts: {
  visibleClients: MondayClient[]
  kpiMap: Record<string, KpiSummary>
  states: Map<string, ClientState>
  today: string // YYYY-MM-DD
  /** 7-day rolling average score (computed by caller from score_history). null if unavailable. */
  sevenDayAvgScore: number | null
}): WatchlistVars {
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

  // ── Greeting (tone-aware) ──
  let greeting: string
  if (todayTransitions.length === 0 && milestones.length === 0 && dayDelta === 0) {
    greeting = "🌅 Goedemorgen. Niets veranderd sinds gisteren - alles stabiel."
  } else if (dayDelta !== null && dayDelta > 0 && todayDeteriorations.length === 0) {
    greeting = "🌅 Goedemorgen. Score omhoog vs gisteren - lekker bezig 🚀"
  } else if ((dayDelta !== null && dayDelta < 0) || todayDeteriorations.length > todayImprovements.length) {
    greeting = "🌅 Goedemorgen. Score onder druk - even letten op:"
  } else {
    greeting = "🌅 Goedemorgen. Een paar bewegingen overnight."
  }

  // ── Score line (no surrounding bold - template controls bold) ──
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
      const trend = vs > 1 ? `↑ vs 7d avg ${avgRounded}%` : vs < -1 ? `↓ vs 7d avg ${avgRounded}%` : `≈ 7d avg ${avgRounded}%`
      scoreParts.push(trend)
    } else {
      scoreParts.push("7d avg building…")
    }
    score_line = scoreParts.join(" · ")
  }

  const bucket_line = `🟢 ${todayBuckets.good} healthy · 🟡 ${todayBuckets.watch} watch · 🔴 ${todayBuckets.action} action`

  // ── Concerns section ──
  // Only Action transitions get bullet lines - Watch is too noisy for a daily DM
  // (10% CPL/CPA fluctuation crosses Watch easily). Watch deteriorations roll up
  // into a single italic summary so the count is still visible without dominating
  // the message. Persistent Watch issues resurface via the day-3 / day-7 milestones.
  const actionDeteriorations = todayDeteriorations.filter((t) => t.to === "action")
  const watchDeteriorations = todayDeteriorations.filter((t) => t.to === "watch")

  const INLINE_CAP = 3

  let concerns_section = ""
  if (actionDeteriorations.length > 0) {
    const block: string[] = []
    block.push(
      `*:warning: ${actionDeteriorations.length} nieuwe ${actionDeteriorations.length === 1 ? "concern" : "concerns"} vandaag*`,
    )
    for (const t of actionDeteriorations.slice(0, INLINE_CAP)) {
      block.push(`• ${t.name} → ${categoryLabel(t.to)} (was ${categoryLabel(t.from)}) - ${t.insight}`)
    }
    if (actionDeteriorations.length > INLINE_CAP) {
      block.push(`…en ${actionDeteriorations.length - INLINE_CAP} meer`)
    }
    if (watchDeteriorations.length > 0) {
      block.push(`_+ ${watchDeteriorations.length} naar Watch - zie dashboard_`)
    }
    concerns_section = block.join("\n")
  } else if (watchDeteriorations.length > 0) {
    // No fires today - just a quiet note about clients slipping toward Watch.
    concerns_section = `_${watchDeteriorations.length} naar Watch - zie dashboard_`
  }

  // ── Persistent section ──
  let persistent_section = ""
  const day3 = milestones.filter((m) => m.days === 3)
  const day7 = milestones.filter((m) => m.days === 7)
  if (day3.length > 0 || day7.length > 0) {
    const block: string[] = []
    block.push("*:hourglass_flowing_sand: Persistent concerns*")
    for (const m of day7.slice(0, INLINE_CAP)) {
      block.push(`• *${m.name} - 7 dagen in ${categoryLabel(m.bucket)}* - ${m.insight}`)
    }
    for (const m of day3.slice(0, INLINE_CAP)) {
      block.push(`• ${m.name} - 3 dagen in ${categoryLabel(m.bucket)} - ${m.insight}`)
    }
    const totalShown = Math.min(day7.length, INLINE_CAP) + Math.min(day3.length, INLINE_CAP)
    const totalAll = day3.length + day7.length
    if (totalAll > totalShown) block.push(`…en ${totalAll - totalShown} meer`)
    persistent_section = block.join("\n")
  }

  // ── Wins section ──
  let wins_section = ""
  if (todayImprovements.length > 0) {
    const block: string[] = []
    block.push(
      `*:white_check_mark: ${todayImprovements.length} ${todayImprovements.length === 1 ? "win" : "wins"} vandaag*`,
    )
    for (const t of todayImprovements.slice(0, INLINE_CAP)) {
      block.push(`• ${t.name} → ${categoryLabel(t.to)} (was ${categoryLabel(t.from)}) - ${t.insight}`)
    }
    if (todayImprovements.length > INLINE_CAP) {
      block.push(`…en ${todayImprovements.length - INLINE_CAP} meer`)
    }
    wins_section = block.join("\n")
  }

  return {
    greeting,
    score_line,
    bucket_line,
    healthy_count: todayBuckets.good,
    watch_count: todayBuckets.watch,
    action_count: todayBuckets.action,
    concerns_section,
    wins_section,
    persistent_section,
    open_link: `<${HUB_URL}/watchlist|Open Watchlist>`,
  }
}

/**
 * Convenience wrapper - computes vars and renders against `template`
 * (or the default if not provided).
 */
export function buildWatchlistDailySummary(
  opts: Parameters<typeof computeWatchlistVars>[0],
  template?: string | null,
): string {
  const vars = computeWatchlistVars(opts)
  return renderTemplate(template ?? DEFAULT_TEMPLATES.personal_watchlist, vars)
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
