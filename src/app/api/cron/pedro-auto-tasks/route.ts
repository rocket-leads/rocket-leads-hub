import { NextRequest, NextResponse } from "next/server"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { fetchBothBoards } from "@/lib/integrations/monday"
import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import { categorize, severityScore, type WatchCategory } from "@/lib/watchlist/categorize"
import {
  decideForClient,
  decideAutoClose,
  PEDRO_TASK_MARKER,
  type DecideInput,
  type SkipReason,
} from "@/lib/pedro/auto-tasks"

/**
 * Pedro background co-pilot — daily auto-task generation + auto-close.
 *
 * Fans out across all Live clients, calls the pure decideForClient()
 * function with a context bundle, and writes inbox_events for each
 * "create" decision. Then a separate auto-close pass scans open Pedro
 * tasks and closes any whose underlying client has left the Action
 * bucket.
 *
 * Anti-spam invariants are enforced in decideForClient (see
 * src/lib/pedro/auto-tasks.ts) — bucket gate, stickiness gate,
 * severity gate, dedup, per-CM cap. Read that module before tweaking
 * trigger logic here.
 *
 * Schedule: daily at 7 UTC. One pass per day. Never hourly — the whole
 * point of this co-pilot is to surface "what should I look at TODAY",
 * not to keep firing every 30 minutes.
 *
 * Idempotent: re-running the cron the same day is safe — dedup gate
 * skips clients that already have an open Pedro task, auto-close skips
 * clients that have already been closed.
 */

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tracker = startCronRun("pedro-auto-tasks")
  const startedAt = Date.now()

  try {
    const supabase = await createAdminClient()
    const nowIso = new Date(startedAt).toISOString()

    // ─── 1. Inputs ──────────────────────────────────────────────────────

    const cached = await readCache<{ current: MondayClient[] }>("monday_boards")
    const data = cached ?? (await fetchBothBoards())
    const liveClients = data.current.filter((c) => c.campaignStatus === "Live")

    const kpiCache = (await readCache<Record<string, KpiSummary>>("kpi_summaries")) ?? {}

    // Days-in-bucket comes from the watchlist_client_state table — same
    // source the Watch List UI reads. Skip clients whose state is unknown
    // (the state table populates on the daily cron).
    const { data: stateRows } = await supabase
      .from("watchlist_client_state")
      .select("monday_item_id, category, since_date")
    const stateByClient = new Map<string, { category: string; sinceDate: string }>()
    for (const row of stateRows ?? []) {
      stateByClient.set(row.monday_item_id, {
        category: row.category,
        sinceDate: row.since_date,
      })
    }

    // Existing Pedro tasks — by client and by assignee. We pull all rows
    // regardless of status because the dedup gate checks done timestamps
    // for the recently-closed window. Filter by source='automation' AND
    // the marker on source_ref so we don't collide with the existing
    // inbox_automations cron (which also writes source='automation').
    const { data: pedroTaskRows } = await supabase
      .from("inbox_events")
      .select("id, client_id, assignee_id, status, completed_at, source_ref")
      .eq("source", "automation")
      .eq("kind", "task")
      .contains("source_ref", { marker: PEDRO_TASK_MARKER })

    type PedroTaskRow = {
      id: string
      client_id: string
      assignee_id: string
      status: string
      completed_at: string | null
      source_ref: Record<string, unknown> | null
    }
    const pedroTasks = (pedroTaskRows ?? []) as PedroTaskRow[]

    // Latest Pedro task per client (any status) — by completed_at desc
    // when present, else by row order. Used by the dedup gate.
    const latestPedroTaskByClient = new Map<string, PedroTaskRow>()
    for (const t of pedroTasks) {
      const existing = latestPedroTaskByClient.get(t.client_id)
      if (!existing) {
        latestPedroTaskByClient.set(t.client_id, t)
        continue
      }
      // Prefer the most-recent open-or-in-progress task; otherwise the
      // most recently completed one. "Open beats closed" matches the
      // dedup gate's preference.
      const existingActive = existing.status === "open" || existing.status === "in_progress"
      const candidateActive = t.status === "open" || t.status === "in_progress"
      if (candidateActive && !existingActive) {
        latestPedroTaskByClient.set(t.client_id, t)
      }
    }

    // Count of OPEN Pedro tasks per assignee — feeds the per-CM cap.
    const openCountByAssignee = new Map<string, number>()
    for (const t of pedroTasks) {
      if (t.status === "open" || t.status === "in_progress") {
        openCountByAssignee.set(t.assignee_id, (openCountByAssignee.get(t.assignee_id) ?? 0) + 1)
      }
    }

    // CM Monday-name → Hub user_id mapping. Pedro tasks are assigned to
    // the campaign manager when one is mapped; falls back to AM, then
    // skip if neither is mapped.
    const { data: mappingRows } = await supabase
      .from("user_column_mappings")
      .select("user_id, monday_column_role, monday_person_name")
      .in("monday_column_role", ["campaign_manager", "account_manager"])
    const cmByName = new Map<string, string>()
    const amByName = new Map<string, string>()
    for (const m of mappingRows ?? []) {
      if (m.monday_column_role === "campaign_manager") cmByName.set(m.monday_person_name, m.user_id)
      else amByName.set(m.monday_person_name, m.user_id)
    }

    // ─── 2. Decision pass — create candidates ──────────────────────────

    const created: Array<{ client: string; assignee: string }> = []
    const skipped: Record<SkipReason, number> = {
      not_in_action: 0,
      too_fresh: 0,
      low_severity: 0,
      open_task_exists: 0,
      recently_closed: 0,
      assignee_at_cap: 0,
      no_assignee: 0,
    }

    for (const client of liveClients) {
      const kpi = kpiCache[client.mondayItemId]
      const { category } = categorize(client, kpi)
      if (category !== "action") {
        skipped.not_in_action++
        continue
      }

      const state = stateByClient.get(client.mondayItemId)
      const daysInBucket = state?.category === "action" && state.sinceDate
        ? daysBetween(state.sinceDate, nowIso.slice(0, 10))
        : null

      const severity = kpi ? severityScore(kpi) : 0
      const assigneeUserId =
        cmByName.get(client.campaignManager) ??
        amByName.get(client.accountManager) ??
        null

      const existingTask = latestPedroTaskByClient.get(client.mondayItemId)

      const decideInput: DecideInput = {
        client,
        category,
        daysInBucket,
        severity,
        assigneeUserId,
        existingPedroTask: existingTask
          ? { status: existingTask.status, completedAt: existingTask.completed_at }
          : null,
        openTasksForAssignee: assigneeUserId
          ? openCountByAssignee.get(assigneeUserId) ?? 0
          : 0,
        now: nowIso,
      }

      const decision = decideForClient(decideInput)
      if (decision.action === "skip") {
        skipped[decision.reason]++
        continue
      }

      // Create the task. Idempotent on client_id + marker — re-running the
      // cron the same day won't create a duplicate because the dedup gate
      // sees the just-created row as "open".
      try {
        await supabase.from("inbox_events").insert({
          kind: "task",
          client_id: client.mondayItemId,
          author_id: decision.assigneeUserId, // Pedro writes-as-CM (no separate Pedro user)
          assignee_id: decision.assigneeUserId,
          title: decision.title,
          body: decision.body,
          status: "open",
          priority: "high",
          source: "automation",
          source_ref: decision.sourceRef,
        })
        created.push({ client: client.name, assignee: decision.assigneeUserId })

        // Increment the local cap counter so subsequent clients in this
        // pass also respect the cap (otherwise we'd over-shoot when one
        // CM has many candidates).
        openCountByAssignee.set(
          decision.assigneeUserId,
          (openCountByAssignee.get(decision.assigneeUserId) ?? 0) + 1,
        )
      } catch (e) {
        console.error(
          `[pedro-auto-tasks] insert failed for ${client.name}:`,
          e instanceof Error ? e.message : e,
        )
      }
    }

    // ─── 3. Auto-close pass — close tasks whose client left Action ─────

    const liveClientById = new Map(liveClients.map((c) => [c.mondayItemId, c]))
    let autoClosed = 0

    for (const t of pedroTasks) {
      if (t.status !== "open" && t.status !== "in_progress") continue
      const client = liveClientById.get(t.client_id)
      const currentCategory: WatchCategory = client
        ? categorize(client, kpiCache[t.client_id]).category
        : "no-data" // client not Live anymore → treat as left Action

      const decision = decideAutoClose(currentCategory)
      if (!decision.close) continue

      try {
        await supabase
          .from("inbox_events")
          .update({
            status: "done",
            completed_at: nowIso,
            // Append a short note to the body so the CM sees WHY it auto-closed
            // when they look at the closed task later.
            body: appendAutoCloseNote(t, decision.reason),
          })
          .eq("id", t.id)
        autoClosed++
      } catch (e) {
        console.error(
          `[pedro-auto-tasks] auto-close failed for task ${t.id}:`,
          e instanceof Error ? e.message : e,
        )
      }
    }

    const metrics = {
      durationMs: Date.now() - startedAt,
      liveClients: liveClients.length,
      created: created.length,
      autoClosed,
      ...skipped,
    }
    await tracker.ok(metrics)

    return NextResponse.json({
      ok: true,
      ...metrics,
      created: created.slice(0, 10),
    })
  } catch (e) {
    console.error("[pedro-auto-tasks] fatal:", e instanceof Error ? e.message : e)
    await tracker.fail(e)
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

function daysBetween(fromDate: string, toDate: string): number {
  const a = new Date(fromDate + "T00:00:00Z").getTime()
  const b = new Date(toDate + "T00:00:00Z").getTime()
  return Math.max(0, Math.floor((b - a) / 86_400_000))
}

function appendAutoCloseNote(
  task: { body?: string | null; source_ref: Record<string, unknown> | null },
  reason: string,
): string {
  const existing = (task.body ?? "").trim()
  const note = `\n\n---\n[Auto-closed by Pedro]\n${reason}`
  // Avoid duplicating the marker if the cron somehow re-runs against an
  // already-marked row (defensive — we already gate on status above).
  if (existing.includes("[Auto-closed by Pedro]")) return existing
  return existing + note
}
