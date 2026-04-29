import { auth } from "@/lib/auth"
import { sendDmToEmail } from "@/lib/slack"
import { NextResponse } from "next/server"

export async function POST() {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 })
  }
  if ((session.user as { role?: string })?.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Admin only" }, { status: 403 })
  }

  try {
    const { slackUserId } = await sendDmToEmail(
      session.user.email,
      `👋 Hello van de Rocket Leads Hub!\n\nDe Slack integratie werkt — dit DM is verstuurd vanuit het dashboard naar ${session.user.email}.`,
    )
    return NextResponse.json({
      ok: true,
      message: `DM sent — check your Slack. (user ${slackUserId})`,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Failed to send" },
      { status: 500 },
    )
  }
}
