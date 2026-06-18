import { auth } from "@/lib/auth"
import { createOnboardingClient } from "@/lib/clients/create"
import { NextRequest, NextResponse } from "next/server"

type CreateBody = {
  name?: string
  accountManagerId?: number
  campaignManagerId?: number
  firstName?: string
  email?: string
  phone?: string
  adBudget?: string
  serviceFee?: string
  kickOffDate?: string
}

/**
 * Create a new onboarding client from the Hub overview. Writes a row to the
 * Monday Onboarding board and returns the new item ID so the client can
 * redirect straight into the wizard. Auth-gated like every other API route.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as CreateBody
  const name = (body.name ?? "").trim()
  if (!name) return NextResponse.json({ error: "Client name is required" }, { status: 400 })

  try {
    const { mondayItemId } = await createOnboardingClient({
      name,
      accountManagerId: body.accountManagerId,
      campaignManagerId: body.campaignManagerId,
      firstName: body.firstName,
      email: body.email,
      phone: body.phone,
      adBudget: body.adBudget,
      serviceFee: body.serviceFee,
      kickOffDate: body.kickOffDate,
    })
    return NextResponse.json({ mondayItemId })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create onboarding" },
      { status: 400 },
    )
  }
}
