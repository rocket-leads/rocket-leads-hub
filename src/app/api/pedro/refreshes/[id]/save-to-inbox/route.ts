import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import {
  renderCreativeRefreshMarkdown,
  renderRefreshTitle,
  type CreativesEnvelopeForRender,
} from "@/lib/pedro/refresh-render"

/**
 * POST /api/pedro/refreshes/[id]/save-to-inbox
 *
 * Creates a Hub `update` assigned to the current user with the refresh
 * rendered as markdown in the body. Lands in the AM's personal Updates
 * inbox, searchable forever - Hub-canonical, no external mirror.
 *
 * Idempotent: if the refresh already carries `saved_to_inbox_event_id`,
 * return that event id rather than creating a duplicate.
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
        "id, client_id, stage, generated_at, window_start, window_end, window_days, envelope, saved_to_inbox_event_id",
      )
      .eq("id", id)
      .maybeSingle()
    if (readErr) throw readErr
    if (!refreshRow) {
      return NextResponse.json({ error: "Refresh not found" }, { status: 404 })
    }

    // Idempotent short-circuit: already saved → return existing event id.
    if (refreshRow.saved_to_inbox_event_id) {
      return NextResponse.json({
        inboxEventId: refreshRow.saved_to_inbox_event_id,
        alreadySaved: true,
      })
    }

    if (refreshRow.stage !== "creatives") {
      // Other stages (angles/script/ad_copy) will land here once their
      // renderers ship. For now we only support creatives - Roy's
      // explicit ask. Future PR: switch on stage and pick the renderer.
      return NextResponse.json(
        { error: `Stage '${refreshRow.stage}' niet ondersteund - alleen creatives voor nu.` },
        { status: 400 },
      )
    }

    const { data: clientRow } = await supabase
      .from("clients")
      .select("name")
      .eq("monday_item_id", refreshRow.client_id)
      .maybeSingle()
    const clientName = clientRow?.name ?? refreshRow.client_id

    // Render the markdown body. Same renderer drives Drive export so the
    // AM gets identical content in both targets.
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
    const title = renderRefreshTitle({
      clientName,
      generatedAt: refreshRow.generated_at,
      windowDays: refreshRow.window_days,
    })
    const body = renderCreativeRefreshMarkdown(envelopeForRender)

    // Insert the update - self-assigned, source `automation` with a
    // pedro-refresh marker so the inbox UI can render the right icon
    // and so we can search/dedup later.
    const { data: inserted, error: insertErr } = await supabase
      .from("inbox_events")
      .insert({
        kind: "update",
        client_id: refreshRow.client_id,
        author_id: session.user.id,
        assignee_id: session.user.id,
        title,
        body,
        status: "unread",
        source: "automation",
        source_ref: {
          marker: "pedro_refresh_v1",
          stage: refreshRow.stage,
          refresh_id: refreshRow.id,
        },
      })
      .select("id")
      .single()
    if (insertErr || !inserted) {
      throw insertErr ?? new Error("Insert returned no row")
    }

    // Stamp the back-reference so we can short-circuit next time.
    await supabase
      .from("pedro_refreshes")
      .update({ saved_to_inbox_event_id: inserted.id })
      .eq("id", refreshRow.id)

    return NextResponse.json({
      inboxEventId: inserted.id,
      alreadySaved: false,
    })
  } catch (e) {
    console.error(
      "[pedro/refreshes/save-to-inbox] failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save to inbox failed" },
      { status: 500 },
    )
  }
}
