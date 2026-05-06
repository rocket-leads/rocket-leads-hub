import { auth } from "@/lib/auth"
import { checkTabAccess } from "@/lib/clients/access"
import {
  agreementMonthly,
  getAgreement,
  saveAgreement,
  type Agreement,
} from "@/lib/clients/agreement"
import { NextRequest, NextResponse } from "next/server"

/**
 * Hub-canonical client agreement (replaces Monday sub-items for multi-campaign
 * clients). Permission is gated on the same `canViewBilling` flag as the
 * Stripe invoices view since pricing is finance-sensitive.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const allowed = await checkTabAccess(session.user.id, session.user.role ?? "member", mondayItemId, "billing")
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  try {
    const agreement = await getAgreement(mondayItemId)
    return NextResponse.json(agreement)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load agreement" },
      { status: 500 },
    )
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const allowed = await checkTabAccess(session.user.id, session.user.role ?? "member", mondayItemId, "billing")
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = (await req.json()) as Agreement
  if (!body || !Array.isArray(body.platforms)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  try {
    await saveAgreement(mondayItemId, body, session.user.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      { status: 400 },
    )
  }
}

/**
 * Partial-update endpoint used by the Billing-page inline cells. Lets finance
 * tweak just the displayed "fee" or "ad budget" without opening the full
 * agreement editor.
 *
 * Body: `{ field: "fee" | "ad_budget"; value: number }`
 *
 * `ad_budget` writes straight to the column. `fee` is a virtual field — what
 * the Billing page actually shows is `agreementMonthly(agreement)` (sum of
 * selected platform_fees + follow_up_fee). To keep "what you typed = what you
 * see", we park the delta in `platform_fees.meta`:
 *
 *   platform_fees.meta = value − sumOfOtherPlatformFees − (followUp ? followUpFee : 0)
 *
 * If that math goes negative (the fee already exceeds what they're trying to
 * set, e.g. follow-up fee alone is higher), we 400 — they need the full
 * editor to restructure the agreement, since inline can't safely zero out
 * other components without losing config.
 *
 * "meta" is added to `platforms` if not already present, so the new fee is
 * actually counted in the displayed total.
 */
type InlinePatch = { field: "fee" | "ad_budget"; value: number }

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const allowed = await checkTabAccess(session.user.id, session.user.role ?? "member", mondayItemId, "billing")
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = (await req.json().catch(() => null)) as InlinePatch | null
  if (
    !body ||
    (body.field !== "fee" && body.field !== "ad_budget") ||
    typeof body.value !== "number" ||
    !Number.isFinite(body.value) ||
    body.value < 0
  ) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  try {
    const current = await getAgreement(mondayItemId)
    let next: Agreement

    if (body.field === "ad_budget") {
      next = { ...current, ad_budget: body.value }
    } else {
      // Fee: distribute the typed total across the existing structure.
      const otherFees = (Object.entries(current.platform_fees) as Array<
        [keyof typeof current.platform_fees, number | undefined]
      >)
        .filter(([p]) => p !== "meta")
        .reduce((sum, [, v]) => sum + (v ?? 0), 0)
      const followUpAmount = current.follow_up ? current.follow_up_fee : 0
      const metaShare = body.value - otherFees - followUpAmount
      if (metaShare < 0) {
        return NextResponse.json(
          {
            error: `Can't set fee below €${otherFees + followUpAmount} — other platform fees + follow-up already exceed it. Open the client's Billing tab to restructure.`,
          },
          { status: 400 },
        )
      }
      const platforms = current.platforms.includes("meta")
        ? current.platforms
        : [...current.platforms, "meta" as const]
      next = {
        ...current,
        platforms,
        platform_fees: { ...current.platform_fees, meta: metaShare },
      }
    }

    await saveAgreement(mondayItemId, next, session.user.id)
    // Return the resulting displayed values so the caller can confirm what was
    // saved without a separate fetch — useful when "fee" gets rewritten via
    // platform_fees.meta and the client's optimistic value might mismatch.
    return NextResponse.json({
      ok: true,
      fee: agreementMonthly(next),
      ad_budget: next.ad_budget,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      { status: 400 },
    )
  }
}
