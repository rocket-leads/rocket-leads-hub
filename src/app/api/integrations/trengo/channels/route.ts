import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { fetchTrengoChannels } from "@/lib/integrations/trengo"

/**
 * GET /api/integrations/trengo/channels
 *
 * Returns the list of channels in the Rocket Leads Trengo workspace, used by
 * the per-user channel subscription picker on /account. Auth required so we
 * don't leak channel metadata to anonymous callers; no role gate beyond that
 * since every Hub user can pick their own subscriptions.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const channels = await fetchTrengoChannels()
    return NextResponse.json({ channels })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load Trengo channels" },
      { status: 500 },
    )
  }
}
