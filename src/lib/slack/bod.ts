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
import { amsterdamToday, fetchTodaysAppointments } from "./sales-fetcher"
import type { TodayAppointment } from "./sales-fetcher"

// ─── Formatting ─────────────────────────────────────────────────────────────

/** Whole-euro amount with thousands separators: 1000 → "€1,000". */
function eur0(n: number): string {
  return `€${Math.round(n).toLocaleString("en-GB")}`
}

/** Cost-per amount: no decimals when whole, else two. 10 → "€10", 12.375 → "€12.38". */
function eurCost(n: number): string {
  const r = Math.round(n * 100) / 100
  return Number.isInteger(r) ? `€${r}` : `€${r.toFixed(2)}`
}

/** Ratio as a whole percent. Returns "–" when the denominator is 0 (no data), not "0%". */
function pct(num: number, den: number): string {
  if (den <= 0) return "–"
  return `${Math.round((num / den) * 100)}%`
}

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
 * Booking Rate (BR) = booked calls (creation-date/marketing lens) / opt-ins.
 * Scheduled/taken/empty are appointment-date lens; deals are on deal-close date.
 * Returns `closerCount` so the caller can log/report how many closers were shown.
 */
export function computeBodVars(
  mkt: MondayTargetsData,
  spend7d: number,
  appointments: TodayAppointment[],
  today: string,
): { vars: BodVars; closerCount: number } {
  // Marketing lens. Top-of-funnel is OPT-INS (form submissions on the opt-ins
  // board), not raw Meta leads - matches the dashboard's "Opt-ins" +
  // "Cost per opt-in" cards, and makes BR = booked / opt-ins reconcile with the
  // opt-ins number shown on the same line.
  const optIns = mkt.optIns
  const costPerOptIn = optIns > 0 ? spend7d / optIns : 0
  const booked = mkt.mktBooked
  const cbc = booked > 0 ? spend7d / booked : 0
  const marketing_line = `${eur0(spend7d)} spend · ${optIns} opt-ins (${eurCost(costPerOptIn)}) · ${booked} booked (${eurCost(cbc)}) · ${pct(booked, optIns)} BR`

  // Sales lens: appointment-date scheduled calls decomposed by outcome.
  const scheduled = mkt.calls
  const noShowCancel = mkt.noShows + mkt.cancellations
  const taken = mkt.takenCalls
  const empty = mkt.notUpdated
  const sales_line = `${scheduled} scheduled · ${noShowCancel} no show/cancel · ${taken} taken calls (${pct(taken, scheduled)}) · ${mkt.deals} deal (${pct(mkt.deals, taken)}) · ${empty} empty outcome`

  // Per-closer: same 7d appointment-date lens. no show/cancel is derived
  // (scheduled − taken − empty) because CloserData doesn't split it out.
  const activeClosers = mkt.closers
    .filter((c) => c.qualifiedCalls > 0 || c.deals > 0)
    .sort((a, b) => b.qualifiedCalls - a.qualifiedCalls || b.deals - a.deals)
  const closerLines = activeClosers.map((c) => {
    const cScheduled = c.qualifiedCalls
    const cNsc = Math.max(0, c.qualifiedCalls - c.takenCalls - c.notUpdated)
    return `• ${c.closer}: ${cScheduled} scheduled, ${cNsc} no show/cancel, ${c.takenCalls} taken (${pct(c.takenCalls, cScheduled)}), ${c.deals} deal (${pct(c.deals, c.takenCalls)}), ${c.notUpdated} empty outcome`
  })
  const closer_lines =
    closerLines.length > 0 ? closerLines.join("\n") : "• Geen calls in de afgelopen 7 dagen"

  // Today's agenda.
  const apptLines = appointments.map((a) => {
    const timePart = a.time ? `${a.time}: ` : ""
    const statusPart = a.status ? ` (${a.status})` : ""
    return `• ${timePart}${a.name}${statusPart} - <${a.url}|Bekijk in Monday>`
  })
  const appointments_lines =
    apptLines.length > 0 ? apptLines.join("\n") : "• Geen afspraken vandaag 🎉"

  return {
    vars: {
      greeting: bodGreeting(today),
      marketing_line,
      sales_line,
      closer_lines,
      appointments_lines,
    },
    closerCount: activeClosers.length,
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

async function loadMonday(start: string, end: string): Promise<MondayTargetsData> {
  const cached = await readCache<MondayTargetsByCountry>(`targets_monday:${start}:${end}`)
  const data = cached ?? (await fetchMondayTargets(start, end))
  return data.all
}

async function loadSpend(start: string, end: string): Promise<number> {
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
    loadMonday(start, end),
    loadSpend(start, end),
    fetchTodaysAppointments(today),
    getNotificationConfig("bod"),
  ])

  const { vars, closerCount } = computeBodVars(mkt, spend7d, appointments, today)
  const template = templateOverride ?? config.template ?? DEFAULT_TEMPLATES.bod
  const message = renderTemplate(template, vars)
  return { message, closerCount, appointmentCount: appointments.length }
}
