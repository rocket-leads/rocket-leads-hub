import { auth } from "@/lib/auth"
import { getInboxBadgeCounts } from "@/lib/inbox/fetchers"
import { NextResponse } from "next/server"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const counts = await getInboxBadgeCounts(
    session.user.id,
    session.user.role ?? "member",
  )
  return NextResponse.json(counts)
}
