import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchClientItemUpdates } from "@/lib/integrations/monday"
import { listFolderFiles, getFileContent } from "@/lib/integrations/google-drive"
import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"

// GET — return cached knowledge for a client
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const supabase = await createAdminClient()

  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", mondayItemId)
    .single()

  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 })

  const { data: knowledge } = await supabase
    .from("client_knowledge")
    .select("id, source, source_id, title, content, mime_type, synced_at")
    .eq("client_id", client.id)
    .order("synced_at", { ascending: false })

  return NextResponse.json(knowledge ?? [])
}

// POST — sync knowledge from Google Drive + Monday updates
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const supabase = await createAdminClient()

  const { data: client } = await supabase
    .from("clients")
    .select("id, google_drive_folder_id")
    .eq("monday_item_id", mondayItemId)
    .single()

  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 })

  const results = { drive: 0, monday: 0, errors: [] as string[] }

  // 1. Sync Monday updates from the client item
  try {
    const updates = await fetchClientItemUpdates(mondayItemId)
    if (updates.length > 0) {
      const combinedContent = updates
        .map((u) => `[${u.createdAt}]\n${u.text}`)
        .join("\n\n---\n\n")

      const hash = crypto.createHash("md5").update(combinedContent).digest("hex")

      await supabase
        .from("client_knowledge")
        .upsert(
          {
            client_id: client.id,
            source: "monday_updates",
            source_id: mondayItemId,
            title: "Monday Updates & Notes",
            content: combinedContent,
            mime_type: "text/plain",
            content_hash: hash,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "client_id,source,source_id" },
        )

      results.monday = updates.length
    }
  } catch (e) {
    results.errors.push(`Monday: ${e instanceof Error ? e.message : String(e)}`)
  }

  // 2. Sync Google Drive files
  if (client.google_drive_folder_id) {
    try {
      const files = await listFolderFiles(client.google_drive_folder_id)

      for (const file of files) {
        try {
          const hash = crypto.createHash("md5").update(file.modifiedTime).digest("hex")

          const { data: existing } = await supabase
            .from("client_knowledge")
            .select("content_hash")
            .eq("client_id", client.id)
            .eq("source", "google_drive")
            .eq("source_id", file.id)
            .single()

          if (existing?.content_hash === hash) {
            results.drive++
            continue
          }

          const content = await getFileContent(file.id, file.mimeType)

          await supabase
            .from("client_knowledge")
            .upsert(
              {
                client_id: client.id,
                source: "google_drive",
                source_id: file.id,
                title: file.name,
                content,
                mime_type: file.mimeType,
                content_hash: hash,
                synced_at: new Date().toISOString(),
              },
              { onConflict: "client_id,source,source_id" },
            )

          results.drive++
        } catch (e) {
          results.errors.push(`File "${file.name}": ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } catch (e) {
      results.errors.push(`Drive: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return NextResponse.json({
    synced: { driveFiles: results.drive, mondayUpdates: results.monday },
    errors: results.errors,
  })
}
