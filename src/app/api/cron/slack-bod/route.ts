import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getSlackChannels, sendDmToHubUser, sendSlackChannelMessage } from "@/lib/slack"
import { buildBodMessage } from "@/lib/slack/bod"
import { getNotificationConfig, shouldRunNow } from "@/lib/slack/notification-config"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"

// Marketing/Sales funnel comes from the warm targets cache, but a cold fallback
// pages the whole targets board (plus today's appointments always reads live),
// so give it the same generous budget as the targets warmer.
export const maxDuration = 300

const TAG = "[cron/slack-bod]"

/**
 * DM each admin Hub user a heads-up when the cron is supposed to fire but can't.
 * A misconfigured channel / Slack outage / Monday outage would otherwise silently
 * break the daily Beginning-of-Day post.
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
    const text = `:warning: *Beginning-of-Day Slack post skipped*\n${reason}\n\n_(Settings → Notifications)_`
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

  const tracker = startCronRun("slack-bod")

  const config = await getNotificationConfig("bod")
  const guard = shouldRunNow(config, force)
  if (!guard.ok) {
    console.log(TAG, "skipped:", guard.reason, "config:", JSON.stringify(config))
    await tracker.ok({ skipped: guard.reason })
    return NextResponse.json({ ok: true, skipped: guard.reason, config })
  }
  console.log(TAG, "proceeding - config:", JSON.stringify(config))

  const channels = await getSlackChannels()
  const BOD_CHANNEL_ID = channels.bod
  if (!BOD_CHANNEL_ID) {
    const reason = "BOD channel ID not configured. Set it in Settings → Notifications."
    console.error(TAG, reason)
    void alertAdmins(reason)
    await tracker.fail(new Error(reason))
    return NextResponse.json({ ok: false, error: reason }, { status: 500 })
  }
  console.log(TAG, "bod channel resolved:", BOD_CHANNEL_ID)

  let built
  try {
    built = await buildBodMessage()
  } catch (e) {
    const reason = `Failed to build BOD message: ${e instanceof Error ? e.message : String(e)}`
    console.error(TAG, reason)
    void alertAdmins(reason)
    await tracker.fail(e)
    return NextResponse.json({ ok: false, error: reason }, { status: 500 })
  }

  try {
    await sendSlackChannelMessage(BOD_CHANNEL_ID, built.message)
    console.log(TAG, `posted to ${BOD_CHANNEL_ID} (${built.closerCount} closers, ${built.appointmentCount} appts)`)
    await tracker.ok({ channel: BOD_CHANNEL_ID, closers: built.closerCount, appointments: built.appointmentCount })
    return NextResponse.json({ ok: true, channel: BOD_CHANNEL_ID, closers: built.closerCount, appointments: built.appointmentCount })
  } catch (e) {
    const reason = `Slack post failed (channel ${BOD_CHANNEL_ID}): ${e instanceof Error ? e.message : String(e)}. Common cause: bot isn't a member - invite it via /invite @Rocket Leads Hub.`
    console.error(TAG, reason)
    void alertAdmins(reason)
    await tracker.fail(e)
    return NextResponse.json({ ok: false, error: reason }, { status: 500 })
  }
}
