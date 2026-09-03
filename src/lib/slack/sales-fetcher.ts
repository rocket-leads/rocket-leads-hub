import { fetchAllItems, getToken as getMondayToken } from "@/lib/integrations/monday"
import type { RawTargetsItem } from "@/lib/slack/sales-summary"

const TARGETS_BOARD_ID = "3762696870"

const MONTH_NAMES_NL = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
]

/**
 * Returns YYYY-MM-DD for "now" in Europe/Amsterdam - the calendar date a closer
 * would call "today" when they read the 06:00 morning DM.
 */
export function amsterdamToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const y = parts.find((p) => p.type === "year")!.value
  const m = parts.find((p) => p.type === "month")!.value
  const d = parts.find((p) => p.type === "day")!.value
  return `${y}-${m}-${d}`
}

export function shiftDate(yyyymmdd: string, deltaDays: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

export function monthStart(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 7)}-01`
}

export function monthLabel(yyyymmdd: string): string {
  const monthIdx = parseInt(yyyymmdd.slice(5, 7), 10) - 1
  return MONTH_NAMES_NL[monthIdx] ?? yyyymmdd.slice(0, 7)
}

function col(item: { column_values: Array<{ id: string; text: string }> }, id: string): string {
  return item.column_values.find((c) => c.id === id)?.text ?? ""
}

function parseDate(s: string): string | null {
  if (!s) return null
  const m = s.match(/(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

/**
 * Extract HH:MM from a Monday date-with-time column text (e.g. "2026-09-03 15:00").
 * Monday only renders a time part when the appointment column has one set, so this
 * returns null for date-only appointments - the BOD then shows the name without a time.
 */
function parseTime(s: string): string | null {
  if (!s) return null
  const m = s.match(/\b(\d{1,2}):(\d{2})\b/)
  if (!m) return null
  return `${m[1].padStart(2, "0")}:${m[2]}`
}

/** Deep-link to an item on the central targets board. */
export function targetsItemUrl(itemId: string): string {
  return `https://rocketleads-team.monday.com/boards/${TARGETS_BOARD_ID}/pulses/${itemId}`
}

export type AppointmentRow = {
  itemId: string
  name: string
  /** `bedrijfsnaam` column, or null when empty - shown next to the lead name. */
  companyName: string | null
  closer: string | null
  /** HH:MM, or null when the appointment has no time-of-day set. */
  time: string | null
  /** Raw Monday status column text (e.g. "Gepland", "Qualified", "DEAL"). */
  status: string
  url: string
}

/**
 * Every targets-board item whose appointment date (`datum_afspraak`) equals
 * `date` (YYYY-MM-DD). Sorted by time ascending, untimed appointments last.
 * Cron/preview-only - reads the board live so the agenda is always current.
 */
export async function fetchAppointmentsForDate(date: string): Promise<AppointmentRow[]> {
  const token = await getMondayToken()
  const items = await fetchAllItems(TARGETS_BOARD_ID, token)
  const out: AppointmentRow[] = []
  for (const item of items) {
    const raw = col(item, "datum_afspraak")
    if (parseDate(raw) !== date) continue
    out.push({
      itemId: item.id,
      name: item.name,
      companyName: col(item, "bedrijfsnaam").trim() || null,
      closer: col(item, "wie_").trim() || null,
      time: parseTime(raw),
      status: col(item, "status").trim(),
      url: targetsItemUrl(item.id),
    })
  }
  out.sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"))
  return out
}

function parseEuro(s: string): number {
  const n = parseFloat((s ?? "").replace(/[^0-9.-]/g, ""))
  return isNaN(n) ? 0 : n
}

/**
 * Pulls every targets-board item and projects to the minimal shape that the
 * sales summary cares about. Cron-only; no caching layer because the cron
 * runs once a day and the freshest read is what matters.
 */
export async function fetchRawTargetsItems(): Promise<RawTargetsItem[]> {
  const token = await getMondayToken()
  const items = await fetchAllItems(TARGETS_BOARD_ID, token)
  return items.map((item) => {
    const closer = col(item, "wie_").trim() || null
    return {
      closer,
      name: item.name,
      datumAfspraak: parseDate(col(item, "datum_afspraak")),
      dateDeal: parseDate(col(item, "date3")),
      status: col(item, "status"),
      dealValue: parseEuro(col(item, "numbers")),
    }
  })
}
