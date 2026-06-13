import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchClientById } from "@/lib/integrations/monday"
import { ensureClientId } from "@/lib/clients/sync"
import { buildMidweekUpdateDraft } from "@/lib/clients/build-midweek-update-draft"
import { NextRequest, NextResponse } from "next/server"

/**
 * Ad-hoc mid-week Client Update queueing — invoked by the AI Co-pilot.
 *
 * Composes a MID-WEEK update (casual, AI-generated, multi-window
 * performance trends, last contact, Pedro actions, overdue invoices)
 * via `buildMidweekUpdateDraft`, then upserts it into
 * `weekly_update_drafts` with `kind='midweek'` + status='pending' keyed
 * on `(client_id, week_of)` so the existing WeeklyUpdatesChip surface
 * picks it up. The executor deep-links back with
 * `?focusUpdate=<mondayItemId>` so the queue sheet auto-opens with this
 * draft pre-selected for review + send.
 *
 * Differences from the Monday cron (`kind='weekly'`):
 *  - Casual / varied / AM-voice tone (vs. the structured weekly digest)
 *  - Multi-window comparisons (7d / 14d / 30d vs prior) instead of
 *    last-Mon-to-Sun snapshot only
 *  - Pulls last-contact-moment to ground the opener
 *  - Body composed via Claude with a randomisation seed (no fixed
 *    template phrases like "Even een korte update over je campagne …")
 *
 * Difference from POST /api/clients/[id]/client-update: that one
 * returns the WEEKLY parts for the in-place dialog (used by the manual
 * "Update" button on the clients table). This one PERSISTS a mid-week
 * draft to the queue.
 */

export const maxDuration = 60

function mondayOf(d: Date): string {
  const day = d.getUTCDay()
  const offsetFromMonday = (day + 6) % 7
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - offsetFromMonday)
  return monday.toISOString().slice(0, 10)
}

export type QueueClientUpdateResponse = {
  draftId: string
  mondayItemId: string
  status: "queued"
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params

  const client = await fetchClientById(mondayItemId)
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  // Need the Supabase UUID for the FK on weekly_update_drafts.
  let clientUuid: string
  try {
    clientUuid = await ensureClientId(client)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to resolve client id" },
      { status: 500 },
    )
  }

  const draft = await buildMidweekUpdateDraft({
    userId: session.user.id,
    mondayItemId,
    client,
  })
  if (!draft) {
    return NextResponse.json(
      { error: "Could not compose mid-week draft (Claude call failed or no client snapshot)" },
      { status: 500 },
    )
  }

  const supabase = await createAdminClient()
  const weekOf = mondayOf(new Date())

  // Upsert on (client_id, week_of). On conflict we reset the row to
  // pending — the AM is explicitly asking for a refresh, so a previously
  // sent/dismissed row in the same week gets replaced by the new draft.
  const payload = {
    parts: draft.parts,
    template_version: 2,
    template_name: draft.whatsappTemplateName,
    channel: draft.channel,
    kind: "midweek" as const,
    status: "pending" as const,
  }

  const { data: existing } = await supabase
    .from("weekly_update_drafts")
    .select("id")
    .eq("client_id", clientUuid)
    .eq("week_of", weekOf)
    .maybeSingle<{ id: string }>()

  let draftId: string
  if (existing) {
    const { error: updateErr } = await supabase
      .from("weekly_update_drafts")
      .update(payload)
      .eq("id", existing.id)
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }
    draftId = existing.id
  } else {
    const { data, error: insertErr } = await supabase
      .from("weekly_update_drafts")
      .insert({
        client_id: clientUuid,
        monday_item_id: mondayItemId,
        week_of: weekOf,
        ...payload,
      })
      .select("id")
      .single<{ id: string }>()
    if (insertErr || !data) {
      return NextResponse.json(
        { error: insertErr?.message ?? "Failed to queue draft" },
        { status: 500 },
      )
    }
    draftId = data.id
  }

  const body: QueueClientUpdateResponse = {
    draftId,
    mondayItemId,
    status: "queued",
  }
  return NextResponse.json(body)
}
