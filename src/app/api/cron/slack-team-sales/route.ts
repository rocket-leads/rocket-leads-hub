import { NextRequest, NextResponse } from "next/server"
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
  shouldRunNow,
} from "@/lib/slack/notification-config"
import type { TargetsConfig } from "@/types/targets"

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const force = url.searchParams.get("force") === "1"

  const config = await getNotificationConfig("team_sales")
  const guard = shouldRunNow(config, force)
  if (!guard.ok) {
    return NextResponse.json({ ok: true, skipped: guard.reason })
  }

  const channels = await getSlackChannels()
  const SALES_CHANNEL_ID = channels.sales
  if (!SALES_CHANNEL_ID) {
    return NextResponse.json(
      { ok: false, error: "Sales channel ID not configured. Set it in Settings → Notifications." },
      { status: 500 },
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
      { ok: false, error: e instanceof Error ? e.message : "Failed to load Monday items" },
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
  const template = config.template ?? DEFAULT_TEMPLATES.team_sales
  const message = renderTemplate(template, vars)

  try {
    await sendSlackChannelMessage(SALES_CHANNEL_ID, message)
    return NextResponse.json({ ok: true, channel: SALES_CHANNEL_ID, closers: perCloser.length })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to send" },
      { status: 500 },
    )
  }
}
