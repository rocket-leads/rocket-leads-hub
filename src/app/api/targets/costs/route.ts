import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import Stripe from "stripe"
import { google } from "googleapis"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import type { CostData } from "@/types/targets"

const HQ_COSTS_MONTHLY = 5000
const MONTH_NAMES_NL = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]

const AD_BUDGET_KEYWORDS = [
  "advertentiebudget", "advertising budget", "adspend", "ad spend",
  "ad budget", "mediabudget", "media budget", "budget",
]

function isAdBudget(description: string | null): boolean {
  if (!description) return false
  const lower = description.toLowerCase()
  return AD_BUDGET_KEYWORDS.some((kw) => lower.includes(kw))
}

let cachedAuth: { value: InstanceType<typeof google.auth.GoogleAuth>; expiresAt: number } | null = null

async function getGoogleAuth() {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) return cachedAuth.value
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "google_drive")
    .single()
  if (!data) throw new Error("Google service account not configured.")
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

async function getStripe(): Promise<Stripe> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "stripe")
    .single()
  if (!data) throw new Error("Stripe token not configured.")
  return new Stripe(decrypt(data.token_encrypted))
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

function monthKey(year: number, month: number): string {
  return `${MONTH_NAMES_NL[month - 1]}-${String(year).slice(2)}`
}

function getMonthBoundaries(year: number, month: number): { startTs: number; endTs: number } {
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59))
  return {
    startTs: Math.floor(start.getTime() / 1000),
    endTs: Math.floor(end.getTime() / 1000),
  }
}

/** Sum invoiced service fee for a given month */
async function getServiceFeeInvoiced(stripe: Stripe, year: number, month: number): Promise<number> {
  const { startTs, endTs } = getMonthBoundaries(year, month)
  let total = 0
  let hasMore = true
  let startingAfter: string | undefined

  while (hasMore) {
    const page = await stripe.invoices.list({
      created: { gte: startTs, lte: endTs },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const inv of page.data) {
      if (inv.status === "draft" || inv.status === "void") continue
      for (const line of inv.lines?.data ?? []) {
        if (!isAdBudget(line.description)) {
          total += line.amount / 100
        }
      }
    }
    hasMore = page.has_more
    startingAfter = page.data[page.data.length - 1]?.id
  }

  return total
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const yearStr = searchParams.get("year")
  const monthStr = searchParams.get("month")

  if (!yearStr || !monthStr) {
    return NextResponse.json({ error: "year and month required" }, { status: 400 })
  }

  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  if (!spreadsheetId) {
    return NextResponse.json({ error: "Spreadsheet ID not configured." }, { status: 400 })
  }

  try {
    const authClient = await getGoogleAuth()
    const sheets = google.sheets({ version: "v4", auth: authClient })

    const [profitsRes, teamCostsRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Profits!A1:N54" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Team costs!A1:N100" }),
    ])

    const profitsRows = profitsRes.data.values as string[][] | undefined
    const teamCostsRows = teamCostsRes.data.values as string[][] | undefined

    const readMonth = (col: number) => ({
      marketingCosts: profitsRows ? parseEuro(profitsRows[7]?.[col]) : 0, // row 8
      teamCosts: teamCostsRows ? parseEuro(teamCostsRows[30]?.[col]) : 0, // row 31
    })

    const currentKey = monthKey(year, month)
    const currentCol = getMonthCol(currentKey)
    const current = currentCol >= 0 ? readMonth(currentCol) : { teamCosts: 0, marketingCosts: 0 }

    let teamCosts = current.teamCosts
    let marketingCosts = current.marketingCosts
    const hqCosts = HQ_COSTS_MONTHLY
    const estimated = { teamCosts: false, marketingCosts: false, hqCosts: false }

    // If team or marketing is empty, compute estimate from prior 3 months
    if (teamCosts === 0 || marketingCosts === 0) {
      const stripe = await getStripe()

      // Build prior 3 month list
      const priorMonths: Array<{ year: number; month: number; key: string }> = []
      let py = year, pm = month
      for (let i = 0; i < 3; i++) {
        pm--
        if (pm === 0) { pm = 12; py-- }
        priorMonths.push({ year: py, month: pm, key: monthKey(py, pm) })
      }

      // Read costs from sheet for these months
      const priorCosts = priorMonths.map((p) => {
        const c = getMonthCol(p.key)
        return c >= 0 ? readMonth(c) : { teamCosts: 0, marketingCosts: 0 }
      })

      // Fetch invoiced service fee revenue for these months from Stripe (in parallel)
      const priorRevenues = await Promise.all(
        priorMonths.map((p) => getServiceFeeInvoiced(stripe, p.year, p.month)),
      )

      // Sum totals across the 3 months for both costs and revenue
      const sumTeam = priorCosts.reduce((s, c) => s + c.teamCosts, 0)
      const sumMarketing = priorCosts.reduce((s, c) => s + c.marketingCosts, 0)
      const sumRevenue = priorRevenues.reduce((s, r) => s + r, 0)

      // Compute ratios (avg over period)
      const teamRatio = sumRevenue > 0 ? sumTeam / sumRevenue : 0
      const marketingRatio = sumRevenue > 0 ? sumMarketing / sumRevenue : 0

      // Get current month's invoiced service fee revenue from Stripe
      const currentRevenue = await getServiceFeeInvoiced(stripe, year, month)

      if (teamCosts === 0) {
        teamCosts = Math.round(currentRevenue * teamRatio)
        estimated.teamCosts = true
      }
      if (marketingCosts === 0) {
        marketingCosts = Math.round(currentRevenue * marketingRatio)
        estimated.marketingCosts = true
      }
    }

    const result: CostData = {
      teamCosts,
      marketingCosts,
      hqCosts,
      totalCosts: teamCosts + marketingCosts + hqCosts,
      estimated,
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" },
    })
  } catch (error) {
    console.error("[targets/costs]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Costs error" }, { status: 500 })
  }
}
