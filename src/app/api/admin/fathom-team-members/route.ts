import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { fetchFathomTeamMembers, type FathomTeamMember } from "@/lib/integrations/fathom"
import { cachedFetch } from "@/lib/cache"
import { safeFetch } from "@/lib/safe-fetch"

/**
 * Fathom team members for the per-user "Fathom email" dropdown in
 * Settings → Users. Was loaded in Settings SSR; lifted here so the
 * Users tab fetches it on mount and Settings paints immediately.
 *
 * Cached server-side for 24h via `cachedFetch` - Fathom team rosters
 * basically don't change. First call after cache expiry is the only
 * slow one (1-2s).
 */
export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const members = await safeFetch(
    "api:fathom_team_members",
    () =>
      cachedFetch<FathomTeamMember[]>(
        "fathom_team_members",
        () => fetchFathomTeamMembers(),
        24 * 60 * 60 * 1000,
      ),
    [] as FathomTeamMember[],
  )

  return NextResponse.json({ members })
}
