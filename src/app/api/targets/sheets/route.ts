import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { google } from "googleapis"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

const HQ_COSTS_MONTHLY = 5000
const MONTH_NAMES_NL = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]

let cachedAuth: { value: InstanceType<typeof google.auth.GoogleAuth>; expiresAt: number } | null = null

async function getAuth() {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) return cachedAuth.value

  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "google_drive")
    .single()

  if (!data) throw new Error("Google service account not configured. Go to Settings → API Tokens.")

  const keyJson = JSON.parse(decrypt(data.token_encrypted))

  const authClient = new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ],
  })

  cachedAuth = { value: authClient, expiresAt: Date.now() + 30 * 60 * 1000 }
  return authClient
}

function parseEuro(val: string | undefined): number {
  if (!val) return 0
  const cleaned = val.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", ".")
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

function getMonthCol(monthKey: string): number {
  const parts = monthKey.split("-")
  const mIdx = MONTH_NAMES_NL.indexOf(parts[0])
  return mIdx >= 0 ? mIdx + 1 : -1
}

/** Build a list of the last N month keys before (and including) the given month */
function getRecentMonthKeys(year: number, month: number, count: number): Array<{ year: number; month: number; key: string }> {
  const result = []
  let y = year
  let m = month
  for (let i = 0; i < count; i++) {
    result.push({ year: y, month: m, key: `${MONTH_NAMES_NL[m - 1]}-${String(y).slice(2)}` })
    m--
    if (m === 0) { m = 12; y-- }
  }
  return result
}

export interface MonthCostRow {
  monthKey: string
  teamCosts: number
  marketingCosts: number
  hqCosts: number
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const monthKey = searchParams.get("month")
  const includeHistory = searchParams.get("includeHistory") === "true"
  const spreadsheetId = searchParams.get("spreadsheetId") || process.env.GOOGLE_SHEETS_SPREADSHEET_ID

  if (!monthKey) {
    return NextResponse.json({ error: "month parameter required (e.g. apr-25)" }, { status: 400 })
  }

  if (!spreadsheetId) {
    return NextResponse.json({ error: "Spreadsheet ID not configured." }, { status: 400 })
  }

  // Parse year/month from monthKey
  const [mName, yShort] = monthKey.split("-")
  const month = MONTH_NAMES_NL.indexOf(mName) + 1
  const year = 2000 + parseInt(yShort, 10)
  if (month < 1) {
    return NextResponse.json({ error: "Invalid month key" }, { status: 400 })
  }

  try {
    const authClient = await getAuth()
    const sheets = google.sheets({ version: "v4", auth: authClient })

    const [profitsRes, teamCostsRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Profits!A1:N54" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Team costs!A1:N100" }),
    ])

    const profitsRows = profitsRes.data.values as string[][] | undefined
    const teamCostsRows = teamCostsRes.data.values as string[][] | undefined

    // Read costs for a specific month column
    const readMonthCosts = (col: number): MonthCostRow => {
      const marketingCosts = profitsRows ? parseEuro(profitsRows[7]?.[col]) : 0 // row 8
      const teamCosts = teamCostsRows ? parseEuro(teamCostsRows[30]?.[col]) : 0 // row 31
      return {
        monthKey: "",
        teamCosts,
        marketingCosts,
        hqCosts: HQ_COSTS_MONTHLY,
      }
    }

    // Current month
    const col = getMonthCol(monthKey)
    if (col < 0) {
      return NextResponse.json({ error: "Invalid month key" }, { status: 400 })
    }
    const current = { ...readMonthCosts(col), monthKey }

    if (!includeHistory) {
      const totalCosts = current.teamCosts + current.marketingCosts + current.hqCosts
      return NextResponse.json({
        teamCosts: current.teamCosts,
        marketingCosts: current.marketingCosts,
        hqCosts: current.hqCosts,
        totalCosts,
        estimated: { teamCosts: false, marketingCosts: false, hqCosts: false },
      }, {
        headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" },
      })
    }

    // History: 3 prior months (excluding current)
    const priorMonths = getRecentMonthKeys(year, month, 4).slice(1) // skip current
    const history: MonthCostRow[] = priorMonths.map((p) => {
      const c = getMonthCol(p.key)
      if (c < 0) return { monthKey: p.key, teamCosts: 0, marketingCosts: 0, hqCosts: HQ_COSTS_MONTHLY }
      return { ...readMonthCosts(c), monthKey: p.key }
    })

    return NextResponse.json({
      current,
      history,
    }, {
      headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" },
    })
  } catch (error) {
    console.error("[targets/sheets]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sheets error" }, { status: 500 })
  }
}
