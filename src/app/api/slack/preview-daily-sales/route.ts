import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { sendDmToHubUser } from "@/lib/slack"
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
} from "@/lib/slack/notification-config"
import type { TargetsConfig } from "@/types/targets"

export const maxDuration = 60

/**
 * Admin-triggered preview of the personal sales DM. Picks a closer to render
 * for: prefer the calling admin's closer mapping (closer_slack_mappings keyed
 * by their Slack ID); else fall back to the closer with most MTD activity so
 * there's always something to look at.
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

  const { data: mappingRows } = await supabase
    .from("closer_slack_mappings")
    .select("monday_person_name, slack_user_id")

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
  const allMetrics = Array.from(closerNames).map((name) =>
    computeCloserMetrics(items, name, today, yesterday, mStart),
  )

  // Pick the closer to preview — prefer the admin's own mapping, else the most-active.
  const ownMapping = (mappingRows ?? []).find((m) => m.slack_user_id === user.slack_user_id)
  let chosen = ownMapping
    ? allMetrics.find((m) => m.closer === ownMapping.monday_person_name) ?? null
    : null
  if (!chosen) {
    chosen =
      [...allMetrics].sort(
        (a, b) =>
          b.mtd.taken + b.mtd.deals - (a.mtd.taken + a.mtd.deals),
      )[0] ?? null
  }

  if (!chosen) {
    return NextResponse.json(
      { ok: false, message: "No closer activity found in targets board." },
      { status: 404 },
    )
  }

  const vars = computeCloserSalesVars({
    metrics: chosen,
    targets,
    yesterday,
    monthLabel: mLabel,
  })
  const config = await getNotificationConfig("personal_sales")
  const template = bodyTemplate ?? config.template ?? DEFAULT_TEMPLATES.personal_sales
  const message = renderTemplate(template, vars)

  try {
    await sendDmToHubUser(
      user.id,
      `_(personal sales DM preview — rendered for *${chosen.closer}*)_\n\n${message}`,
    )
    return NextResponse.json({
      ok: true,
      message: `Personal sales preview sent to your DM (rendered for ${chosen.closer}).`,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Failed to send" },
      { status: 500 },
    )
  }
}
