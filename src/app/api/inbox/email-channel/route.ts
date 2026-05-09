import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { fetchEmailChannelInfo } from "@/lib/integrations/trengo"

/**
 * GET /api/inbox/email-channel?channelId=12345
 *
 * Returns the signature + sender labels for a Trengo email channel. The
 * composer uses this to pre-fill the From dropdown and seed the rich-text
 * body with the channel's signature on open.
 *
 * Source: Trengo's `/channels` endpoint (Phase 0 audit confirmed
 * `emailChannel.signature` is exposed and matches what their UI uses).
 * Cached 5 minutes by `trengoFetch`.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const channelIdParam = req.nextUrl.searchParams.get("channelId")
  const channelId = channelIdParam ? Number(channelIdParam) : NaN
  if (!Number.isFinite(channelId) || channelId <= 0) {
    return NextResponse.json(
      { error: "channelId query param required (positive integer)" },
      { status: 400 },
    )
  }

  try {
    const info = await fetchEmailChannelInfo(channelId)
    if (!info) {
      return NextResponse.json(
        { error: "Channel not found or not an email channel" },
        { status: 404 },
      )
    }
    return NextResponse.json(info)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load channel info" },
      { status: 502 },
    )
  }
}
