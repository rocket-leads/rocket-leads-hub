import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { fetchMondayTargets, fetchDelivery, getMtdRange } from "@/lib/targets/fetchers"
import type {
  MondayTargetsByCountry,
  MondayTargetsData,
  DeliveryOverview,
  TargetsConfig,
  CloserData,
} from "@/types/targets"
import {
  DEFAULT_TEMPLATES,
  getNotificationConfig,
  renderTemplate,
} from "./notification-config"
import { amsterdamToday } from "./sales-fetcher"
import { eur0, pct } from "./funnel-summary"

const WEEKDAYS_NL = ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"]
const MONTHS_NL = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
]

const MEDALS = ["🥇", "🥈", "🥉"]

/** "BOD | Donderdag 3 september" from a YYYY-MM-DD Amsterdam date. */
function header(today: string): string {
  const d = new Date(`${today}T00:00:00Z`)
  const weekday = WEEKDAYS_NL[d.getUTCDay()]
  const day = parseInt(today.slice(8, 10), 10)
  const month = MONTHS_NL[parseInt(today.slice(5, 7), 10) - 1]
  return `BOD | ${weekday} ${day} ${month}`
}

/** Fraction of the current month elapsed (day-of-month / days-in-month). */
function monthFraction(today: string): number {
  const year = parseInt(today.slice(0, 4), 10)
  const month = parseInt(today.slice(5, 7), 10)
  const day = parseInt(today.slice(8, 10), 10)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return daysInMonth > 0 ? day / daysInMonth : 0
}

const int = (n: number): string => String(Math.round(n))
const firstName = (name: string): string => name.split(" ")[0]

/**
 * One tracker line: `- {label} {actual}/{pro-rata target} {✅|❌} ({full-month target})`.
 * Pro-rata target = full-month × fraction-of-month-elapsed; ✅ when actual is at or
 * ahead of that pace. Money metrics format as euros, volume metrics as integers.
 * When there's no full-month target configured, shows just the actual.
 */
function trackerLine(
  label: string,
  actual: number,
  fullTarget: number,
  frac: number,
  money: boolean,
): string {
  const fmt = money ? eur0 : int
  if (fullTarget <= 0) return `- ${label} ${fmt(actual)}`
  const proRata = fullTarget * frac
  const ok = actual >= proRata
  return `- ${label} ${fmt(actual)}/${fmt(proRata)} ${ok ? "✅" : "❌"} (${fmt(fullTarget)})`
}

function trackerLines(mkt: MondayTargetsData, delivery: DeliveryOverview, cfg: TargetsConfig | null, frac: number): string {
  // Taken-calls target is derived like the dashboard: adSpend / ctc, adSpend = deals × cpd.
  const takenTarget = cfg && cfg.ctc > 0 ? (cfg.deals * cfg.cpd) / cfg.ctc : 0
  return [
    trackerLine("Taken calls", mkt.takenCalls, takenTarget, frac, false),
    trackerLine("Deals", mkt.deals, cfg?.deals ?? 0, frac, false),
    trackerLine("New business closed", mkt.closedRevenue, cfg?.revenue ?? 0, frac, true),
    trackerLine("New business collected", mkt.collectedRevenue, cfg?.collectedRevenue ?? 0, frac, true),
    trackerLine("MRR", delivery.mrr, cfg?.mrr ?? 0, frac, true),
  ].join("\n")
}

function salesLeaderboard(closers: CloserData[]): string {
  const rows = closers.filter((c) => c.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 3)
  if (rows.length === 0) return "• Nog geen deals deze maand"
  return rows
    .map(
      (c, i) =>
        `${MEDALS[i] ?? "•"} ${firstName(c.closer)} ${eur0(c.revenue)} closed & ${eur0(c.collectedRevenue)} collected (${pct(c.collectedRevenue, c.revenue)})`,
    )
    .join("\n")
}

function deliveryLeaderboard(delivery: DeliveryOverview): string {
  const teams = delivery.byTeam.filter((t) => t.mrr > 0).sort((a, b) => b.mrr - a.mrr)
  const lines = teams.map((t, i) => `${MEDALS[i] ?? "•"} ${t.name} ${eur0(t.mrr)} MRR`)
  const unassignedMrr = delivery.unassignedCustomers.reduce((s, c) => s + (c.mrr ?? 0), 0)
  if (unassignedMrr > 0) lines.push(`⏳ Unassigned revenue ${eur0(unassignedMrr)} MRR`)
  if (lines.length === 0) return "• Geen MRR deze maand"
  return lines.join("\n")
}

// ─── Data gathering (warm MTD cache first, live fallback) ───────────────────

async function loadMonthMonday(): Promise<MondayTargetsData> {
  const cached = await readCache<MondayTargetsByCountry>("targets_marketing_monday")
  if (cached) return cached.all
  const mtd = getMtdRange()
  return (await fetchMondayTargets(mtd.startDate, mtd.endDate)).all
}

async function loadMonthDelivery(): Promise<DeliveryOverview> {
  const cached = await readCache<DeliveryOverview>("targets_delivery_v3")
  if (cached) return cached
  const mtd = getMtdRange()
  return fetchDelivery(mtd.startDate, mtd.endDate)
}

async function loadTargetsConfig(): Promise<TargetsConfig | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase.from("settings").select("value").eq("key", "targets_config").maybeSingle()
  return (data?.value ?? null) as TargetsConfig | null
}

/**
 * Assembles the Targets Tracker BOD message (MTD on-track/off-track vs targets +
 * sales & delivery leaderboards). Reads the warm MTD caches the refresh-targets
 * cron maintains, with a live fallback. Shared by the cron and the admin preview.
 */
export async function buildTargetsTrackerMessage(
  templateOverride?: string | null,
): Promise<{ message: string }> {
  const today = amsterdamToday()

  const [mkt, delivery, cfg, config] = await Promise.all([
    loadMonthMonday(),
    loadMonthDelivery(),
    loadTargetsConfig(),
    getNotificationConfig("targets"),
  ])

  const frac = monthFraction(today)
  const vars = {
    header: header(today),
    tracker_lines: trackerLines(mkt, delivery, cfg, frac),
    sales_leaderboard: salesLeaderboard(mkt.closers),
    delivery_leaderboard: deliveryLeaderboard(delivery),
  }

  const template = templateOverride ?? config.template ?? DEFAULT_TEMPLATES.targets
  const message = renderTemplate(template, vars)
  return { message }
}
