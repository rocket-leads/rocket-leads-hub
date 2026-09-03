import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { sendDmToHubUser } from "@/lib/slack"
import { buildEodMessage } from "@/lib/slack/eod"

export const maxDuration = 300

/**
 * Admin-triggered preview of the End-of-Day channel post. Posts to the caller's
 * own DM (not the EOD channel) so the format can be reviewed without spamming
 * the team. Same builder + data as the production cron.
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
    // No body - fine
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

  let built
  try {
    built = await buildEodMessage(bodyTemplate)
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Failed to build EOD message" },
      { status: 500 },
    )
  }

  try {
    await sendDmToHubUser(
      user.id,
      `_(EOD channel preview - sent to you only, not to the channel)_\n\n${built.message}`,
    )
    return NextResponse.json({
      ok: true,
      message: `EOD preview sent to your DM - ${built.closerCount} closers, ${built.appointmentCount} appointments tomorrow.`,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Failed to send" },
      { status: 500 },
    )
  }
}
