import { auth } from "@/lib/auth"
import { fetchMondayUsers } from "@/lib/integrations/monday"
import { NextResponse } from "next/server"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const users = await fetchMondayUsers()
    return NextResponse.json({ users })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load Monday users" },
      { status: 500 },
    )
  }
}
