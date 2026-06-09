import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/pedro/refreshes/[id]
 *
 * Returns the full envelope for one historical refresh, in the same shape
 * the live `creative-refresh` POST returns. The RefreshHistoryPanel calls
 * this when the AM clicks a row, then feeds the result into the existing
 * RefreshShell render path. No regeneration, no Anthropic call.
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
