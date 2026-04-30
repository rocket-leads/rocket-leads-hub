import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { readCache } from "@/lib/cache"
import { sendDmToHubUser } from "@/lib/slack"
import { computeSevenDayAvgScore, type ClientState } from "@/lib/slack/watchlist-summary"
import { computeTeamWatchlistVars } from "@/lib/slack/team-watchlist-summary"
import {
  DEFAULT_TEMPLATES,
  getNotificationConfig,
  renderTemplate,
} from "@/lib/slack/notification-config"
import type { MondayClient } from "@/lib/integrations/monday"
import type { DeliveryOverview } from "@/types/targets"

type ScoreHistory = Record<string, Record<string, { action: number; watch: number; good: number }>>

/**
 * Admin-triggered preview of the team-wide channel summary. Posts to the
 * caller's own DM (not the team channel) so format can be reviewed without
 * spamming everyone. Same data + helper as the production cron.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 })
  }
  if ((session.user as { role?: string })?.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Admin only" }, { status: 403 })
  }

  let bodyTemplate: string | undefined
  try {
    const body = (await req.json().catch(() => ({}))) as { template?: unknown }
    if (typeof body.template === "string" && body.template.length > 0) bodyTemplate = body.template
  } catch {
    // No body — fine
  }

  const supabase = await createAdminClient()
  const { data: user } = await supabase
    .from("users")
    .select("id, slack_user_id")
    .eq("id", session.user.id)
    .single()

  if (!user?.slack_user_id) {
    return NextResponse.json(
      { ok: false, message: "No Slack user ID set for your account. Add it in Column Mapping." },
      { status: 400 },
    )
  }

  let liveClients: MondayClient[]
  try {
    const cached = await readCache<{ current: MondayClient[] }>("monday_boards")
    const data = cached ?? (await fetchBothBoards())
    liveClients = data.current.filter((c) => c.campaignStatus === "Live")
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Failed to load clients" },
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

  const delivery = await readCache<DeliveryOverview>("targets_delivery_v2")
  const byAccountManager = delivery?.byAccountManager ?? []

  const vars = computeTeamWatchlistVars({
    liveClients,
    states,
    byAccountManager,
    today,
    sevenDayAvgScore,
  })
  const config = await getNotificationConfig("team_watchlist")
  const template = bodyTemplate ?? config.template ?? DEFAULT_TEMPLATES.team_watchlist
  const message = renderTemplate(template, vars)

  try {
    await sendDmToHubUser(
      user.id,
      `_(team-channel preview — sent to you only, not to the channel)_\n\n${message}`,
    )
    return NextResponse.json({
      ok: true,
      message: `Team summary preview sent to your DM — covering ${liveClients.length} live clients.`,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Failed to send" },
      { status: 500 },
    )
  }
}
