import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createMarkdownFile } from "@/lib/integrations/google-drive"
import { fetchClientById } from "@/lib/integrations/monday"
import type { ScriptVideo } from "@/lib/pedro/generate-script-docx"

/**
 * POST /api/pedro/scripts/save-to-drive
 *
 * Writes a Pedro video-script bundle as a Markdown file into the client's
 * Google Drive folder (the `googleDriveId` column on the Monday row).
 *
 * Why MD instead of DOCX: the script step already has a "↓ Download .docx"
 * action for handing to the freelance editor; Drive backup is for the
 * client's content library where Markdown reads cleanly in Docs preview
 * and stays diff-able for later iterations. We could add a DOCX variant
 * later if a CM asks for both.
 *
 * Body:
 *   {
 *     clientId: string,         // Monday item id
 *     scriptVideos: ScriptVideo[],
 *     campaignNumber?: number,  // optional — appended to the filename
 *     campaignLabel?: string    // optional — human label used in filename
 *   }
 *
 * Returns `{ fileId, url, name }` on success; `{ error }` with a clear
 * NL message on Drive permission failures so the CM knows to share the
 * folder with the service account.
 *
 * Roy 2026-06-11.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: {
    clientId?: string
    scriptVideos?: ScriptVideo[]
    campaignNumber?: number
    campaignLabel?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const clientId = body.clientId?.trim() ?? ""
  const videos = Array.isArray(body.scriptVideos) ? body.scriptVideos : []
  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }
  if (videos.length === 0) {
    return NextResponse.json(
      { error: "Geen video scripts om op te slaan" },
      { status: 400 },
    )
  }

  // Resolve the Drive folder from Monday — same source of truth as the
  // refresh save-to-drive route, so behaviour is consistent.
  const client = await fetchClientById(clientId).catch(() => null)
  const folderId = client?.googleDriveId?.trim() ?? ""
  if (!folderId) {
    return NextResponse.json(
      {
        error:
          "Geen Google Drive folder gekoppeld aan deze klant. Vul de Drive folder-id in op de Monday-rij.",
      },
      { status: 400 },
    )
  }

  const clientName = client?.companyName || client?.name || clientId
  const today = new Date().toISOString().slice(0, 10)
  const campaignSuffix = body.campaignLabel
    ? ` - ${body.campaignLabel}`
    : body.campaignNumber
      ? ` - campaign ${body.campaignNumber}`
      : ""
  const fileName = `Video scripts - ${clientName}${campaignSuffix} - ${today}`
  const contentMarkdown = renderScriptsMarkdown({
    clientName,
    campaignLabel: body.campaignLabel ?? (body.campaignNumber ? `Campaign ${body.campaignNumber}` : null),
    videos,
  })

  try {
    const created = await createMarkdownFile({
      folderId,
      name: fileName,
      contentMarkdown,
    })
    return NextResponse.json({
      fileId: created.id,
      url: created.webViewLink,
      name: created.name,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save to Drive failed"
    console.error("[pedro/scripts/save-to-drive] failed:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * Render a CM-friendly Markdown doc from the script videos. Sections
 * mirror the Pedro UI: title, hooks, body, CTA — so re-opening the doc
 * later reads identically to the in-app view.
 */
function renderScriptsMarkdown(args: {
  clientName: string
  campaignLabel: string | null
  videos: ScriptVideo[]
}): string {
  const lines: string[] = []
  lines.push(`# Video scripts — ${args.clientName}`)
  if (args.campaignLabel) lines.push(`**Campagne:** ${args.campaignLabel}`)
  lines.push(`**Datum:** ${new Date().toLocaleDateString("nl-NL", { day: "2-digit", month: "long", year: "numeric" })}`)
  lines.push("")
  lines.push("---")
  lines.push("")
  args.videos.forEach((v, i) => {
    lines.push(`## ${v.title || `Video ${i + 1}`}`)
    lines.push("")
    if (v.hooks.length > 0) {
      lines.push(`**Hooks:**`)
      v.hooks.forEach((h, hi) => lines.push(`${hi + 1}. ${h}`))
      lines.push("")
    }
    if (v.body) {
      lines.push(`**Body:**`)
      lines.push("")
      lines.push(v.body)
      lines.push("")
    }
    if (v.cta) {
      lines.push(`**CTA:**`)
      lines.push("")
      lines.push(v.cta)
      lines.push("")
    }
    lines.push("---")
    lines.push("")
  })
  return lines.join("\n")
}
