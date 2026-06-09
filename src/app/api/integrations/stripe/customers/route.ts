import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { searchStripeCustomers } from "@/lib/integrations/stripe"

/**
 * GET /api/integrations/stripe/customers?q=<query>&limit=<n>
 *
 * Backs the search list inside the <ConnectedEntity service="stripe"> picker.
 * Returns up to `limit` ResolvedEntity rows for the query (substring match
 * on name/email). Empty query returns the alphabetical first page so the
 * picker has something to render on first open while the user is still
 * deciding what to type.
 *
 * Auth required (Hub-only), no role gate — every Hub user who can see the
 * Client Information panel can use the picker for that client.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const q = url.searchParams.get("q") ?? ""
  const limitRaw = url.searchParams.get("limit")
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 10, 1), 25) : 10

  try {
    const entities = await searchStripeCustomers(q, limit)
    return NextResponse.json({ entities })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Stripe search failed" },
      { status: 500 },
    )
  }
}
