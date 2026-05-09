import { NextRequest, NextResponse } from "next/server"
import { runInboxAutomations } from "@/lib/inbox/automations"
import { startCronRun } from "@/lib/observability/cron-runs"

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tracker = startCronRun("inbox-automations")
  try {
    const result = await runInboxAutomations()
    await tracker.ok(result as Record<string, unknown>)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    await tracker.fail(error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
