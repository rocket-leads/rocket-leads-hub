import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getToken, fetchAllItems } from "@/lib/integrations/monday"
import type { MondayTargetsData } from "@/types/targets"

const TARGETS_BOARD_ID = "3762696870"

const STATUS_MAP = {
  qualified: ["Qualified", "No show", "No deal/FU", "No deal", "DEAL"],
  taken: ["No deal/FU", "No deal", "DEAL"],
  deals: ["DEAL"],
  rejections: ["Not interested", "Lead cancelation"],
  noShows: ["No show"],
}

function getColumnValue(item: { column_values: Array<{ id: string; text: string }> }, columnId: string): string {
  return item.column_values.find((c) => c.id === columnId)?.text ?? ""
}

function getNumericValue(item: { column_values: Array<{ id: string; text: string }> }, columnId: string): number {
  const text = getColumnValue(item, columnId)
  const num = parseFloat(text.replace(/[^0-9.-]/g, ""))
  return isNaN(num) ? 0 : num
}

function parseDate(dateStr: string): string | null {
  if (!dateStr) return null
  const match = dateStr.match(/(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

function isInRange(dateStr: string | null, startDate: string, endDate: string): boolean {
  if (!dateStr) return false
  return dateStr >= startDate && dateStr <= endDate
}

function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d.setDate(diff))
  return monday.toISOString().split("T")[0]
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get("startDate")
  const endDate = searchParams.get("endDate")

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 })
  }

  try {
    const token = await getToken()
    const allItems = await fetchAllItems(TARGETS_BOARD_ID, token)

    let leads = 0, calls = 0, qualifiedCalls = 0, rejections = 0
    let noShows = 0, takenCalls = 0, deals = 0, closedRevenue = 0

    const industryMap: Record<string, { deals: number; revenue: number }> = {}

    for (const item of allItems) {
      const datumCreated = parseDate(getColumnValue(item, "datum_created"))
      const datumAfspraak = parseDate(getColumnValue(item, "datum_afspraak"))
      const status = getColumnValue(item, "status")
      const dealValue = getNumericValue(item, "numbers")
      const industry = getColumnValue(item, "status_17") || "Unknown"

      if (isInRange(datumCreated, startDate, endDate)) {
        leads++; calls++
        if (STATUS_MAP.rejections.includes(status)) rejections++
        if (STATUS_MAP.qualified.includes(status)) qualifiedCalls++
        if (STATUS_MAP.noShows.includes(status)) noShows++
      }

      if (isInRange(datumAfspraak, startDate, endDate)) {
        if (STATUS_MAP.taken.includes(status)) takenCalls++
        if (STATUS_MAP.deals.includes(status)) {
          deals++; closedRevenue += dealValue
          if (!industryMap[industry]) industryMap[industry] = { deals: 0, revenue: 0 }
          industryMap[industry].deals++
          industryMap[industry].revenue += dealValue
        }
      }
    }

    // Weekly aggregation: last 4 ISO weeks
    const weeklyMap: Record<string, { calls: number; qualified: number; taken: number; deals: number; revenue: number }> = {}
    const currentMonday = getMondayOfWeek(new Date().toISOString().split("T")[0])
    const targetWeeks = new Set<string>()
    for (let i = 0; i < 4; i++) {
      const d = new Date(currentMonday)
      d.setDate(d.getDate() - i * 7)
      const ws = d.toISOString().split("T")[0]
      targetWeeks.add(ws)
      weeklyMap[ws] = { calls: 0, qualified: 0, taken: 0, deals: 0, revenue: 0 }
    }

    for (const item of allItems) {
      const datumCreated = parseDate(getColumnValue(item, "datum_created"))
      const datumAfspraak = parseDate(getColumnValue(item, "datum_afspraak"))
      const status = getColumnValue(item, "status")

      if (datumCreated) {
        const ws = getMondayOfWeek(datumCreated)
        if (targetWeeks.has(ws)) {
          weeklyMap[ws].calls++
          if (STATUS_MAP.qualified.includes(status)) weeklyMap[ws].qualified++
        }
      }
      if (datumAfspraak) {
        const ws = getMondayOfWeek(datumAfspraak)
        if (targetWeeks.has(ws)) {
          if (STATUS_MAP.taken.includes(status)) weeklyMap[ws].taken++
          if (STATUS_MAP.deals.includes(status)) {
            weeklyMap[ws].deals++
            weeklyMap[ws].revenue += getNumericValue(item, "numbers")
          }
        }
      }
    }

    const weekly = Object.entries(weeklyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, data]) => ({ weekStart, ...data }))

    const industries = Object.entries(industryMap)
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .map(([industry, data]) => ({ industry, ...data }))

    const result: MondayTargetsData = {
      leads, calls, qualifiedCalls, rejections, noShows, takenCalls,
      deals, closedRevenue, totalItems: allItems.length, weekly, industries,
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("[targets/monday]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
