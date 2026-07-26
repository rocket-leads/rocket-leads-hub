import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getTeamAvatarMap } from "@/lib/team/avatar-map"

/**
 * name (lower-cased) → uploaded avatar URL for every teammate with a photo.
 * Consumed by the Watch List + Clients table to show AM/CM profile pictures.
 * Cheap + rarely changes, so it's served with a generous SWR window.
 */
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const avatars = await getTeamAvatarMap()
  return NextResponse.json(
    { avatars },
    { headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=3600" } },
  )
}
