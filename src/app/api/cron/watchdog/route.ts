import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { EXPECTED_CRONS } from "@/lib/crons"
import { sendSlackDm } from "@/lib/slack"

/**
 * Cron watchdog — runs every 15 min. Alerts admins on Slack when:
 *   1. The latest run of any expected cron has status `error` (failure)
 *   2. A cron hasn't run for >1.5× its cadenceMinutes (stuck / scheduler
 *      dead / dependency timeout, depending on the cron)
 *
 * Dedupe via `cron_alert_state`: one alert per (cron, started_at). When
 * a cron flaps (fails → recovers → fails again), the new `started_at`
 * makes it past the dedupe and re-alerts. Stuck-cron alerts dedupe by
 * pinning to the last successful started_at we saw — once a cron starts
 * ticking again, that timestamp updates and the next stuck detection
 * re-alerts.
 *
 * Vercel cron scheduling lives in `vercel.json` (every 15 min). Locally
 * you can hit `/api/cron/watchdog?secret=<CRON_SECRET>` to dry-run.
 */
export const dynamic = "force-dynamic"

type LatestRun = {
  cron_name: string
  status: "ok" | "error" | "partial"
  started_at: string
  error_message: string | null
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-cron-secret")
  if (process.env.CRON_SECRET && provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const supabase = await createAdminClient()
  const now = Date.now()

  // Latest run per expected cron, in one query. Iteration order = desc
  // started_at, so the first hit per name is the latest.
  const { data: cronRows, error: cronError } = await supabase
    .from("cron_runs")
    .select("cron_name, status, started_at, error_message")
    .order("started_at", { ascending: false })
    .limit(500)
  if (cronError) {
    return NextResponse.json({ error: cronError.message }, { status: 500 })
  }
  const latestByCron = new Map<string, LatestRun>()
  for (const row of (cronRows ?? []) as LatestRun[]) {
    if (!latestByCron.has(row.cron_name)) latestByCron.set(row.cron_name, row)
  }

  // Existing alert state — used to skip duplicate alerts.
  const { data: stateRows } = await supabase
    .from("cron_alert_state")
    .select("cron_name, last_started_at, last_alert_kind")
  const stateByName = new Map(
    (stateRows ?? []).map((s) => [s.cron_name, s as { cron_name: string; last_started_at: string | null; last_alert_kind: string | null }]),
  )

  // Admin recipients with a connected Slack ID.
  const { data: admins } = await supabase
    .from("users")
    .select("id, name, email, slack_user_id, role")
    .eq("role", "admin")
  const slackTargets = (admins ?? []).filter((a) => a.slack_user_id)

  const alerts: Array<{ cron: string; kind: "failed" | "stuck"; text: string; started_at: string | null }> = []

  for (const expected of EXPECTED_CRONS) {
    const last = latestByCron.get(expected.name)
    const state = stateByName.get(expected.name)
    const stuckCutoff = new Date(now - 1.5 * expected.cadenceMinutes * 60 * 1000)

    if (!last) {
      // Brand-new cron with no runs yet → not an alert (the Health tab
      // surfaces "Never ran" already). Skip.
      continue
    }

    if (last.status === "error") {
      const alreadyAlerted = state?.last_started_at === last.started_at && state?.last_alert_kind === "failed"
      if (!alreadyAlerted) {
        alerts.push({
          cron: expected.name,
          kind: "failed",
          started_at: last.started_at,
          text: `🚨 *Cron failed* — \`${expected.name}\`\n${expected.description}\nError: ${last.error_message ?? "(no message)"}`,
        })
      }
      continue
    }

    if (last.status === "ok" && new Date(last.started_at) < stuckCutoff) {
      const alreadyAlerted = state?.last_started_at === last.started_at && state?.last_alert_kind === "stuck"
      if (!alreadyAlerted) {
        const mins = Math.round((now - new Date(last.started_at).getTime()) / 60000)
        alerts.push({
          cron: expected.name,
          kind: "stuck",
          started_at: last.started_at,
          text: `⏰ *Cron stuck* — \`${expected.name}\` hasn't run in ${mins} min (expected every ~${expected.cadenceMinutes} min).\n${expected.description}`,
        })
      }
    }
  }

  // Fan out alerts to every admin with Slack. Failures here don't fail
  // the cron — we log + continue so a single bad DM doesn't take the
  // watchdog out for the next 15 min.
  let dmsSent = 0
  for (const alert of alerts) {
    for (const admin of slackTargets) {
      try {
        await sendSlackDm(admin.slack_user_id as string, alert.text)
        dmsSent++
      } catch (e) {
        console.error("[watchdog] DM failed:", admin.email, e instanceof Error ? e.message : e)
      }
    }
    await supabase.from("cron_alert_state").upsert({
      cron_name: alert.cron,
      last_started_at: alert.started_at,
      last_alert_kind: alert.kind,
      last_alerted_at: new Date().toISOString(),
    })
  }

  // Log to cron_runs so the Health tab shows the watchdog itself.
  await supabase.from("cron_runs").insert({
    cron_name: "watchdog",
    status: "ok",
    started_at: new Date(now).toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - now,
    metrics: { alerts: alerts.length, dmsSent, admins: slackTargets.length },
  })

  return NextResponse.json({ alerts: alerts.length, dmsSent, detail: alerts })
}
