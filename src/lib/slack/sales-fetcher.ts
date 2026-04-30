import { fetchAllItems, getToken as getMondayToken } from "@/lib/integrations/monday"
import type { RawTargetsItem } from "@/lib/slack/sales-summary"

const TARGETS_BOARD_ID = "3762696870"

const MONTH_NAMES_NL = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
]

/**
 * Returns YYYY-MM-DD for "now" in Europe/Amsterdam — the calendar date a closer
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
