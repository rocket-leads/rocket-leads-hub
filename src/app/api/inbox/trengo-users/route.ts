import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { fetchTrengoUsers } from "@/lib/integrations/trengo"

/**
 * GET /api/inbox/trengo-users
 *
 * Trengo workspace users for the internal-note @-mention picker. The Hub
 * composer offers these so a mention becomes a REAL Trengo mention (the send
 * path rewrites `@Full Name` → the Trengo handle before posting). Cached 5 min
 * upstream by trengoFetch.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const users = await fetchTrengoUsers()
    const out = users
      .filter((u) => u.name && u.id)
      .map((u) => ({ id: u.id, name: u.name, firstName: u.first_name, email: u.email }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
    return NextResponse.json({ users: out })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load Trengo users", users: [] },
      { status: 200 },
    )
  }
}
