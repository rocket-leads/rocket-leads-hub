import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { fetchWaTemplates } from "@/lib/integrations/trengo"

/**
 * GET /api/inbox/wa-templates?channelId=12345
 *
 * Returns the WhatsApp Business templates approved for a specific Trengo
 * channel. Used by the chat-pane composer to populate the Template picker
 * inside the 24h-window-closed (and inside-window opt-in) flow.
 *
 * Filter set: only `status === ACCEPTED` (the others — PENDING/REJECTED —
 * can't be sent so they'd just confuse the picker). Server-side filter via
 * Trengo's own query params keeps the request shape tight; we don't pull
 * the whole workspace pool client-side.
 *
 * Cached 5 minutes by `trengoFetch`'s `next: { revalidate: 300 }` so opening
 * the picker on a hot path is cheap.
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
    const templates = await fetchWaTemplates(channelId)
    return NextResponse.json({ templates })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load templates" },
      { status: 502 },
    )
  }
}
