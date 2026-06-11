import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { fetchClientById } from "@/lib/integrations/monday"
import { updateClientField } from "@/lib/clients/edit"
import { fetchStoredSteps, saveStepState } from "@/lib/clients/onboarding-state"
import { hubStatusToMondayLabel } from "@/lib/clients/status"

/**
 * GET /api/clients/[id]/onboarding/handoff
 *
 * Returns the AM-collected brief + brand fingerprint from the onboarding
 * wizard so Pedro (CM-side) can pre-fill its first-run state without
 * making the CM re-type or re-extract anything.
 *
 * Sources (in fall-through order - first non-empty wins per field):
 *   1. `brief_enrichment` step  - the post-call AI-enriched brief
 *   2. `kickoff_live` step      - the AM's live-call draft
 *
 * Brand style is only captured in `kickoff_live` (live website scrape)
 * so there's no enrichment fallback for it.
 *
 * Shape is intentionally the kick-off `BriefDraft` field-name set
 * (`bedrijf, sector, doelgroep, …`) so Pedro can map it the same way it
 * already maps `/api/pedro/auto-brief` output. Brand style mirrors the
 * `/api/pedro/analyze-website` response so it drops straight into
 * `pedro_client_state.brand_style`.
 *
 * Returns `{ available: false }` when neither step has content - Pedro
 * falls back to its normal auto-brief flow.
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

  // Pull onboarding step state + Monday client metadata in parallel.
  // Monday gives us the integration presence flags (Drive / Meta /
  // Stripe / Trengo / lead board) for the Pedro pre-flight checklist.
  const [stored, client] = await Promise.all([
    fetchStoredSteps(mondayItemId),
    fetchClientById(mondayItemId).catch(() => null),
  ])
  const kickoff = stored.get("kickoff_live")?.content as KickoffContent | null | undefined
  const enriched = stored.get("brief_enrichment")?.content as EnrichmentContent | null | undefined

  const enrichedBrief = enriched && typeof enriched === "object" ? enriched.brief : undefined
  const kickoffBrief = kickoff && typeof kickoff === "object" ? kickoff.briefDraft : undefined

  // Per-field merge: enrichment wins over kick-off draft when populated.
  const brief = {
    bedrijf: pick(enrichedBrief?.bedrijf, kickoffBrief?.bedrijf),
    sector: pick(enrichedBrief?.sector, kickoffBrief?.sector),
    websiteUrl: pick(enrichedBrief?.websiteUrl, kickoffBrief?.websiteUrl),
    doelgroep: pick(enrichedBrief?.doelgroep, kickoffBrief?.doelgroep),
    pijnpunten: pick(enrichedBrief?.pijnpunten, kickoffBrief?.pijnpunten),
    aanbod: pick(enrichedBrief?.aanbod, kickoffBrief?.aanbod),
    usps: pick(enrichedBrief?.usps, kickoffBrief?.usps),
    marketingHooks: pick(enrichedBrief?.marketingHooks, kickoffBrief?.marketingHooks),
    driveLink: enrichedBrief?.driveLink ?? "",
  }

  const brandStyle = kickoff?.brandStyle ?? null

  const briefHasAnything = Object.values(brief).some((v) => typeof v === "string" && v.trim().length > 0)
  const available = briefHasAnything || Boolean(brandStyle)

  // Pre-flight presence flags — drive Pedro's "wat heeft AM al
  // geregeld?" checklist. Booleans only; the UI doesn't need the
  // actual IDs (it already has them through the Pedro picker for the
  // signals it cares about per stage).
  const presence = {
    brief: briefHasAnything,
    brandStyle: Boolean(brandStyle),
    driveFolder: Boolean(client?.googleDriveId),
    metaAdAccount: Boolean(client?.metaAdAccountId),
    stripeCustomer: Boolean(client?.stripeCustomerId),
    trengoContact: Boolean(client?.trengoContactId),
    clientBoard: Boolean(client?.clientBoardId),
  }

  return NextResponse.json({
    available,
    brief,
    brandStyle,
    presence,
  })
}

// ─── Stored step shapes (kept narrow - we only read the fields Pedro
// actually consumes). Anything else in `content` is left untouched and
// not surfaced. ────────────────────────────────────────────────────

type KickoffBriefDraft = {
  bedrijf?: string
  sector?: string
  websiteUrl?: string
  doelgroep?: string
  pijnpunten?: string
  aanbod?: string
  usps?: string
  marketingHooks?: string
}

type KickoffContent = {
  briefDraft?: KickoffBriefDraft
  brandStyle?: {
    primaryColor: string
    secondaryColor: string
    accentColor?: string
    headingFont?: string
    bodyFont?: string
    logoUrl?: string
    heroImageUrl?: string
    taglineHeadline?: string
    taglineSubline?: string
  }
}

type EnrichmentBrief = KickoffBriefDraft & {
  driveLink?: string
}

type EnrichmentContent = {
  brief?: EnrichmentBrief
}

function pick(a: string | undefined, b: string | undefined): string {
  if (a && a.trim().length > 0) return a
  if (b && b.trim().length > 0) return b
  return ""
}

/**
 * POST /api/clients/[id]/onboarding/handoff
 *
 * Final wizard action - flips the client from Onboarding to Live + pings
 * the CM via Slack DM. Order matters:
 *
 *   1. updateClientField(campaign_status='Live') runs the critical-items
 *      hard-gate inside. Any critical wizard step still open throws and
 *      we return 400 with the message; the AM sees exactly which steps
 *      are blocking the flip instead of a silent partial transition.
 *   2. Persist the handoff step done so the rail flips green and the
 *      wizard's "current step" pointer rolls off the end.
 *
 * No Slack DM / inbox task / automatic notifications (Roy 2026-06-11) —
 * those brought more noise than value. CM picks the client up by walking
 * their normal portfolio view.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params

  const client = await fetchClientById(mondayItemId).catch(() => null)
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  // ── 1. Status flip (with hard-gate inside updateClientField) ──
  try {
    await updateClientField(mondayItemId, {
      fieldKey: "campaign_status",
      label: hubStatusToMondayLabel("live"),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Status flip failed"
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  // ── 2. Persist handoff step done ──
  // No Slack DM, no inbox task, no notification — just record the
  // handoff so the rail flips green. CM finds the client via their
  // normal portfolio view (now that status = Live, it shows up there).
  await saveStepState({
    mondayItemId,
    stepKey: "handoff",
    done: true,
    content: {
      handoffAt: new Date().toISOString(),
      handoffBy: session.user.id,
      cmName: client.campaignManager || null,
    },
    userId: session.user.id,
  })

  return NextResponse.json({ ok: true })
}
