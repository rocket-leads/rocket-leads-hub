import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { BUCKET } from "@/lib/integrations/pedro-image-storage"

/**
 * GET /api/pedro/refreshes/[id]
 *
 * Returns the full envelope for one historical refresh, in the same shape
 * the live `creative-refresh` POST returns. The RefreshHistoryPanel calls
 * this when the AM clicks a row, then feeds the result into the existing
 * RefreshShell render path. No regeneration, no Anthropic call.
 *
 * DELETE /api/pedro/refreshes/[id]
 *
 * Deletes a refresh + cascades to its pedro_variants rows (via FK ON
 * DELETE CASCADE). Also cleans up any generated/uploaded images from
 * Supabase Storage so a botched refresh doesn't leave orphans.
 *
 * NOT touched on delete (intentional):
 *   - Inbox events saved via /save-to-inbox — the markdown lives in
 *     the inbox row itself, AM may still want to read it.
 *   - Drive files exported via /save-to-drive — same logic, plus the
 *     CM may have already shared the Drive link with someone.
 *
 * Roy 2026-06-09: voor foutieve refreshes die het learning-loop
 * vervuilen.
 */

export async function GET(
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
    const { data, error } = await supabase
      .from("pedro_refreshes")
      .select(
        "id, client_id, stage, generated_at, window_start, window_end, window_days, envelope, saved_to_inbox_event_id, saved_to_drive_file_id, saved_to_drive_url",
      )
      .eq("id", id)
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: "Refresh not found" }, { status: 404 })

    // Look up the client name from the clients table so the envelope is
    // self-contained — same shape the live POST returns.
    const { data: clientRow } = await supabase
      .from("clients")
      .select("name")
      .eq("monday_item_id", data.client_id)
      .maybeSingle()

    type Envelope = {
      stats?: unknown
      trend?: unknown
      summary?: string
      proposals?: Array<{
        basedOnAd?: unknown
        preserve?: unknown
        variants?: Array<{ adName?: string; [k: string]: unknown }>
      }>
      warnings?: string[]
    }
    const env = (data.envelope ?? {}) as Envelope

    // Enrich envelope variants with their pedro_variants row id +
    // image status flags so the UI can call generate-image / upload /
    // launch endpoints without an extra round-trip per variant.
    const { data: variantRows } = await supabase
      .from("pedro_variants")
      .select(
        "id, ad_name, image_storage_path, image_provider, image_model, image_generated_at, image_prompt, meta_ad_id, meta_ad_launched_at",
      )
      .eq("refresh_id", data.id)
    type VariantRow = {
      id: string
      ad_name: string
      image_storage_path: string | null
      image_provider: string | null
      image_model: string | null
      image_generated_at: string | null
      image_prompt: string | null
      meta_ad_id: string | null
      meta_ad_launched_at: string | null
    }
    const byAdName = new Map<string, VariantRow>()
    for (const r of (variantRows ?? []) as VariantRow[]) {
      byAdName.set(r.ad_name, r)
    }

    const enrichedProposals = (env.proposals ?? []).map((p) => ({
      ...p,
      variants: (p.variants ?? []).map((v) => {
        const dbRow = v.adName ? byAdName.get(v.adName) : undefined
        return {
          ...v,
          // Variant DB id — required for image gen / upload / launch endpoints.
          variantId: dbRow?.id ?? null,
          image: dbRow?.image_storage_path
            ? {
                provider: dbRow.image_provider,
                model: dbRow.image_model,
                generatedAt: dbRow.image_generated_at,
                hasImage: true,
              }
            : { hasImage: false, imagePrompt: dbRow?.image_prompt ?? (v.imagePrompt as string | undefined) ?? null },
          metaAdId: dbRow?.meta_ad_id ?? null,
          launchedAt: dbRow?.meta_ad_launched_at ?? null,
        }
      }),
    }))

    // Reconstruct the same response shape as POST /creative-refresh so the
    // UI doesn't need a separate render path for live vs historical.
    return NextResponse.json({
      mode: "iterate-winners",
      refreshId: data.id,
      clientId: data.client_id,
      clientName: clientRow?.name ?? data.client_id,
      window: {
        start: data.window_start,
        end: data.window_end,
        days: data.window_days,
      },
      stats: env.stats ?? {},
      trend: env.trend ?? {},
      proposals: enrichedProposals,
      summary: env.summary ?? "",
      warnings: env.warnings ?? [],
      // Status flags for the inbox/drive save buttons — UI shows
      // "Already saved" instead of the action button when set.
      savedToInboxEventId: data.saved_to_inbox_event_id ?? null,
      savedToDriveFileId: data.saved_to_drive_file_id ?? null,
      savedToDriveUrl: data.saved_to_drive_url ?? null,
    })
  } catch (e) {
    console.error(
      "[pedro/refreshes/:id] read failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load refresh" },
      { status: 500 },
    )
  }
}

