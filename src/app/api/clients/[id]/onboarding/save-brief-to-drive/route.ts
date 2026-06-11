import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { fetchClientById } from "@/lib/integrations/monday"
import { fetchStoredSteps, saveStepState } from "@/lib/clients/onboarding-state"
import { createMarkdownFile } from "@/lib/integrations/google-drive"

// Drive create + auth setup is sub-5s on warm cache. Keep the ceiling
// generous in case the service account auth is cold.
export const maxDuration = 60

/**
 * POST /api/clients/[id]/onboarding/save-brief-to-drive
 *
 * Writes the AM-approved client brief out to the per-klant Drive
 * folder's `Brief/` subfolder as a Markdown file. Fired by the brief-
 * enrichment step's approve action so the CM can pick the brief up
 * directly from Drive without going through the wizard.
 *
 * Data sources (fall-through):
 *   1. brief_enrichment step content's `finalBrief`  — post-AI merge
 *   2. kickoff_live step content's `briefDraft`      — AM's live notes
 *
 * Writes the resulting Drive file ID back onto the brief_enrichment
 * step's content so the UI can show "Brief saved to Drive — open" the
 * next time the step renders.
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

  // Pull both step contents + the Monday client snapshot in parallel —
  // none of these depend on each other.
  const [client, stored] = await Promise.all([
    fetchClientById(mondayItemId).catch(() => null),
    fetchStoredSteps(mondayItemId),
  ])
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  const kickoffContent = stored.get("kickoff_live")?.content as
    | {
        autoSetup?: { drive?: { subfolders?: Record<string, { id: string }> } }
        briefDraft?: Partial<BriefShape>
      }
    | null
    | undefined
  const enrichmentContent = stored.get("brief_enrichment")?.content as
    | { finalBrief?: Partial<BriefShape> }
    | null
    | undefined

  const briefFolderId =
    kickoffContent?.autoSetup?.drive?.subfolders?.brief?.id ?? null
  if (!briefFolderId) {
    return NextResponse.json(
      {
        error:
          "Brief subfolder ID not yet captured — wait for auto-setup to finish in Stap 1.",
      },
      { status: 400 },
    )
  }

  // Merge: enrichment final wins per-field, kickoff draft fills blanks.
  const finalBrief = mergeBrief(
    enrichmentContent?.finalBrief,
    kickoffContent?.briefDraft,
  )

  const markdown = renderBriefMarkdown({
    clientName: client.companyName || client.name,
    brief: finalBrief,
  })

  // YYYY-MM-DD prefix so the file sorts naturally in Drive when the
  // brief gets re-saved later (post-eval enrichment, mid-campaign
  // pivot, etc.). Each save creates a new file rather than overwriting
  // so the AM/CM has an audit trail.
  const fileName = `Brief - ${client.companyName || client.name} - ${new Date()
    .toISOString()
    .slice(0, 10)}.md`

  let created
  try {
    created = await createMarkdownFile({
      folderId: briefFolderId,
      name: fileName,
      contentMarkdown: markdown,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Drive write failed" },
      { status: 500 },
    )
  }

  // Persist the Drive file pointer onto the brief_enrichment step
  // content so the UI can show "Brief saved — open in Drive" on
  // revisit. Preserves existing content (finalBrief, accepted, etc.)
  // by spreading the prior payload.
  await saveStepState({
    mondayItemId,
    stepKey: "brief_enrichment",
    done: true,
    content: {
      ...(enrichmentContent ?? {}),
      driveFile: {
        id: created.id,
        name: created.name,
        webViewLink: created.webViewLink,
        savedAt: new Date().toISOString(),
      },
    },
    userId: session.user.id,
  })

  return NextResponse.json({
    ok: true,
    fileId: created.id,
    fileName: created.name,
    webViewLink: created.webViewLink,
  })
}

// ── Helpers ──────────────────────────────────────────────────────────────

type BriefShape = {
  bedrijf: string
  sector: string
  websiteUrl: string
  doelgroep: string
  pijnpunten: string
  aanbod: string
  usps: string
  marketingHooks: string
}

const FIELD_LABELS: Record<keyof BriefShape, string> = {
  bedrijf: "Bedrijf",
  sector: "Sector",
  websiteUrl: "Website",
  doelgroep: "Doelgroep / ICP",
  pijnpunten: "Pijnpunten",
  aanbod: "Aanbod / propositie",
  usps: "USPs",
  marketingHooks: "Marketing hooks / angles",
}

const EMPTY_BRIEF: BriefShape = {
  bedrijf: "",
  sector: "",
  websiteUrl: "",
  doelgroep: "",
  pijnpunten: "",
  aanbod: "",
  usps: "",
  marketingHooks: "",
}

function mergeBrief(
  primary: Partial<BriefShape> | undefined,
  fallback: Partial<BriefShape> | undefined,
): BriefShape {
  const out = { ...EMPTY_BRIEF }
  for (const key of Object.keys(EMPTY_BRIEF) as Array<keyof BriefShape>) {
    const p = primary?.[key]?.trim?.() ?? ""
    const f = fallback?.[key]?.trim?.() ?? ""
    out[key] = p || f
  }
  return out
}

/** Render the brief as plain-Markdown with H1 client title, H2 per
 *  field. Plays nice with Drive's Markdown viewer + any future
 *  PDF-export pipeline. Empty fields collapse to "_(niet ingevuld)_"
 *  so the document still reads cleanly. */
function renderBriefMarkdown(args: {
  clientName: string
  brief: BriefShape
}): string {
  const lines: string[] = []
  lines.push(`# Client Brief — ${args.clientName}`)
  lines.push("")
  lines.push(`> Gegenereerd: ${new Date().toLocaleString("nl-NL")}`)
  lines.push("")

  for (const key of Object.keys(args.brief) as Array<keyof BriefShape>) {
    const value = args.brief[key].trim()
    lines.push(`## ${FIELD_LABELS[key]}`)
    lines.push("")
    lines.push(value || "_(niet ingevuld)_")
    lines.push("")
  }

  return lines.join("\n")
}
