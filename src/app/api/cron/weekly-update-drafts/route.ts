import { NextRequest, NextResponse } from "next/server"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { ensureClientId } from "@/lib/clients/sync"
import { buildWeeklyUpdateDraft } from "@/lib/clients/build-weekly-update-draft"

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

    type Skip = { mondayItemId: string; name: string; reason: string }
    const skipped: Skip[] = []
    let created = 0
    let alreadyExists = 0
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
        })
        if (!draft) {
          skipped.push({
            mondayItemId: client.mondayItemId,
            name: client.name,
            reason: "buildWeeklyUpdateDraft returned null (client not found?)",
          })
          continue
        }

        const { error: insertErr } = await supabase
          .from("weekly_update_drafts")
          .insert({
            client_id: clientUuid,
            monday_item_id: client.mondayItemId,
            week_of: weekOf,
            parts: draft.parts,
            template_version: draft.templateVersion ?? 1,
            template_name: draft.whatsappTemplateName,
            channel: draft.channel,
            status: "pending",
          })

        if (insertErr) {
          // 23505 = unique_violation → draft already exists for this week.
          // Treat as idempotency success, not failure.
          if (insertErr.code === "23505") {
            alreadyExists += 1
          } else {
            failed += 1
            skipped.push({
              mondayItemId: client.mondayItemId,
              name: client.name,
              reason: `DB insert failed: ${insertErr.message}`,
            })
          }
          continue
        }

        created += 1
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
      alreadyExists,
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
