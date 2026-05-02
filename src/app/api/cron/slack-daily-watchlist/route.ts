import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { filterClientsByUser } from "@/lib/clients/filter"
import { readCache } from "@/lib/cache"
import { sendDmToHubUser } from "@/lib/slack"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import {
  computeSevenDayAvgScore,
  computeWatchlistVars,
  type ClientState,
} from "@/lib/slack/watchlist-summary"
import {
  DEFAULT_TEMPLATES,
  getNotificationConfig,
  renderTemplate,
  shouldRunNow,
} from "@/lib/slack/notification-config"
import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"

export const maxDuration = 60

type ScoreHistory = Record<string, Record<string, { action: number; watch: number; good: number }>>

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  // Admins firing this from the UI mean "send it to everyone right now" — bypass
  // the hour-of-day guard. Cron callers still need ?force=1 to override.
  const force = authz.forcedByAdmin || url.searchParams.get("force") === "1"

  // Vercel cron is UTC-only and fires hourly; the user-configured hour in
  // Settings → Notifications gates which fire actually does work.
  const config = await getNotificationConfig("personal_watchlist")
  const guard = shouldRunNow(config, force)
  if (!guard.ok) {
    return NextResponse.json({ ok: true, skipped: guard.reason })
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
  const scoreHistory = (await readCache<ScoreHistory>("watchlist_score_history")) ?? {}

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

  // Each non-admin user's CM mapping (if any) → use their slice from score_history.
  const { data: cmMappings } = await supabase
    .from("user_column_mappings")
    .select("user_id, monday_person_name")
    .eq("monday_column_role", "campaign_manager")
  const userCmName = new Map<string, string>()
  for (const m of cmMappings ?? []) userCmName.set(m.user_id, m.monday_person_name)

  const today = new Date().toISOString().slice(0, 10)
  const template = config.template ?? DEFAULT_TEMPLATES.personal_watchlist

  let sent = 0
  let failed = 0
  const errors: Array<{ userId: string; error: string }> = []

  for (const user of users) {
    try {
      const visibleClients = await filterClientsByUser(liveClients, user.id, user.role)

      const sliceKey = user.role === "admin" ? "_all" : userCmName.get(user.id) ?? "_all"
      const sliceHistory: Record<string, { action: number; watch: number; good: number }> = {}
      for (const [date, snapshot] of Object.entries(scoreHistory)) {
        if (snapshot[sliceKey]) sliceHistory[date] = snapshot[sliceKey]
      }
      const sevenDayAvgScore = computeSevenDayAvgScore(sliceHistory, today)

      const vars = computeWatchlistVars({
        visibleClients,
        kpiMap: kpiCache,
        states,
        today,
        sevenDayAvgScore,
      })
      await sendDmToHubUser(user.id, renderTemplate(template, vars))
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
