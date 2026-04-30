import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { filterClientsByUser } from "@/lib/clients/filter"
import { readCache } from "@/lib/cache"
import { sendDmToHubUser } from "@/lib/slack"
import { buildWatchlistSummary } from "@/lib/slack/watchlist-summary"
import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"

/**
 * Admin-triggered: send the daily watchlist summary right now, to the calling
 * user only. Useful for testing the message format without waiting for the
 * 06:00 cron — and without spamming the whole team during dev.
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 })
  }
  if ((session.user as { role?: string })?.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Admin only" }, { status: 403 })
  }

  const supabase = await createAdminClient()
  const { data: user } = await supabase
    .from("users")
    .select("id, name, role, slack_user_id")
    .eq("id", session.user.id)
    .single()

  if (!user?.slack_user_id) {
    return NextResponse.json(
      { ok: false, message: "No Slack user ID set for your account. Add it in Column Mapping." },
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
  const visible = await filterClientsByUser(liveClients, user.id, user.role)
  const message = buildWatchlistSummary(visible, kpiCache, user.name)

  try {
    await sendDmToHubUser(user.id, message)
    return NextResponse.json({
      ok: true,
      message: `Daily summary sent to your Slack — covering ${visible.length} live clients.`,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Failed to send" },
      { status: 500 },
    )
  }
}
