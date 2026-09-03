import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getSlackChannels, sendDmToHubUser, sendSlackChannelMessage } from "@/lib/slack"
import { buildTargetsTrackerMessage } from "@/lib/slack/targets-tracker"
import { getNotificationConfig, shouldRunNow } from "@/lib/slack/notification-config"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"

// Reads the warm MTD caches (marketing_monday + delivery); a cold fallback pages
// the board + Stripe, so give it the generous targets budget.
export const maxDuration = 300

const TAG = "[cron/slack-targets]"

/** DM admins when the cron can't post so a broken config / outage isn't silent. */
async function alertAdmins(reason: string) {
  try {
    const supabase = await createAdminClient()
    const { data: admins } = await supabase
      .from("users")
      .select("id, slack_user_id")
      .eq("role", "admin")
      .not("slack_user_id", "is", null)
    if (!admins?.length) return
    const text = `:warning: *Targets Tracker Slack post skipped*\n${reason}\n\n_(Settings → Notifications)_`
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

  const tracker = startCronRun("slack-targets")

  const config = await getNotificationConfig("targets")
  const guard = shouldRunNow(config, force)
  if (!guard.ok) {
    console.log(TAG, "skipped:", guard.reason, "config:", JSON.stringify(config))
    await tracker.ok({ skipped: guard.reason })
    return NextResponse.json({ ok: true, skipped: guard.reason, config })
  }
  console.log(TAG, "proceeding - config:", JSON.stringify(config))

  const channels = await getSlackChannels()
  const TARGETS_CHANNEL_ID = channels.targets
  if (!TARGETS_CHANNEL_ID) {
    const reason = "Targets channel ID not configured. Set it in Settings → Notifications."
    console.error(TAG, reason)
    void alertAdmins(reason)
    await tracker.fail(new Error(reason))
    return NextResponse.json({ ok: false, error: reason }, { status: 500 })
  }
  console.log(TAG, "targets channel resolved:", TARGETS_CHANNEL_ID)

  let built
  try {
    built = await buildTargetsTrackerMessage()
  } catch (e) {
    const reason = `Failed to build Targets Tracker message: ${e instanceof Error ? e.message : String(e)}`
    console.error(TAG, reason)
    void alertAdmins(reason)
    await tracker.fail(e)
    return NextResponse.json({ ok: false, error: reason }, { status: 500 })
  }

  try {
    await sendSlackChannelMessage(TARGETS_CHANNEL_ID, built.message)
    console.log(TAG, `posted to ${TARGETS_CHANNEL_ID}`)
    await tracker.ok({ channel: TARGETS_CHANNEL_ID })
    return NextResponse.json({ ok: true, channel: TARGETS_CHANNEL_ID })
  } catch (e) {
    const reason = `Slack post failed (channel ${TARGETS_CHANNEL_ID}): ${e instanceof Error ? e.message : String(e)}. Common cause: bot isn't a member - invite it via /invite @Rocket Leads Hub.`
    console.error(TAG, reason)
    void alertAdmins(reason)
    await tracker.fail(e)
    return NextResponse.json({ ok: false, error: reason }, { status: 500 })
  }
}
