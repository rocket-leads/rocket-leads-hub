import { NextRequest, NextResponse } from "next/server"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { ensureClientId } from "@/lib/clients/sync"
import {
  buildWeeklyUpdateDraft,
  lastCompletedWeek,
} from "@/lib/clients/build-weekly-update-draft"
import { fetchKpisForWindow, type KpiSummary } from "@/app/api/kpi-summaries/route"

/**
 * Weekly Update drafts — Monday morning cron.
 *
 * Pre-composes a V2 weekly-update draft for every Live client with a
 * linked Trengo contact, attributed to that client's account manager.
 * Drafts land in `weekly_update_drafts` with status='pending'; the AM
 * sees a banner on /clients counting their pending drafts and reviews
 * + sends each one through the existing Client Update dialog (loaded
 * from the draft's snapshotted `parts`).
 *
 * Why we don't auto-send: WhatsApp messages going out unreviewed is
 * too high-stakes (wrong client context, stale Pedro insight, awkward
 * phrasing). The cron does the 30s of typing per client; the AM keeps
 * the final-word veto.
 *
 * Schedule: Mondays at 06:00 UTC (= 07:00 NL winter, 08:00 NL summer).
 *
 * Idempotency: unique index on (client_id, week_of) means re-runs the
 * same Monday are no-ops. Vercel may retry on transient failure — safe.
 */

export const maxDuration = 300

/** ISO date (YYYY-MM-DD) of the Monday of the week containing `d`.
 *  Computed in UTC so the cron's "this week's Monday" matches whether
 *  the run happens at 06:00 UTC Mon or via a manual mid-week trigger. */
function mondayOf(d: Date): string {
  const day = d.getUTCDay() // 0 = Sunday, 1 = Monday, … 6 = Saturday
  const offsetFromMonday = (day + 6) % 7 // Mon→0, Tue→1, …, Sun→6
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - offsetFromMonday)
  return monday.toISOString().slice(0, 10)
}

/** Look up Monday-AM → Hub-user-id mapping for every AM in one round-trip
 *  instead of a per-client query. Returns a Map keyed by the Monday person
 *  name (case + whitespace as stored). */
