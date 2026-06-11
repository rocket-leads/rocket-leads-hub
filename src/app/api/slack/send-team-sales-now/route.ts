import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { getSlackChannels, sendSlackChannelMessage } from "@/lib/slack"
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
 * Admin-only "send now" - posts the team-sales summary to the sales channel
 * RIGHT NOW, bypassing the time-of-day guard. Same data + template as the
 * scheduled cron so what gets posted matches what the cron would post when
 * it next fires. Use cases: missed cron, manual re-send after fixing config.
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
    // No body - fine
  }

  const channels = await getSlackChannels()
  const SALES_CHANNEL_ID = channels.sales
  if (!SALES_CHANNEL_ID) {
    return NextResponse.json(
      { ok: false, message: "Sales channel ID not configured. Set it in Settings → Notifications." },
      { status: 400 },
    )
  }

  const supabase = await createAdminClient()
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

  const vars = computeTeamSalesVars({ perCloser, targets, monthLabel: mLabel, today })
  const config = await getNotificationConfig("team_sales")
  const template = bodyTemplate ?? config.template ?? DEFAULT_TEMPLATES.team_sales
  const message = renderTemplate(template, vars)

  try {
    await sendSlackChannelMessage(SALES_CHANNEL_ID, message)
    return NextResponse.json({
      ok: true,
      message: `Sent to <#${SALES_CHANNEL_ID}> for ${perCloser.length} closers.`,
    })
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        message:
          e instanceof Error
            ? `Slack post failed: ${e.message}. Common cause: bot isn't a member - invite via /invite @Rocket Leads Hub.`
            : "Failed to send",
      },
      { status: 500 },
    )
  }
}
