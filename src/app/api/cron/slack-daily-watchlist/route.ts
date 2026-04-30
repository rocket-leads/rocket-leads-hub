import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { filterClientsByUser } from "@/lib/clients/filter"
import { readCache } from "@/lib/cache"
import { sendDmToHubUser } from "@/lib/slack"
import { buildWatchlistDailySummary, type ClientState } from "@/lib/slack/watchlist-summary"
import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = await createAdminClient()

  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select("id, name, role, slack_user_id")
    .not("slack_user_id", "is", null)
  if (usersErr) {
    return NextResponse.json({ ok: false, error: usersErr.message }, { status: 500 })
  }
  if (!users || users.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: "no users with slack_user_id configured" })
  }

  let liveClients: MondayClient[]
  try {
    const cached = await readCache<{ current: MondayClient[] }>("monday_boards")
    const data = cached ?? (await fetchBothBoards())
    liveClients = data.current.filter((c) => c.campaignStatus === "Live")
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to load clients" },
      { status: 500 },
    )
  }

  const kpiCache = (await readCache<Record<string, KpiSummary>>("kpi_summaries")) ?? {}

  const { data: stateRows } = await supabase
    .from("watchlist_client_state")
    .select("monday_item_id, category, prev_category, since_date")
  const states = new Map<string, ClientState>()
  for (const row of stateRows ?? []) {
    states.set(row.monday_item_id, {
      category: row.category,
      prev_category: row.prev_category,
      since_date: row.since_date,
    })
  }

  const today = new Date().toISOString().slice(0, 10)
  const sevenDaysAgoDate = new Date()
  sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 7)
  const sevenDaysAgo = sevenDaysAgoDate.toISOString().slice(0, 10)

  let sent = 0
  let failed = 0
  const errors: Array<{ userId: string; error: string }> = []

  for (const user of users) {
    try {
      const visibleClients = await filterClientsByUser(liveClients, user.id, user.role)
      const message = buildWatchlistDailySummary({
        visibleClients,
        kpiMap: kpiCache,
        userName: user.name,
        states,
        today,
        sevenDaysAgo,
      })
      await sendDmToHubUser(user.id, message)
      sent++
    } catch (e) {
      failed++
      errors.push({ userId: user.id, error: e instanceof Error ? e.message : String(e) })
      console.error(`[slack-daily-watchlist] failed for ${user.id}`, e)
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    failed,
    totalUsers: users.length,
    errors: errors.slice(0, 10),
  })
}
