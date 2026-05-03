import { auth } from "@/lib/auth"
import { checkTabAccess } from "@/lib/clients/access"
import { getAgreement, saveAgreement, type Agreement } from "@/lib/clients/agreement"
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
  if (!body || !Array.isArray(body.campaigns)) {
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
