import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { createMarkdownFile } from "@/lib/integrations/google-drive"
import { fetchClientById } from "@/lib/integrations/monday"
import {
  renderCreativeRefreshMarkdown,
  renderRefreshTitle,
  type CreativesEnvelopeForRender,
} from "@/lib/pedro/refresh-render"

/**
 * POST /api/pedro/refreshes/[id]/save-to-drive
 *
 * Pushes the refresh as a Markdown file into the client's Google Drive
 * folder (`client.googleDriveId` from Monday). Returns the new file's
 * Drive URL so the UI can open-in-tab.
 *
 * Precondition: client has a `googleDriveId` set, AND the folder must be
 * shared with the service account email as Editor. Drive returns 403
 * otherwise — we translate that into a clear actionable error.
 *
 * Idempotent on already-saved: the refresh row stores the file id +
 * URL; re-clicking returns the existing URL without uploading again.
 *
 * Roy 2026-06-09.
 */

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  try {
    const supabase = await createAdminClient()

    const { data: refreshRow, error: readErr } = await supabase
      .from("pedro_refreshes")
      .select(
        "id, client_id, stage, generated_at, window_start, window_end, window_days, envelope, saved_to_drive_file_id, saved_to_drive_url",
      )
      .eq("id", id)
      .maybeSingle()
    if (readErr) throw readErr
    if (!refreshRow) {
      return NextResponse.json({ error: "Refresh not found" }, { status: 404 })
    }

    // Idempotent short-circuit.
    if (refreshRow.saved_to_drive_file_id && refreshRow.saved_to_drive_url) {
      return NextResponse.json({
        fileId: refreshRow.saved_to_drive_file_id,
        url: refreshRow.saved_to_drive_url,
        alreadySaved: true,
      })
    }

    if (refreshRow.stage !== "creatives") {
      return NextResponse.json(
        { error: `Stage '${refreshRow.stage}' niet ondersteund — alleen creatives voor nu.` },
        { status: 400 },
      )
    }

    // Find the Drive folder id. Comes from Monday's `googleDriveId`
    // column, which our existing client fetch exposes as
    // `client.googleDriveId`. The `clients` Supabase mirror may not
    // carry this column, so we go to the source.
    const mondayClient = await fetchClientById(refreshRow.client_id).catch(() => null)
    const folderId = mondayClient?.googleDriveId?.trim() ?? ""
    if (!folderId) {
      return NextResponse.json(
        {
          error:
            "Geen Google Drive folder gekoppeld aan deze klant. Vul de Drive folder-id in op de Monday-rij.",
        },
        { status: 400 },
      )
    }

    const clientName = mondayClient?.name ?? refreshRow.client_id

    const envelopeForRender: CreativesEnvelopeForRender = {
      clientName,
      window: {
        start: refreshRow.window_start,
        end: refreshRow.window_end,
        days: refreshRow.window_days,
      },
      stats: refreshRow.envelope.stats,
      trend: refreshRow.envelope.trend,
      summary: refreshRow.envelope.summary ?? "",
      proposals: refreshRow.envelope.proposals ?? [],
      warnings: refreshRow.envelope.warnings ?? [],
    }

    const fileName = renderRefreshTitle({
      clientName,
      generatedAt: refreshRow.generated_at,
      windowDays: refreshRow.window_days,
    })
    const contentMarkdown = renderCreativeRefreshMarkdown(envelopeForRender)

    const created = await createMarkdownFile({
      folderId,
      name: fileName,
      contentMarkdown,
    })

    await supabase
      .from("pedro_refreshes")
      .update({
        saved_to_drive_file_id: created.id,
        saved_to_drive_url: created.webViewLink,
      })
      .eq("id", refreshRow.id)

    return NextResponse.json({
      fileId: created.id,
      url: created.webViewLink,
      alreadySaved: false,
    })
  } catch (e) {
    console.error(
      "[pedro/refreshes/save-to-drive] failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save to Drive failed" },
      { status: 500 },
    )
  }
}
