import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listAdSourceScreenshots } from "@/lib/integrations/pedro-image-storage"

/**
 * GET /api/pedro/ad-source-screenshot/[clientId]
 *
 * Returns the full map of ads (in this client) that have a manual
 * screenshot uploaded → { signedUrl, storagePath }. Used by AdPicker
 * on mount so the CM ziet meteen welke ads al een upload hebben.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { clientId } = await params
  if (!clientId) {
    return NextResponse.json({ error: "clientId verplicht" }, { status: 400 })
  }
  const map = await listAdSourceScreenshots(clientId)
  const screenshots: Record<string, { signedUrl: string | null; storagePath: string }> = {}
  for (const [adId, info] of map.entries()) {
    screenshots[adId] = info
  }
  return NextResponse.json({ clientId, screenshots })
}
