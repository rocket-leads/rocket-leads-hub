import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { getUserPrimaryChannels } from "@/lib/inbox/user-prefs"

/**
 * GET /api/inbox/default-channels
 *
 * The logged-in user's primary/personal outbound channels (email + WhatsApp),
 * used to pre-select the channel in the "New message" composer so an AM lands
 * on their own personal line by default. Roy 2026-07-30.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { primaryEmailChannelId, primaryWaChannelId } = await getUserPrimaryChannels(
    session.user.id,
  )
  return NextResponse.json({ email: primaryEmailChannelId, whatsapp: primaryWaChannelId })
}
