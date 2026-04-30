import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { sendDmToHubUser } from "@/lib/slack"
import {
  computeCloserMetrics,
  computeTeamSalesVars,
} from "@/lib/slack/sales-summary"
import {
  fetchRawTargetsItems,
  amsterdamToday,
  shiftDate,
  monthStart,
  monthLabel,
} from "@/lib/slack/sales-fetcher"
import {
  DEFAULT_TEMPLATES,
  getNotificationConfig,
  renderTemplate,
} from "@/lib/slack/notification-config"
import type { TargetsConfig } from "@/types/targets"

export const maxDuration = 60

/**
 * Admin-triggered preview of the team sales channel summary. Posts to the
 * caller's own DM (not the team channel) so format can be reviewed without
 * spamming everyone. Same builder + data as the production cron.
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

  const { data: cfgRow } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "targets_config")
    .single()
  const targets = (cfgRow?.value ?? null) as TargetsConfig | null

  let items
  try {
    items = await fetchRawTargetsItems()
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Failed to load Monday items" },
      { status: 500 },
    )
  }

  const today = amsterdamToday()
  const yesterday = shiftDate(today, -1)
  const mStart = monthStart(today)
  const mLabel = monthLabel(today)

  const closerNames = new Set<string>()
  for (const item of items) if (item.closer) closerNames.add(item.closer)
  const perCloser = Array.from(closerNames).map((name) =>
    computeCloserMetrics(items, name, today, yesterday, mStart),
  )

  const vars = computeTeamSalesVars({
    perCloser,
    targets,
    monthLabel: mLabel,
    today,
  })
  const config = await getNotificationConfig("team_sales")
  const template = bodyTemplate ?? config.template ?? DEFAULT_TEMPLATES.team_sales
  const message = renderTemplate(template, vars)

  try {
    await sendDmToHubUser(
      user.id,
      `_(team sales channel preview — sent to you only, not to the channel)_\n\n${message}`,
    )
    return NextResponse.json({
      ok: true,
      message: `Team sales preview sent to your DM — covering ${perCloser.length} closers.`,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Failed to send" },
      { status: 500 },
    )
  }
}
