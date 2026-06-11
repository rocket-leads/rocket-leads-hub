import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSlackChannels } from "@/lib/slack"
import { getNotificationConfig, shouldRunNow } from "@/lib/slack/notification-config"

/**
 * Admin-only diagnostic for the team-sales cron. Returns exactly what the cron
 * would decide RIGHT NOW - config, time-window check, channel resolution - so
 * we can pinpoint why a daily post failed without trawling Vercel logs.
 *
 * GET /api/slack/diagnose-team-sales
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 })
  }
  if ((session.user as { role?: string })?.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Admin only" }, { status: 403 })
  }

  const config = await getNotificationConfig("team_sales")
  const guard = shouldRunNow(config, false)
  const guardForced = shouldRunNow(config, true)
  const channels = await getSlackChannels()

  const nowAmsterdam = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    dateStyle: "short",
    timeStyle: "long",
  }).format(new Date())

  return NextResponse.json({
    nowAmsterdam,
    config: {
      enabled: config.enabled,
      hour: config.hour,
      hasCustomTemplate: config.template != null,
    },
    timeGuard: {
      wouldFireNow: guard.ok,
      reason: guard.reason ?? "ok",
    },
    forceGuard: {
      wouldFireForced: guardForced.ok,
      reason: guardForced.reason ?? "ok",
    },
    channels: {
      teamWatchlist: channels.team_watchlist ?? null,
      sales: channels.sales ?? null,
    },
    salesChannelConfigured: !!channels.sales,
  })
}
