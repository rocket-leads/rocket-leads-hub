import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"

/**
 * Watch List quick action: create an inbox task assigned to the client's
 * Campaign Manager in one click. Used by the "Create task" column on the
 * Watch List home page - Roy wants to fire-and-forget a CM nudge for any
 * row without opening the full composer.
 *
 * Resolves the CM via user_column_mappings (monday_column_role =
 * "campaign_manager" + monday_person_name = client.campaignManager). If
 * the CM isn't mapped to a Hub user we return 404 - the caller surfaces
 * a "CM not mapped" toast.
 *
 * Default title is "Watch List: {clientName} - actie nodig" (NL) or "…
 * action needed" (EN) - the caller passes the rendered title so the
 * endpoint stays locale-agnostic.
 */

type Body = {
  mondayItemId: string
  campaignManager: string | null
  /** Pre-rendered title from the client (so this endpoint doesn't need to
   *  know about i18n). */
  title: string
  /** Optional body - when the caller used the edit dialog, this is the
   *  AI-prefilled + possibly user-edited context. Empty/null means the
   *  task lands with no body (title-only). */
  taskBody?: string | null
  /** ISO date string (YYYY-MM-DD). Defaults to today if absent - that's
   *  the historical behaviour from the instant-create button. */
  dueDate?: string | null
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as Body | null
  if (!body?.mondayItemId || !body.title?.trim()) {
    return NextResponse.json(
      { error: "mondayItemId and title are required" },
      { status: 400 },
    )
  }

  if (!body.campaignManager?.trim()) {
    return NextResponse.json(
      { error: "no_cm", message: "This client has no Campaign Manager set in Monday." },
      { status: 422 },
    )
  }

  const supabase = await createAdminClient()

  // Resolve CM Monday name → Hub user id. Same pattern as
  // `resolveCmUserId` in pedro/monthly-digest.ts.
  const { data: mapping } = await supabase
    .from("user_column_mappings")
    .select("user_id")
    .eq("monday_column_role", "campaign_manager")
    .eq("monday_person_name", body.campaignManager.trim())
    .maybeSingle<{ user_id: string }>()

  if (!mapping?.user_id) {
    return NextResponse.json(
      {
        error: "no_mapping",
        message: `Campaign Manager "${body.campaignManager}" is not mapped to a Hub user.`,
      },
      { status: 404 },
    )
  }

  // Default due date = today (the original instant-create UX). When the
  // caller passes a YYYY-MM-DD it overrides; anything malformed falls
  // back to today rather than rejecting - the dialog already validates
  // the picker so an invalid value here is a programming error, not
  // user input.
  const today = new Date().toISOString().slice(0, 10)
  const isIsoDay = (s: unknown): s is string =>
    typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)
  const dueDate = isIsoDay(body.dueDate) ? body.dueDate : today

  const taskBody = typeof body.taskBody === "string" && body.taskBody.trim()
    ? body.taskBody.trim().slice(0, 4000)
    : null

  const { data, error } = await supabase
    .from("inbox_events")
    .insert({
      kind: "task",
      client_id: body.mondayItemId,
      author_id: session.user.id,
      assignee_id: mapping.user_id,
      title: body.title.trim(),
      body: taskBody,
      status: "open",
      priority: "normal",
      due_date: dueDate,
      source: "manual",
      source_ref: { from: "watchlist_quick_task" },
    })
    .select("id")
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create task" },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, taskId: data.id, assigneeUserId: mapping.user_id })
}
