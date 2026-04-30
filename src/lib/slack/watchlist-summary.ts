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

const LIVE_CATEGORIES: LiveCategory[] = ["action", "watch", "good"]
const SEVERITY: Record<LiveCategory, number> = { good: 0, watch: 1, action: 2 }
// Score = sum of (-3 for action, -1 for watch, +1 for good). Higher = healthier portfolio.
const SCORE_WEIGHT: Record<LiveCategory, number> = { action: -3, watch: -1, good: 1 }

function categoryLabel(cat: LiveCategory): string {
  return cat === "action" ? "Action" : cat === "watch" ? "Watch" : "Healthy"
}

function categoryEmoji(cat: LiveCategory | "no-data"): string {
  return cat === "action" ? "🔴" : cat === "watch" ? "🟡" : cat === "good" ? "🟢" : "⚪"
}

function isLive(cat: string | null | undefined): cat is LiveCategory {
  return cat === "action" || cat === "watch" || cat === "good"
}

/**
 * Daily Slack summary that focuses on *changes* — what moved between buckets
 * since yesterday or in the last 7 days, plus an overall score delta. Reads
 * from the `watchlist_client_state` table (already maintained by refresh-cache).
 *
 * Skips clients in `no-data` so the message stays focused on actionable signal.
 */
export function buildWatchlistDailySummary(opts: {
  visibleClients: MondayClient[]
  kpiMap: Record<string, KpiSummary>
  userName: string | null
  states: Map<string, ClientState>
  today: string // YYYY-MM-DD
  sevenDaysAgo: string // YYYY-MM-DD
}): string {
  const { visibleClients, kpiMap, userName, states, today, sevenDaysAgo } = opts

  type Transition = {
    name: string
    from: LiveCategory
    to: LiveCategory
    insight: string
    sinceDate: string
  }
  const todayTransitions: Transition[] = []
  const weekTransitions: Transition[] = []

  // Bucket counts: today vs reconstructed yesterday (by inverting today's transitions).
  const todayBuckets: Record<LiveCategory, number> = { action: 0, watch: 0, good: 0 }
  const yesterdayBuckets: Record<LiveCategory, number> = { action: 0, watch: 0, good: 0 }

  for (const client of visibleClients) {
    const state = states.get(client.mondayItemId)
    if (!state) continue
    if (!isLive(state.category)) continue // Skip no-data entirely

    todayBuckets[state.category]++

    const transitionedToday = state.since_date === today && state.prev_category !== null
    const transitionedThisWeek = state.since_date >= sevenDaysAgo && state.since_date <= today && state.prev_category !== null

    // Reconstruct yesterday's bucket: if transitioned today, yesterday was prev_category.
    if (transitionedToday && isLive(state.prev_category)) {
      yesterdayBuckets[state.prev_category]++
    } else {
      yesterdayBuckets[state.category]++
    }

    if (transitionedThisWeek && isLive(state.category) && isLive(state.prev_category)) {
      const kpi = kpiMap[client.mondayItemId]
      const { insight } = categorize(client, kpi)
      const t: Transition = {
        name: client.name,
        from: state.prev_category,
        to: state.category,
        insight,
        sinceDate: state.since_date,
      }
      if (transitionedToday) todayTransitions.push(t)
      weekTransitions.push(t)
    }
  }

  const score = (b: Record<LiveCategory, number>) =>
    b.good * SCORE_WEIGHT.good + b.watch * SCORE_WEIGHT.watch + b.action * SCORE_WEIGHT.action
  const todayScore = score(todayBuckets)
  const yesterdayScore = score(yesterdayBuckets)
  const scoreDelta = todayScore - yesterdayScore

  const todayDeteriorations = todayTransitions.filter((t) => SEVERITY[t.to] > SEVERITY[t.from])
  const todayImprovements = todayTransitions.filter((t) => SEVERITY[t.to] < SEVERITY[t.from])
  const weekDeteriorations = weekTransitions.filter((t) => SEVERITY[t.to] > SEVERITY[t.from])
  const weekImprovements = weekTransitions.filter((t) => SEVERITY[t.to] < SEVERITY[t.from])

  const firstName = (userName ?? "team").split(" ")[0]
  const lines: string[] = []

  // Tone-aware greeting — driven by score delta + concerns mix
  let greeting: string
  if (todayDeteriorations.length === 0 && todayImprovements.length === 0 && scoreDelta === 0) {
    greeting = `🌅 Goedemorgen ${firstName}. Niets veranderd sinds gisteren — alles stabiel.`
  } else if (scoreDelta > 0 && todayDeteriorations.length === 0) {
    greeting = `🌅 Goedemorgen ${firstName}! Score *↑ ${scoreDelta}* vs gisteren — lekker bezig 🚀`
  } else if (scoreDelta < 0 || todayDeteriorations.length > todayImprovements.length) {
    const trend = scoreDelta < 0 ? `*↓ ${Math.abs(scoreDelta)}*` : "*↔*"
    greeting = `🌅 Goedemorgen ${firstName}. Score ${trend} vs gisteren — even letten op:`
  } else {
    greeting = `🌅 Goedemorgen ${firstName}! Een paar bewegingen overnight ✨`
  }
  lines.push(greeting)
  lines.push("")

  // Today's deteriorations (concerns)
  if (todayDeteriorations.length > 0) {
    lines.push(`⚠️ *${todayDeteriorations.length} nieuwe ${todayDeteriorations.length === 1 ? "concern" : "concerns"} vandaag*`)
    for (const t of todayDeteriorations.slice(0, 5)) {
      lines.push(
        `• ${categoryEmoji(t.to)} *${t.name}* → ${categoryLabel(t.to)} (was ${categoryLabel(t.from)}) — ${t.insight}`,
      )
    }
    if (todayDeteriorations.length > 5) lines.push(`_…en ${todayDeteriorations.length - 5} meer_`)
    lines.push("")
  }

  // Today's improvements (wins)
  if (todayImprovements.length > 0) {
    lines.push(`✅ *${todayImprovements.length} ${todayImprovements.length === 1 ? "win" : "wins"} vandaag*`)
    for (const t of todayImprovements.slice(0, 5)) {
      lines.push(
        `• ${categoryEmoji(t.to)} *${t.name}* → ${categoryLabel(t.to)} (was ${categoryLabel(t.from)}) — ${t.insight}`,
      )
    }
    if (todayImprovements.length > 5) lines.push(`_…en ${todayImprovements.length - 5} meer_`)
    lines.push("")
  }

  // 7-day rollup (only if there were transitions earlier this week, to add context without spam)
  const earlierThisWeek = weekTransitions.length - todayTransitions.length
  if (earlierThisWeek > 0) {
    const parts: string[] = []
    if (weekImprovements.length > 0) parts.push(`✅ ${weekImprovements.length} verbetering${weekImprovements.length > 1 ? "en" : ""}`)
    if (weekDeteriorations.length > 0) parts.push(`⚠️ ${weekDeteriorations.length} concern${weekDeteriorations.length > 1 ? "s" : ""}`)
    lines.push(`📅 *Last 7 days:* ${parts.join(" · ")}`)
    lines.push("")
  }

  // Overall current state — concise
  lines.push(
    `📊 *Now:* 🟢 ${todayBuckets.good} · 🟡 ${todayBuckets.watch} · 🔴 ${todayBuckets.action}`,
  )
  lines.push(`<${HUB_URL}/watchlist|→ Open watchlist>`)

  return lines.join("\n")
}
