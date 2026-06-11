import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { sendSlackDm } from "@/lib/slack"
import { NextResponse } from "next/server"

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
    .select("slack_user_id, email")
    .eq("id", session.user.id)
    .single()

  if (!user?.slack_user_id) {
    return NextResponse.json(
      {
        ok: false,
        message: "No Slack user ID set for your Hub account. Add it in Settings → Users.",
      },
      { status: 400 },
    )
  }

  try {
    await sendSlackDm(
      user.slack_user_id,
      `👋 Hello van de Rocket Leads Hub!\n\nDe Slack integratie werkt - dit DM is verstuurd naar Slack user \`${user.slack_user_id}\` (Hub account ${user.email}).`,
    )
    return NextResponse.json({ ok: true, message: "DM sent - check your Slack." })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Failed to send" },
      { status: 500 },
    )
  }
}
