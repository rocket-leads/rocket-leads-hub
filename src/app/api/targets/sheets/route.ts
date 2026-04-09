import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { google } from "googleapis"
import type { CostData } from "@/types/targets"

const SHEET_RANGES: Record<string, string> = {
  profits: "Profits!A1:N54",
  teamcosts: "Team costs!A1:N100",
  othercosts: "Other costs!A1:G200",
}

const MONTH_LABELS = [
  "jan-25", "feb-25", "mrt-25", "apr-25", "mei-25", "jun-25",
  "jul-25", "aug-25", "sep-25", "okt-25", "nov-25", "dec-25",
]

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  })
}

function parseEuro(val: string | undefined): number {
  if (!val) return 0
  const cleaned = val.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", ".")
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

function getMonthCol(monthKey: string): number {
  const idx = MONTH_LABELS.indexOf(monthKey)
  if (idx >= 0) return idx + 1
  const monthNames = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]
  const parts = monthKey.split("-")
  const mIdx = monthNames.indexOf(parts[0])
  return mIdx >= 0 ? mIdx + 1 : -1
}

function getCell(rows: string[][], row: number, col: number): string {
  return rows[row - 1]?.[col] ?? ""
}

function parseCostData(rows: string[][], col: number): CostData {
  const c = (row: number) => parseEuro(getCell(rows, row, col))
  return {
    teamCosts: { nl: c(16), be: c(17), de: c(18), total: c(19) },
    marketingCosts: { nl: c(22), be: c(23), de: c(24), total: c(25) },
    hqCosts: { software: c(28), marketing: c(29), general: c(30), total: c(31) },
    totalCosts: c(19) + c(25) + c(31),
  }
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const sheet = searchParams.get("sheet") || "profits"
  const monthKey = searchParams.get("month") // e.g. "apr-25"

  const range = SHEET_RANGES[sheet]
  if (!range) {
    return NextResponse.json({ error: "Invalid sheet parameter" }, { status: 400 })
  }

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  if (!spreadsheetId || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    return NextResponse.json({ error: "Google Sheets not configured" }, { status: 500 })
  }

  try {
    const authClient = getAuth()
    const sheets = google.sheets({ version: "v4", auth: authClient })
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range })
    const rows = response.data.values as string[][] | undefined

    if (!rows) {
      return NextResponse.json({ error: "No data found" }, { status: 404 })
    }

    // If a specific month is requested for costs, parse and return structured data
    if (sheet === "profits" && monthKey) {
      const col = getMonthCol(monthKey)
      if (col < 0) {
        return NextResponse.json({ error: "Invalid month key" }, { status: 400 })
      }
      const costData = parseCostData(rows, col)
      return NextResponse.json(costData, {
        headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" },
      })
    }

    // Otherwise return raw rows
    return NextResponse.json(rows, {
      headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" },
    })
  } catch (error) {
    console.error("[targets/sheets]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sheets error" }, { status: 500 })
  }
}
