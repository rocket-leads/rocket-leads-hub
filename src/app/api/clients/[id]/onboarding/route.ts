import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { fetchClientById } from "@/lib/integrations/monday"
import {
  getStep,
  resolveWizardState,
  currentStepKey,
  missingCriticalSteps,
  progressPercent,
  type WizardStepState,
} from "@/lib/clients/onboarding"
import { fetchStoredSteps, saveStepState } from "@/lib/clients/onboarding-state"

/**
 * GET /api/clients/[id]/onboarding
 *
 * Resolves the full wizard state for one client: every step + done/locked
 * flags + stored content, plus the current-step pointer and the
 * critical-gate summary. The wizard page renders directly off this
 * payload; revisits prefill the form bodies from each step's `content`.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params

  const [client, stored] = await Promise.all([
    fetchClientById(mondayItemId),
    fetchStoredSteps(mondayItemId),
  ])

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  const states = resolveWizardState(client, stored)
  const currentKey = currentStepKey(states)
  const missingCritical = missingCriticalSteps(states)
  const percent = progressPercent(states)

  return NextResponse.json({
    steps: serializeStates(states),
    currentStepKey: currentKey,
    missingCritical: missingCritical.map((s) => s.key),
    percent,
    client: {
      mondayItemId: client.mondayItemId,
      name: client.name,
      companyName: client.companyName,
      accountManager: client.accountManager,
      campaignManager: client.campaignManager,
      googleDriveId: client.googleDriveId,
      metaAdAccountId: client.metaAdAccountId,
      stripeCustomerId: client.stripeCustomerId,
      trengoContactId: client.trengoContactId,
      clientBoardId: client.clientBoardId,
      // Surfaces in the RL-ad-account inline input on Stap 1 so the AM
      // can fill it without switching to Monday.
      adBudget: client.adBudget,
    },
  })
}

/**
 * PATCH /api/clients/[id]/onboarding
 *
 * Body: { stepKey: string, done: boolean, content?: unknown }
 *
 * Persists a step's state. `content` is optional - pass it when the step
 * has rich output (brief JSON, email body); leave it out when just
 * flipping done. Returns the freshly resolved wizard state so the client
 * can render without a second GET.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params
  const body = (await req.json()) as {
    stepKey?: string
    done?: boolean
    content?: unknown
  }

  if (!body.stepKey || typeof body.done !== "boolean") {
    return NextResponse.json(
      { error: "stepKey and done are required" },
      { status: 400 },
    )
  }

  const step = getStep(body.stepKey)
  if (!step) {
    return NextResponse.json({ error: `Unknown step: ${body.stepKey}` }, { status: 400 })
  }

  await saveStepState({
    mondayItemId,
    stepKey: body.stepKey,
    done: body.done,
    content: body.content,
    userId: session.user.id,
  })

  // Re-resolve so the client picks up any state changes that may have
  // happened between GET and PATCH (e.g. another tab linked the Drive
  // folder in the meantime, flipping the auto-derived `drive_setup`).
  const [client, stored] = await Promise.all([
    fetchClientById(mondayItemId),
    fetchStoredSteps(mondayItemId),
  ])
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }
  const states = resolveWizardState(client, stored)
  return NextResponse.json({
    steps: serializeStates(states),
    currentStepKey: currentStepKey(states),
    missingCritical: missingCriticalSteps(states).map((s) => s.key),
    percent: progressPercent(states),
  })
}

// Strip non-serializable runtime fields (the `derive` closure) before
// returning. The wizard UI only needs the static metadata plus state.
function serializeStates(states: WizardStepState[]) {
  return states.map((s) => ({
    key: s.key,
    labelKey: s.labelKey,
    descriptionKey: s.descriptionKey,
    action: s.action,
    order: s.order,
    prerequisites: s.prerequisites,
    critical: s.critical,
    done: s.done,
    locked: s.locked,
    completedAt: s.completedAt,
    completedBy: s.completedBy,
    content: s.content,
  }))
}
