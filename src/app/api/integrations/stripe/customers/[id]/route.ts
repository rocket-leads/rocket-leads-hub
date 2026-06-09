import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { resolveStripeCustomer } from "@/lib/integrations/stripe"

/**
 * GET /api/integrations/stripe/customers/[id]
 *
 * Resolves a single Stripe customer ID to its ResolvedEntity. Used by the
 * `useResolvedEntity` hook to show "linked to: John Doe · john@doe.com"
 * next to a stripe_customer_id field — the always-on verification that
 * stops broken/wrong IDs from sitting unnoticed for weeks.
 *
 * Response shape:
 *   - 200 { entity: ResolvedEntity }   — happy path
 *   - 200 { entity: null }             — ID is well-formed but not a Stripe customer (broken link)
 *   - 500                              — Stripe transport/auth failure (couldn't verify)
 *
 * The "ID doesn't resolve" case returns 200/null instead of 404 so React
 * Query treats it as data, not a fetch error. The component renders a
 * destructive "Not found in Stripe" pill against that null state.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  try {
    const entity = await resolveStripeCustomer(id)
    return NextResponse.json({ entity })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Stripe resolve failed" },
      { status: 500 },
    )
  }
}
