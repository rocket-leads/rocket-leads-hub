import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { google } from "googleapis"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import type { CostData } from "@/types/targets"

const HQ_COSTS_MONTHLY = 5000

const MONTH_LABELS = [
  "jan-25", "feb-25", "mrt-25", "apr-25", "mei-25", "jun-25",
  "jul-25", "aug-25", "sep-25", "okt-25", "nov-25", "dec-25",
]

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
  const idx = MONTH_LABELS.indexOf(monthKey)
  if (idx >= 0) return idx + 1
  const monthNames = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]
  const parts = monthKey.split("-")
  const mIdx = monthNames.indexOf(parts[0])
  return mIdx >= 0 ? mIdx + 1 : -1
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const monthKey = searchParams.get("month") // e.g. "apr-25"
  const spreadsheetId = searchParams.get("spreadsheetId") || process.env.GOOGLE_SHEETS_SPREADSHEET_ID

  if (!monthKey) {
    return NextResponse.json({ error: "month parameter required (e.g. apr-25)" }, { status: 400 })
  }

  if (!spreadsheetId) {
    return NextResponse.json({ error: "Spreadsheet ID not configured." }, { status: 400 })
  }

  const col = getMonthCol(monthKey)
  if (col < 0) {
    return NextResponse.json({ error: "Invalid month key" }, { status: 400 })
  }

  try {
    const authClient = await getAuth()
    const sheets = google.sheets({ version: "v4", auth: authClient })

    // Fetch both sheets in parallel
    const [profitsRes, teamCostsRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Profits!A1:N54" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Team costs!A1:N100" }),
    ])

    const profitsRows = profitsRes.data.values as string[][] | undefined
    const teamCostsRows = teamCostsRes.data.values as string[][] | undefined

    // Marketing costs: Profits sheet, row 8 (total ad spend), column for the month
    const marketingCosts = profitsRows ? parseEuro(profitsRows[7]?.[col]) : 0

    // Team costs: Team costs sheet, row 31 (totaal zonder commissie), column for the month
    const teamCosts = teamCostsRows ? parseEuro(teamCostsRows[30]?.[col]) : 0

    // HQ costs: fixed
    const hqCosts = HQ_COSTS_MONTHLY

    const costData: CostData = {
      teamCosts,
      marketingCosts,
      hqCosts,
      totalCosts: teamCosts + marketingCosts + hqCosts,
    }

    return NextResponse.json(costData, {
      headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" },
    })
  } catch (error) {
    console.error("[targets/sheets]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sheets error" }, { status: 500 })
  }
}
