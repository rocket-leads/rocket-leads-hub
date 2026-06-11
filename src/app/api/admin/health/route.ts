import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Snapshot of every cron's most recent run, every integration token's
 * validity, and the last 24h of errored runs. Powers the Health tab inside
 * Settings (formerly /settings/health). Admin-only.
 *
 * Shape mirrors what the previous server-rendered page consumed - keep this
 * stable so the client tab stays a thin renderer.
 */
export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const supabase = await createAdminClient()
  const renderNow = Date.now()
  const last24hCutoff = new Date(renderNow - 24 * 60 * 60 * 1000).toISOString()

  const [{ data: cronRows }, { data: tokenRows }, { data: errorRows }] = await Promise.all([
    supabase
      .from("cron_runs")
      .select("cron_name, status, started_at, finished_at, duration_ms, error_message, metrics")
      .order("started_at", { ascending: false })
      .limit(200),
    supabase.from("api_tokens").select("service, is_valid, last_verified"),
    supabase
      .from("cron_runs")
      .select("cron_name, status, started_at, error_message")
      .neq("status", "ok")
      .gte("started_at", last24hCutoff)
      .order("started_at", { ascending: false })
      .limit(50),
  ])

  return NextResponse.json({
    cronRows: cronRows ?? [],
    tokenRows: tokenRows ?? [],
    errorRows: errorRows ?? [],
    renderNow,
  })
}