async function loadAmNameToUserId(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("user_column_mappings")
    .select("user_id, monday_person_name")
    .eq("monday_column_role", "account_manager")
  const map = new Map<string, string>()
  for (const row of (data ?? []) as Array<{
    user_id: string
    monday_person_name: string
  }>) {
    if (row.monday_person_name) map.set(row.monday_person_name.trim(), row.user_id)
  }
  return map
}

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tracker = startCronRun("weekly-update-drafts")
  const startedAt = Date.now()

  try {
    const supabase = await createAdminClient()
    const weekOf = mondayOf(new Date(startedAt))

    // Use the cached Monday boards when available (refresh-cache cron runs
    // 30 min before this one at 05:30 UTC, so we'll typically hit warm
    // cache). Fall back to a live fetch when cold — slower but correct.
    const cached = await readCache<{ current: MondayClient[] }>("monday_boards")
    const data = cached ?? (await fetchBothBoards())

    // Live + Trengo-linked. Skip Onboarding / On Hold / Churned (no point
    // sending a weekly report when nothing's running) and skip clients
    // without a Trengo contact (we can't send anyway).
    const candidates = data.current.filter(
      (c) => c.campaignStatus === "Live" && !!c.trengoContactId,
    )

    const amNameToUserId = await loadAmNameToUserId(supabase)

    // Pre-fetch KPI for the most-recently-completed Mon-Sun for every
    // candidate in ONE batch instead of 51 sequential per-client fetches.
    // The build pipeline then reads from this map (no internal cache
    // lookup) — keeps the cron's runtime under a minute and guarantees
    // the data exactly matches the date label rendered in the message.
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
      console.error("[weekly-update-drafts] fetchKpisForWindow failed:", e)
      return {} as Record<string, KpiSummary>
    })

    type Skip = { mondayItemId: string; name: string; reason: string }
    const skipped: Skip[] = []
    let created = 0
    // Re-running the same week: drafts the AM hasn't acted on yet get
    // overwritten with fresh content. Counted separately from
    // `keptResolved` so the response makes it obvious whether the rerun
    // actually re-wrote anything.
    let updatedPending = 0
    // Sent / dismissed drafts are never touched — counted for visibility.
    let keptResolved = 0
    let failed = 0

    for (const client of candidates) {
      const amName = client.accountManager?.trim() ?? ""
      const amUserId = amName ? amNameToUserId.get(amName) : undefined
      if (!amUserId) {
        skipped.push({
          mondayItemId: client.mondayItemId,
          name: client.name,
          reason: amName
            ? `Geen Hub-user mapping voor AM "${amName}" (check Settings → Users → Monday mapping)`
            : "Geen AM op Monday item",
        })
        continue
      }

      try {
        // Ensure the Supabase clients row exists so we have a UUID for the
        // FK. ensureClientId is cheap (1 round-trip when already synced).
        const clientUuid = await ensureClientId(client)

        const draft = await buildWeeklyUpdateDraft({
          userId: amUserId,
          mondayItemId: client.mondayItemId,
          client,
          // Pass the pre-fetched weekly KPI through so the builder
          // skips its inline fallback fetch. Null when this client
          // had no data in the bulk fetch.
          kpi: weeklyKpis[client.mondayItemId] ?? null,
          now: new Date(startedAt),
        })
        if (!draft) {
          skipped.push({
            mondayItemId: client.mondayItemId,
            name: client.name,
            reason: "buildWeeklyUpdateDraft returned null (client not found?)",
          })
          continue
        }

        // Upsert-if-pending: re-running the cron the same week replaces
        // any still-pending draft with fresh parts (handy when V2 env was
        // toggled on between runs, or when KPI/Pedro caches refreshed
        // after the first attempt). Sent / dismissed rows are left alone
        // so we don't resurrect work the AM already finished.
        const { data: existing } = await supabase
          .from("weekly_update_drafts")
          .select("id, status")
          .eq("client_id", clientUuid)
          .eq("week_of", weekOf)
          .maybeSingle<{ id: string; status: string }>()

        const payload = {
          parts: draft.parts,
          // Legacy column on weekly_update_drafts — V2 is the only path
          // now, so we always write 2. Kept for backwards-compat with
          // any external dashboards reading the column.
          template_version: 2,
          template_name: draft.whatsappTemplateName,
          channel: draft.channel,
        }

        if (!existing) {
          const { error: insertErr } = await supabase
            .from("weekly_update_drafts")
            .insert({
              client_id: clientUuid,
              monday_item_id: client.mondayItemId,
              week_of: weekOf,
              status: "pending",
              ...payload,
            })
          if (insertErr) {
            failed += 1
            skipped.push({
              mondayItemId: client.mondayItemId,
              name: client.name,
              reason: `DB insert failed: ${insertErr.message}`,
            })
            continue
          }
          created += 1
        } else if (existing.status === "pending") {
          const { error: updateErr } = await supabase
            .from("weekly_update_drafts")
            .update(payload)
            .eq("id", existing.id)
          if (updateErr) {
            failed += 1
            skipped.push({
              mondayItemId: client.mondayItemId,
              name: client.name,
              reason: `DB update failed: ${updateErr.message}`,
            })
            continue
          }
          updatedPending += 1
        } else {
          // sent / dismissed — never touch.
          keptResolved += 1
        }
      } catch (e) {
        failed += 1
        skipped.push({
          mondayItemId: client.mondayItemId,
          name: client.name,
          reason: e instanceof Error ? e.message : "unknown",
        })
      }
    }

    const durationMs = Date.now() - startedAt
    const metrics = {
      weekOf,
      candidates: candidates.length,
      created,
      updatedPending,
      keptResolved,
      failed,
      skipped: skipped.length,
      durationMs,
    }
    await tracker.ok(metrics)
    return NextResponse.json({
      ok: true,
      ...metrics,
      // Include the skip list so manual triggers + Vercel logs surface the
      // missing AM mappings without having to query the DB separately.
      skippedSamples: skipped.slice(0, 20),
    })
  } catch (e) {
    await tracker.fail(e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cron failed" },
      { status: 500 },
    )
  }
}
