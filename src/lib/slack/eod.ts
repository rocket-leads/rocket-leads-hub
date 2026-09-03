import { STATUS_MAP } from "@/lib/targets/fetchers"
import {
  DEFAULT_TEMPLATES,
  getNotificationConfig,
  renderTemplate,
} from "./notification-config"
import {
  amsterdamToday,
  shiftDate,
  fetchAppointmentsForDate,
  fetchRawTargetsItems,
} from "./sales-fetcher"
import type { RawTargetsItem } from "./sales-summary"
import { loadMondayTargets, loadSpend } from "./bod"
import {
  marketingLine,
  salesLine,
  closerLinesFrom,
  appointmentLines,
  type SalesCounts,
} from "./funnel-summary"

// ─── Greeting ───────────────────────────────────────────────────────────────

function eodGreeting(today: string): string {
  const pool = [
    "Einde van de dag 🌆",
    "Dat was 'm voor vandaag 🚀",
    "Goedenavond team 🌙",
    "EOD wrap-up 📊",
    "De dag afsluiten amigos!",
  ]
  const seed = parseInt(today.replace(/-/g, ""), 10)
  return pool[seed % pool.length]
}

// ─── Day funnel from raw items ──────────────────────────────────────────────

function classifyStatus(status: string): "empty" | "noShow" | "cancel" | "taken" {
  if (STATUS_MAP.notUpdated.includes(status)) return "empty"
  if (STATUS_MAP.noShows.includes(status)) return "noShow"
  if (STATUS_MAP.cancellations.includes(status)) return "cancel"
  return "taken"
}

type DayAcc = { scheduled: number; noShow: number; cancel: number; taken: number; empty: number; deals: number }
const emptyAcc = (): DayAcc => ({ scheduled: 0, noShow: 0, cancel: 0, taken: 0, empty: 0, deals: 0 })
const toCounts = (a: DayAcc): SalesCounts => ({
  scheduled: a.scheduled,
  noShowCancel: a.noShow + a.cancel,
  taken: a.taken,
  deals: a.deals,
  empty: a.empty,
})

/**
 * Team + per-closer funnel for a single completed day, computed from raw items.
 * Unlike fetchMondayTargets (which buckets same-day appointments as "upcoming"),
 * this treats every appointment dated `date` as having happened and decomposes
 * it by status - the correct lens for an end-of-day evaluation. Deals are on the
 * deal-close date (date3 === date), matching the dashboard's deal axis.
 */
function computeDayFunnel(
  items: RawTargetsItem[],
  date: string,
): { team: SalesCounts; closerRows: Array<{ name: string; counts: SalesCounts }> } {
  const team = emptyAcc()
  const byCloser = new Map<string, DayAcc>()
  const accFor = (name: string) => {
    let a = byCloser.get(name)
    if (!a) { a = emptyAcc(); byCloser.set(name, a) }
    return a
  }

  for (const item of items) {
    const closerKey = item.closer || "Unassigned"
    if (item.datumAfspraak === date) {
      const bucket = classifyStatus(item.status)
      const c = accFor(closerKey)
      team.scheduled++; c.scheduled++
      team[bucket]++; c[bucket]++
    }
    if (item.dateDeal === date && STATUS_MAP.deals.includes(item.status)) {
      team.deals++
      accFor(closerKey).deals++
    }
  }

  const closerRows = [...byCloser.entries()].map(([name, a]) => ({ name, counts: toCounts(a) }))
  return { team: toCounts(team), closerRows }
}

// ─── Message builder ────────────────────────────────────────────────────────

/**
 * Assembles the End-of-Day message. Marketing = today's spend / opt-ins / booked
 * (last 24h of the day that's ending). Sales + per-closer = today's calls by
 * outcome, computed live from raw items. Agenda = tomorrow's appointments.
 * Shared by the daily cron and the admin preview.
 */
export async function buildEodMessage(
  templateOverride?: string | null,
): Promise<{ message: string; closerCount: number; appointmentCount: number }> {
  const today = amsterdamToday()
  const tomorrow = shiftDate(today, 1)

  const [mkt, spendToday, rawItems, tomorrowAppts, config] = await Promise.all([
    loadMondayTargets(today, today),
    loadSpend(today, today),
    fetchRawTargetsItems(),
    fetchAppointmentsForDate(tomorrow),
    getNotificationConfig("eod"),
  ])

  const { team, closerRows } = computeDayFunnel(rawItems, today)
  const closers = closerLinesFrom(closerRows, "• Geen calls vandaag")

  const vars = {
    greeting: eodGreeting(today),
    marketing_line: marketingLine({ spend: spendToday, optIns: mkt.optIns, booked: mkt.mktBooked }),
    sales_line: salesLine(team),
    closer_lines: closers.text,
    appointments_lines: appointmentLines(tomorrowAppts, "• Geen afspraken morgen 🎉"),
  }

  const template = templateOverride ?? config.template ?? DEFAULT_TEMPLATES.eod
  const message = renderTemplate(template, vars)
  return { message, closerCount: closers.count, appointmentCount: tomorrowAppts.length }
}
