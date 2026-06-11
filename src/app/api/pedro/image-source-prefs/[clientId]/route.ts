import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchClientById } from "@/lib/integrations/monday"
import { listFolderTree, type DriveFolderNode } from "@/lib/integrations/google-drive"

/**
 * Pedro image-source preferences per client.
 *
 *   GET  → returns the per-client folder tree (root + 1 level deep)
 *          with the CM's current enabled/disabled state per folder,
 *          plus high-level toggles (useStock, ...).
 *   PATCH → updates one folder's enabled flag, or the high-level
 *           image_source_prefs jsonb on pedro_client_state.
 *
 * Roy 2026-06-10: keuzeproces gebeurt VOOR de Genereer-klik zodat we
 * geen API kosten maken aan verkeerde bronnen. Deze endpoint is wat de
 * picker UI aanroept om die config live te houden.
 */

export const dynamic = "force-dynamic"

type SourcePrefs = {
  useStock: boolean
}

const DEFAULT_PREFS: SourcePrefs = {
  useStock: false,
}

function sanitisePrefs(raw: unknown): SourcePrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS }
  const r = raw as Record<string, unknown>
  return {
    useStock: r.useStock === true,
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { clientId } = await params
  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  // Resolve Drive root id via Monday client. Best-effort: if Monday is
  // unreachable we still return prefs + stock toggle so the picker can
  // at least show Pexels.
  let driveRootId: string | null = null
  let driveError: string | null = null
  try {
    const client = await fetchClientById(clientId)
    driveRootId = client?.googleDriveId?.trim() ?? null
  } catch (e) {
    driveError = e instanceof Error ? e.message : "Monday client lookup failed"
  }

  // Pull existing folder prefs (only rows where CM toggled something).
  const { data: prefRows } = await supabase
    .from("pedro_drive_folder_prefs")
    .select("folder_id, folder_name, folder_path, enabled, updated_at, updated_by_email")
    .eq("client_id", clientId)
  type PrefRow = {
    folder_id: string
    folder_name: string
    folder_path: string | null
    enabled: boolean
    updated_at: string
    updated_by_email: string | null
  }
  const prefByFolderId = new Map<string, PrefRow>()
  for (const r of (prefRows ?? []) as PrefRow[]) {
    prefByFolderId.set(r.folder_id, r)
  }

  // High-level image_source_prefs from pedro_client_state.
  const { data: stateRow } = await supabase
    .from("pedro_client_state")
    .select("image_source_prefs")
    .eq("client_id", clientId)
    .order("campaign_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ image_source_prefs: unknown }>()
  const sourcePrefs = sanitisePrefs(stateRow?.image_source_prefs)

  // Enumerate Drive folders (root + 2 levels). Skipped when no root.
  let folderTree: DriveFolderNode[] = []
  if (driveRootId) {
    try {
      folderTree = await listFolderTree(driveRootId, {
        maxDepth: 2,
        maxFolders: 60,
      })
    } catch (e) {
      driveError = e instanceof Error ? e.message : "Drive enumeration failed"
    }
  }

  // Merge: every enumerated folder gets its pref (default enabled=true
  // when no row exists). Also include prefs for folders that aren't in
  // the current enumeration (CM toggled them once, the folder later
  // moved out of scope - keep showing so they can re-enable).
  type FolderWithPref = DriveFolderNode & {
    enabled: boolean
    prefUpdatedAt: string | null
    prefUpdatedBy: string | null
  }
  const folders: FolderWithPref[] = folderTree.map((f) => {
    const pref = prefByFolderId.get(f.id)
    return {
      ...f,
      enabled: pref ? pref.enabled : true,
      prefUpdatedAt: pref?.updated_at ?? null,
      prefUpdatedBy: pref?.updated_by_email ?? null,
    }
  })

  // Tack on orphan prefs (CM toggled folders no longer in the tree).
  const enumeratedIds = new Set(folderTree.map((f) => f.id))
  for (const [folderId, pref] of prefByFolderId) {
    if (enumeratedIds.has(folderId)) continue
    folders.push({
      id: folderId,
      name: pref.folder_name,
      path: pref.folder_path ?? pref.folder_name,
      depth: 1,
      modifiedTime: null,
      hasSubfolders: false,
      hasImages: false,
      enabled: pref.enabled,
      prefUpdatedAt: pref.updated_at,
      prefUpdatedBy: pref.updated_by_email,
    })
  }

  return NextResponse.json({
    clientId,
    driveRootId,
    driveError,
    folders,
    sourcePrefs,
  })
}

type PatchBody = {
  /** When set: toggle a specific folder. */
  folder?: {
    id: string
    name: string
    path?: string | null
    enabled: boolean
    /** Roy 2026-06-10: cascade naar subfolders. Wanneer een
     *  hoofdfolder op uit gaat, sturen we hier alle bekende descendant
     *  folder ids mee zodat ze in één PATCH dezelfde enabled-state
     *  krijgen. Idem voor 'aan' - als de parent weer aan gaat, gaan
     *  alle (eerder met de parent uitgezette) descendants ook aan.
     *  Lege array = single-folder toggle (oude gedrag). */
    descendants?: Array<{
      id: string
      name: string
      path?: string | null
    }>
  }
  /** When set: update the high-level toggles (partial; merged with current). */
  sourcePrefs?: Partial<SourcePrefs>
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { clientId } = await params
  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }

  let body: PatchBody = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  // ── Folder toggle (single + cascade) ─────────────────────────────
  if (body.folder) {
    const { id, name, path, enabled, descendants } = body.folder
    if (!id || typeof name !== "string" || typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "folder.id, folder.name en folder.enabled zijn verplicht" },
        { status: 400 },
      )
    }
    const now = new Date().toISOString()
    const updatedBy = session.user.email ?? null
    const rows: Array<{
      client_id: string
      folder_id: string
      folder_name: string
      folder_path: string | null
      enabled: boolean
      updated_at: string
      updated_by_email: string | null
    }> = [
      {
        client_id: clientId,
        folder_id: id,
        folder_name: name,
        folder_path: path ?? null,
        enabled,
        updated_at: now,
        updated_by_email: updatedBy,
      },
    ]
    if (Array.isArray(descendants)) {
      for (const d of descendants) {
        if (!d?.id || typeof d.name !== "string") continue
        if (d.id === id) continue // skip self in case caller included it
        rows.push({
          client_id: clientId,
          folder_id: d.id,
          folder_name: d.name,
          folder_path: d.path ?? null,
          enabled,
          updated_at: now,
          updated_by_email: updatedBy,
        })
      }
    }
    try {
      const { error } = await supabase
        .from("pedro_drive_folder_prefs")
        .upsert(rows, { onConflict: "client_id,folder_id" })
      if (error) throw error
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Save failed" },
        { status: 500 },
      )
    }
  }

  // ── High-level toggles ───────────────────────────────────────────
  if (body.sourcePrefs) {
    // Need to merge with existing so partial updates don't wipe other
    // keys. Read → merge → upsert.
    const { data: existing } = await supabase
      .from("pedro_client_state")
      .select("id, image_source_prefs")
      .eq("client_id", clientId)
      .order("campaign_number", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; image_source_prefs: unknown }>()

    const current = sanitisePrefs(existing?.image_source_prefs)
    const next: SourcePrefs = {
      useStock:
        body.sourcePrefs.useStock !== undefined
          ? body.sourcePrefs.useStock
          : current.useStock,
    }

    if (existing?.id) {
      const { error } = await supabase
        .from("pedro_client_state")
        .update({ image_source_prefs: next })
        .eq("id", existing.id)
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    } else {
      // No client_state row yet - insert minimal row with just the prefs.
      const { error } = await supabase.from("pedro_client_state").insert({
        client_id: clientId,
        campaign_number: 1,
        image_source_prefs: next,
      })
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ ok: true })
}
