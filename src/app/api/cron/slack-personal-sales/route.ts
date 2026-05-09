import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { sendSlackDm } from "@/lib/slack"
import {
  computeCloserMetrics,
  computeCloserSalesVars,
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

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const force = authz.forcedByAdmin || url.searchParams.get("force") === "1"

  const tracker = startCronRun("slack-personal-sales")

  const config = await getNotificationConfig("personal_sales")
  const guard = shouldRunNow(config, force)
  if (!guard.ok) {
    await tracker.ok({ skipped: guard.reason })
    return NextResponse.json({ ok: true, skipped: guard.reason })
  }

  const supabase = await createAdminClient()

  const { data: mappingRows, error: mappingErr } = await supabase
    .from("closer_slack_mappings")
    .select("monday_person_name, slack_user_id")
  if (mappingErr) {
    await tracker.fail(new Error(mappingErr.message))
    return NextResponse.json({ ok: false, error: mappingErr.message }, { status: 500 })
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
    await tracker.fail(e)
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

  const mappingByName = new Map<string, string>()
  for (const m of mappingRows ?? []) mappingByName.set(m.monday_person_name, m.slack_user_id)

  const template = config.template ?? DEFAULT_TEMPLATES.personal_sales

  let dmsSent = 0
  let dmsFailed = 0
  const errors: Array<{ closer: string; error: string }> = []
  for (const closer of closerNames) {
    const slackId = mappingByName.get(closer)
    if (!slackId) continue
    const metrics = computeCloserMetrics(items, closer, today, yesterday, mStart)
    const vars = computeCloserSalesVars({ metrics, targets, yesterday, monthLabel: mLabel })
    const message = renderTemplate(template, vars)
    try {
      await sendSlackDm(slackId, message)
      dmsSent++
    } catch (e) {
      dmsFailed++
      errors.push({ closer, error: e instanceof Error ? e.message : String(e) })
      console.error(`[slack-personal-sales] DM failed for ${closer}`, e)
    }
  }

  const summary = {
    today,
    closersTotal: closerNames.size,
    mapped: mappingByName.size,
    dmsSent,
    dmsFailed,
  }
  if (dmsFailed > 0) {
    await tracker.partial(`${dmsFailed} DMs failed`, summary)
  } else {
    await tracker.ok(summary)
  }
  return NextResponse.json({
    ok: true,
    ...summary,
    errors: errors.slice(0, 10),
  })
}
