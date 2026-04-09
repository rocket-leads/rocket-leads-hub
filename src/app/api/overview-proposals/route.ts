import { auth } from "@/lib/auth"
import { readCache } from "@/lib/cache"
import { NextResponse } from "next/server"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const cached = await readCache<Record<string, { type: string; title: string }>>("overview_proposals")
  return NextResponse.json(cached ?? {})
}
