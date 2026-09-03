import { format, subDays } from "date-fns"
import { readCache } from "@/lib/cache"
import {
  fetchMondayTargets,
  fetchMetaTargets,
  fetchGoogleAdsSpend,
} from "@/lib/targets/fetchers"
import type {
  MondayTargetsData,
  MondayTargetsByCountry,
  MetaTargetsByCountry,
  GoogleAdsSpend,
} from "@/types/targets"
import {
  DEFAULT_TEMPLATES,
  getNotificationConfig,
  renderTemplate,
} from "./notification-config"
import { amsterdamToday, fetchAppointmentsForDate } from "./sales-fetcher"
import type { AppointmentRow } from "./sales-fetcher"
import {
  marketingLine,
  salesLine,
  closerLinesFrom,
  appointmentLines,
  type SalesCounts,
} from "./funnel-summary"

// ─── Greeting ───────────────────────────────────────────────────────────────

function bodGreeting(today: string): string {
  const pool = [
    "Goedemorgen sales team ☀️",
    "Beginning of day 🚀",
    "Morning amigos! ☕",
    "Nieuwe dag, nieuwe kansen 💪",
    "Good morning crew!",
  ]
  const dayGreetings: Record<number, string[]> = {
    1: ["Happy Monday team! 🚀"],
    5: ["Vrijdag amigos! 🎉"],
  }
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay()
  const all = [...pool, ...(dayGreetings[dow] ?? [])]
  const seed = parseInt(today.replace(/-/g, ""), 10)
  return all[seed % all.length]
}

// ─── Variable builder ───────────────────────────────────────────────────────

export type BodVars = {
  greeting: string
  marketing_line: string
  sales_line: string
  closer_lines: string
  appointments_lines: string
}

/**
 * Builds the BOD channel message variables from the last-7d "all"-country funnel
 * bucket, the combined (Meta + Google) 7d ad spend, and today's appointments.
 *
 * Windows: Marketing/Sales/Closer numbers are all last 7 days excluding today.
 * Scheduled/taken/empty are appointment-date lens; deals are on deal-close date.
 */
export function computeBodVars(
  mkt: MondayTargetsData,
  spend7d: number,
  appointments: AppointmentRow[],
  today: string,
): { vars: BodVars; closerCount: number } {
  const teamCounts: SalesCounts = {
    scheduled: mkt.calls,
    noShowCancel: mkt.noShows + mkt.cancellations,
    taken: mkt.takenCalls,
    deals: mkt.deals,
    empty: mkt.notUpdated,
  }

  // Per-closer no show/cancel is derived (scheduled − taken − empty) because
  // CloserData doesn't split it out.
  const closerRows = mkt.closers.map((c) => ({
    name: c.closer,
    counts: {
      scheduled: c.qualifiedCalls,
      noShowCancel: Math.max(0, c.qualifiedCalls - c.takenCalls - c.notUpdated),
      taken: c.takenCalls,
      deals: c.deals,
      empty: c.notUpdated,
    } satisfies SalesCounts,
  }))
  const closers = closerLinesFrom(closerRows, "• Geen calls in de afgelopen 7 dagen")

  return {
    vars: {
      greeting: bodGreeting(today),
      marketing_line: marketingLine({ spend: spend7d, optIns: mkt.optIns, booked: mkt.mktBooked }),
      sales_line: salesLine(teamCounts),
      closer_lines: closers.text,
      appointments_lines: appointmentLines(appointments, "• Geen afspraken vandaag 🎉"),
    },
    closerCount: closers.count,
  }
}

// ─── Data gathering (warm cache first, live fallback) ───────────────────────

/**
 * Rolling last-7-days range (ends yesterday), matching refresh-targets exactly
 * so the BOD reads the same warm `targets_*:START:END` cache keys the dashboard
 * uses. Server-time based (Vercel = UTC), same as the warmer.
 */
function last7dRange(): { start: string; end: string } {
  const now = new Date()
  return { start: format(subDays(now, 7), "yyyy-MM-dd"), end: format(subDays(now, 1), "yyyy-MM-dd") }
}

export async function loadMondayTargets(start: string, end: string): Promise<MondayTargetsData> {
  const cached = await readCache<MondayTargetsByCountry>(`targets_monday:${start}:${end}`)
  const data = cached ?? (await fetchMondayTargets(start, end))
  return data.all
}

export async function loadSpend(start: string, end: string): Promise<number> {
  const metaCached = await readCache<MetaTargetsByCountry>(`targets_meta:${start}:${end}`)
  const meta = metaCached ?? (await fetchMetaTargets(start, end))
  const metaSpend = meta.all?.spend ?? 0

  const googleCached = await readCache<GoogleAdsSpend>(`targets_google_ads:${start}:${end}`)
  const google = googleCached ?? (await fetchGoogleAdsSpend(start, end))
  const googleSpend = google.error ? 0 : google.spend

  return metaSpend + googleSpend
}

/**
 * Assembles the full BOD message. Shared by the daily cron and the admin
 * preview so the two can never drift. `templateOverride` lets the preview test
 * an unsaved template; otherwise the saved override (or built-in default) wins.
 */
export async function buildBodMessage(
  templateOverride?: string | null,
): Promise<{ message: string; closerCount: number; appointmentCount: number }> {
  const { start, end } = last7dRange()
  const today = amsterdamToday()

  const [mkt, spend7d, appointments, config] = await Promise.all([
    loadMondayTargets(start, end),
    loadSpend(start, end),
    fetchAppointmentsForDate(today),
    getNotificationConfig("bod"),
  ])

  const { vars, closerCount } = computeBodVars(mkt, spend7d, appointments, today)
  const template = templateOverride ?? config.template ?? DEFAULT_TEMPLATES.bod
  const message = renderTemplate(template, vars)
  return { message, closerCount, appointmentCount: appointments.length }
}
