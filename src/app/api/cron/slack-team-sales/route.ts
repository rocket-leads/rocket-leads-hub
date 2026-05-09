import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getSlackChannels, sendDmToHubUser, sendSlackChannelMessage } from "@/lib/slack"
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
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import type { TargetsConfig } from "@/types/targets"

export const maxDuration = 60

const TAG = "[cron/slack-team-sales]"

/**
 * DM each admin Hub user a heads-up when the cron is supposed to fire but can't.
 * Misconfigured channel / Slack outage / Monday outage all silently broke the daily
 * post before — now Roy + admins get pinged so it can't go unnoticed.
 */
async function alertAdmins(reason: string) {
  try {
    const supabase = await createAdminClient()
    const { data: admins } = await supabase
      .from("users")
      .select("id, slack_user_id")
      .eq("role", "admin")
      .not("slack_user_id", "is", null)
    if (!admins?.length) return
    const text = `:warning: *Sales team Slack notification skipped*\n${reason}\n\n_(Settings → Notifications)_`
    await Promise.allSettled(admins.map((a) => sendDmToHubUser(a.id, text)))
  } catch (err) {
    console.error(TAG, "alertAdmins failed:", err)
  }
}

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const force = authz.forcedByAdmin || url.searchParams.get("force") === "1"

  const tracker = startCronRun("slack-team-sales")

  const config = await getNotificationConfig("team_sales")
  const guard = shouldRunNow(config, force)
  if (!guard.ok) {
    // Hour mismatches are normal (the cron fires hourly, only one hour matches).
    // Disabled-in-settings is also normal. Both are info-level skips, not errors.
    console.log(TAG, "skipped:", guard.reason, "config:", JSON.stringify(config))
    await tracker.ok({ skipped: guard.reason })
    return NextResponse.json({ ok: true, skipped: guard.reason, config })
  }
  console.log(TAG, "proceeding — config:", JSON.stringify(config))

  const channels = await getSlackChannels()
  const SALES_CHANNEL_ID = channels.sales
  if (!SALES_CHANNEL_ID) {
    const reason = "Sales channel ID not configured. Set it in Settings → Notifications."
    console.error(TAG, reason)
    void alertAdmins(reason)
    await tracker.fail(new Error(reason))
    return NextResponse.json({ ok: false, error: reason }, { status: 500 })
  }
  console.log(TAG, "sales channel resolved:", SALES_CHANNEL_ID)

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
    console.log(TAG, `fetched ${items.length} Monday items`)
  } catch (e) {
    const reason = `Failed to load Monday items: ${e instanceof Error ? e.message : String(e)}`
    console.error(TAG, reason)
    void alertAdmins(reason)
    await tracker.fail(e)
    return NextResponse.json({ ok: false, error: reason }, { status: 500 })
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
    console.log(TAG, `posted to ${SALES_CHANNEL_ID} for ${perCloser.length} closers`)
    await tracker.ok({ channel: SALES_CHANNEL_ID, closers: perCloser.length })
    return NextResponse.json({ ok: true, channel: SALES_CHANNEL_ID, closers: perCloser.length })
  } catch (e) {
    const reason = `Slack post failed (channel ${SALES_CHANNEL_ID}): ${e instanceof Error ? e.message : String(e)}. Common cause: bot isn't a member — invite it via /invite @Rocket Leads Hub.`
    console.error(TAG, reason)
    void alertAdmins(reason)
    await tracker.fail(e)
    return NextResponse.json({ ok: false, error: reason }, { status: 500 })
  }
}