export async function DELETE(
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

    // 1. Read the refresh + its variants so we can collect storage
    //    paths BEFORE the cascade fires (variant rows + their paths
    //    are gone after the parent delete).
    const { data: refreshRow, error: readErr } = await supabase
      .from("pedro_refreshes")
      .select("id, client_id")
      .eq("id", id)
      .maybeSingle()
    if (readErr) throw readErr
    if (!refreshRow) {
      return NextResponse.json({ error: "Refresh not found" }, { status: 404 })
    }

    const { data: variants } = await supabase
      .from("pedro_variants")
      .select("id, client_id, image_storage_path")
      .eq("refresh_id", id)
    const variantIds = (variants ?? []).map((v) => v.id)

    // Roy 2026-06-10: na de 3-slot migratie staan images in
    // `pedro_variant_images.storage_path`. Oude `pedro_variants.image_storage_path`
    // wordt deprecated maar oude refreshes hebben daar nog data — clean
    // beide om geen orphans achter te laten.
    const legacyPaths = (variants ?? [])
      .map((v) => v.image_storage_path)
      .filter((p): p is string => typeof p === "string" && p.length > 0)

    let slotPaths: string[] = []
    if (variantIds.length > 0) {
      const { data: slotRows } = await supabase
        .from("pedro_variant_images")
        .select("storage_path")
        .in("variant_id", variantIds)
      slotPaths = (slotRows ?? [])
        .map((r) => r.storage_path as string | null)
        .filter((p): p is string => typeof p === "string" && p.length > 0)
    }

    // Dedupe + bulk-remove. Supabase storage.remove accepts up to 1000
    // paths per call; we're nowhere near that.
    const storagePaths = Array.from(new Set([...legacyPaths, ...slotPaths]))
    let storageRemoved = 0
    if (storagePaths.length > 0) {
      try {
        const { data: removed, error: storageErr } = await supabase.storage
          .from(BUCKET)
          .remove(storagePaths)
        if (storageErr) {
          console.error(
            "[pedro/refreshes/:id DELETE] storage cleanup partial fail:",
            storageErr.message,
          )
        }
        storageRemoved = removed?.length ?? 0
      } catch (e) {
        console.error(
          "[pedro/refreshes/:id DELETE] storage cleanup threw:",
          e instanceof Error ? e.message : e,
        )
      }
    }

    // 2a. Explicit row cleanup for tables WITHOUT a CASCADE on
    //     refresh_id (pedro_variant_images cascades on variant_id; the
    //     variant_id cascade fires when we delete pedro_variants below
    //     via the pedro_refreshes cascade). Defensive belt-and-braces.
    if (variantIds.length > 0) {
      try {
        await supabase
          .from("pedro_variant_images")
          .delete()
          .in("variant_id", variantIds)
      } catch (e) {
        console.error(
          "[pedro/refreshes/:id DELETE] variant_images cleanup threw (continuing):",
          e instanceof Error ? e.message : e,
        )
      }
      try {
        await supabase
          .from("pedro_creative_feedback")
          .delete()
          .eq("refresh_id", id)
      } catch (e) {
        console.error(
          "[pedro/refreshes/:id DELETE] creative_feedback cleanup threw (continuing):",
          e instanceof Error ? e.message : e,
        )
      }
    }

    // 3. Delete the refresh row. CASCADE on pedro_variants.refresh_id
    //    removes all child variants (and through them, all learning-loop
    //    pedro_variants outcome data tied to this refresh).
    const { error: deleteErr } = await supabase
      .from("pedro_refreshes")
      .delete()
      .eq("id", id)
    if (deleteErr) throw deleteErr

    return NextResponse.json({
      deleted: true,
      refreshId: id,
      variantsRemoved: variants?.length ?? 0,
      imagesRemoved: storageRemoved,
    })
  } catch (e) {
    console.error(
      "[pedro/refreshes/:id DELETE] failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Delete failed" },
      { status: 500 },
    )
  }
}
