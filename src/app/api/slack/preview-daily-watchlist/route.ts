import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { filterClientsByUser } from "@/lib/clients/filter"
import { readCache } from "@/lib/cache"
import { sendDmToHubUser } from "@/lib/slack"
import {
  computeSevenDayAvgScore,
  computeWatchlistVars,
  type ClientState,
} from "@/lib/slack/watchlist-summary"
import {
  DEFAULT_TEMPLATES,
  getNotificationConfig,
  renderTemplate,
} from "@/lib/slack/notification-config"
import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"

type ScoreHistory = Record<string, Record<string, { action: number; watch: number; good: number }>>

/**
 * Admin-triggered: send the daily watchlist change summary right now, to the
 * calling user only. Useful for testing message format without waiting for the
 * 06:00 cron - and without spamming the team during dev.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 })
  }
  if ((session.user as { role?: string })?.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Admin only" }, { status: 403 })
  }

  // Optional `template` in the body lets the Settings UI preview unsaved edits.
  let bodyTemplate: string | undefined
  try {
    const body = (await req.json().catch(() => ({}))) as { template?: unknown }
    if (typeof body.template === "string" && body.template.length > 0) bodyTemplate = body.template
  } catch {
    // No body - fine
  }

  const supabase = await createAdminClient()
  const { data: user } = await supabase
    .from("users")
    .select("id, name, role, slack_user_id")
    .eq("id", session.user.id)
    .single()

  if (!user?.slack_user_id) {
    return NextResponse.json(
      { ok: false, message: "No Slack user ID set for your account. Set it in Settings → Users." },
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

  const { data: cmMapping } = await supabase
    .from("user_column_mappings")
    .select("monday_person_name")
    .eq("user_id", user.id)
    .eq("monday_column_role", "campaign_manager")
    .maybeSingle()

  const sliceKey = user.role === "admin" ? "_all" : cmMapping?.monday_person_name ?? "_all"
  const sliceHistory: Record<string, { action: number; watch: number; good: number }> = {}
  for (const [date, snapshot] of Object.entries(scoreHistory)) {
    if (snapshot[sliceKey]) sliceHistory[date] = snapshot[sliceKey]
  }

  const today = new Date().toISOString().slice(0, 10)
  const sevenDayAvgScore = computeSevenDayAvgScore(sliceHistory, today)

  const visibleClients = await filterClientsByUser(liveClients, user.id, user.role)
  const vars = computeWatchlistVars({
    visibleClients,
    kpiMap: kpiCache,
    states,
    today,
    sevenDayAvgScore,
  })
  const config = await getNotificationConfig("personal_watchlist")
  const template = bodyTemplate ?? config.template ?? DEFAULT_TEMPLATES.personal_watchlist
  const message = renderTemplate(template, vars)

  try {
    await sendDmToHubUser(user.id, message)
    return NextResponse.json({
      ok: true,
      message: `Daily summary sent - covering ${visibleClients.length} live clients.`,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Failed to send" },
      { status: 500 },
    )
  }
}
