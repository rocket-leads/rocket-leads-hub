import { NextRequest, NextResponse } from "next/server"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import {
  buildWeeklyUpdateDraft,
  lastCompletedWeek,
} from "@/lib/clients/build-weekly-update-draft"
import { writeWeeklyUpdateCache, mondayOfUtc } from "@/lib/clients/weekly-update-cache"
import { fetchKpisForWindow, type KpiSummary } from "@/app/api/kpi-summaries/route"

/**
 * Weekly Update pre-cache - Monday morning cron.
 *
 * Pre-composes the weekly Client Update for every Live client with a
 * contact and stores the snapshot in `weekly_update_cache`, keyed by
 * (monday_item_id, week_of). The per-row "Update" dialog reads that
 * snapshot and opens instantly instead of running the 20-40s
 * Meta + Stripe + Pedro + template fan-out live.
 *
 * This does NOT send anything and does NOT surface a queue - the AM still
 * opens each client's dialog and presses send. It only removes the
 * "Update klaarzetten…" wait during Monday's bulk send. Rest of the week,
 * ad-hoc opens live-build and lazily populate the same cache.
 *
 * Schedule: Mondays at 06:00 UTC (= 07:00 NL winter, 08:00 NL summer),
 * 30 min after refresh-cache warms the Monday boards.
 *
 * Idempotency: upsert on (monday_item_id, week_of) - re-runs the same
 * Monday just overwrite with fresh content. Safe on Vercel retry.
 */

export const maxDuration = 300

/** Map Monday-AM name → Hub user id in one round-trip, so buildWeeklyUpdateDraft
 *  can be given a valid userId fallback (it resolves the AM internally too,
 *  but a real id keeps the sign-off name + template resolution correct). */
async function loadAmNameToUserId(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("user_column_mappings")
    .select("user_id, monday_person_name")
    .eq("monday_column_role", "account_manager")
  const map = new Map<string, string>()
  for (const row of (data ?? []) as Array<{ user_id: string; monday_person_name: string }>) {
    if (row.monday_person_name) map.set(row.monday_person_name.trim(), row.user_id)
  }
  return map
}

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tracker = startCronRun("weekly-update-cache")
  const startedAt = Date.now()

  try {
    const supabase = await createAdminClient()
    const weekOf = mondayOfUtc(new Date(startedAt))

    // Warm Monday boards (refresh-cache runs 30 min earlier); live fallback
    // when cold.
    const cached = await readCache<{ current: MondayClient[] }>("monday_boards")
    const data = cached ?? (await fetchBothBoards())

    // Live + reachable only. Onboarding / On Hold / Churned get no weekly
    // report; a client needs a phone or email on Monday to be addressable.
    const candidates = data.current.filter(
      (c) => c.campaignStatus === "Live" && (!!c.phone || !!c.email),
    )

    const amNameToUserId = await loadAmNameToUserId(supabase)

    // Bulk-fetch the most-recently-completed Mon-Sun KPI for every candidate
    // in ONE batch, then hand each slice to the builder so it skips its
    // inline per-client fetch. Keeps the run well under the maxDuration.
    const weekRange = lastCompletedWeek(new Date(startedAt))
    const weeklyKpis: Record<string, KpiSummary> = await fetchKpisForWindow({
      clients: candidates.map((c) => ({
        mondayItemId: c.mondayItemId,
        metaAdAccountId: c.metaAdAccountId || null,
        clientBoardId: c.clientBoardId || null,
      })),
      startDate: weekRange.startDate,
      endDate: weekRange.endDate,
    }).catch((e) => {
      console.error("[weekly-update-cache] fetchKpisForWindow failed:", e)
      return {} as Record<string, KpiSummary>
    })

    type Skip = { mondayItemId: string; name: string; reason: string }
    const skipped: Skip[] = []
    let cachedCount = 0
    let failed = 0

    for (const client of candidates) {
      const amName = client.accountManager?.trim() ?? ""
      const amUserId = amName ? amNameToUserId.get(amName) : undefined
      if (!amUserId) {
        skipped.push({
          mondayItemId: client.mondayItemId,
          name: client.name,
          reason: amName
            ? `Geen Hub-user mapping voor AM "${amName}"`
            : "Geen AM op Monday item",
        })
        continue
      }

      try {
        const draft = await buildWeeklyUpdateDraft({
          userId: amUserId,
          mondayItemId: client.mondayItemId,
          client,
          kpi: weeklyKpis[client.mondayItemId] ?? null,
          now: new Date(startedAt),
        })
        if (!draft) {
          skipped.push({
            mondayItemId: client.mondayItemId,
            name: client.name,
            reason: "buildWeeklyUpdateDraft returned null",
          })
          continue
        }

        await writeWeeklyUpdateCache({
          mondayItemId: client.mondayItemId,
          weekOf,
          parts: draft.parts,
          channel: draft.channel,
          templateName: draft.whatsappTemplateName,
        })
        cachedCount += 1
      } catch (e) {
        failed += 1
        skipped.push({
          mondayItemId: client.mondayItemId,
          name: client.name,
          reason: `build/cache failed: ${e instanceof Error ? e.message : "unknown"}`,
        })
      }
    }

    const metrics = {
      weekOf,
      candidates: candidates.length,
      cached: cachedCount,
      skipped: skipped.length,
      failed,
      durationMs: Date.now() - startedAt,
    }

    if (failed > 0) {
      await tracker.partial(`${failed} client(s) failed to pre-cache`, metrics)
    } else {
      await tracker.ok(metrics)
    }

    return NextResponse.json({ ok: true, ...metrics, skipped })
  } catch (e) {
    await tracker.fail(e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "weekly-update-cache failed" },
      { status: 500 },
    )
  }
}
