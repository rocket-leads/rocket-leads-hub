import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { readCache } from "@/lib/cache"
import { getSlackChannels, sendSlackChannelMessage } from "@/lib/slack"
import { computeSevenDayAvgScore, type ClientState } from "@/lib/slack/watchlist-summary"
import { computeTeamWatchlistVars } from "@/lib/slack/team-watchlist-summary"
import {
  DEFAULT_TEMPLATES,
  getNotificationConfig,
  renderTemplate,
  shouldRunNow,
} from "@/lib/slack/notification-config"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import type { MondayClient } from "@/lib/integrations/monday"
import type { DeliveryOverview } from "@/types/targets"

export const maxDuration = 60

type ScoreHistory = Record<string, Record<string, { action: number; watch: number; good: number }>>

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const force = authz.forcedByAdmin || url.searchParams.get("force") === "1"

  const config = await getNotificationConfig("team_watchlist")
  const guard = shouldRunNow(config, force)
  if (!guard.ok) {
    return NextResponse.json({ ok: true, skipped: guard.reason })
  }

  const channels = await getSlackChannels()
  const TEAM_CHANNEL_ID = channels.team_watchlist
  if (!TEAM_CHANNEL_ID) {
    return NextResponse.json(
      { ok: false, error: "Team watchlist channel ID not configured. Set it in Settings → Notifications." },
      { status: 500 },
    )
  }

  const supabase = await createAdminClient()

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

  const scoreHistory = (await readCache<ScoreHistory>("watchlist_score_history")) ?? {}
  const sliceHistory: Record<string, { action: number; watch: number; good: number }> = {}
  for (const [date, snapshot] of Object.entries(scoreHistory)) {
    if (snapshot._all) sliceHistory[date] = snapshot._all
  }

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
  const sevenDayAvgScore = computeSevenDayAvgScore(sliceHistory, today)

  const delivery = await readCache<DeliveryOverview>("targets_delivery_v3")
  const byAccountManager = delivery?.byAccountManager ?? []

  const vars = computeTeamWatchlistVars({
    liveClients,
    states,
    byAccountManager,
    today,
    sevenDayAvgScore,
  })
  const template = config.template ?? DEFAULT_TEMPLATES.team_watchlist
  const message = renderTemplate(template, vars)

  try {
    await sendSlackChannelMessage(TEAM_CHANNEL_ID, message)
    return NextResponse.json({
      ok: true,
      channel: TEAM_CHANNEL_ID,
      clientCount: liveClients.length,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to send" },
      { status: 500 },
    )
  }
}
