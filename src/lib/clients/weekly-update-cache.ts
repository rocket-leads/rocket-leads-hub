import { createAdminClient } from "@/lib/supabase/server"
import type { EditableParts } from "@/lib/clients/client-update-template"
import type { WeeklyUpdateChannel } from "@/lib/clients/build-weekly-update-draft"

/**
 * Read/write helpers for `weekly_update_cache` - the Monday-morning
 * pre-cache of composed weekly Client Update snapshots.
 *
 * The Monday 06:00 UTC cron fills this for every Live client; the
 * "Update" dialog endpoint reads it (instant open) and lazily writes on a
 * miss so the second open is fast too. Keyed by (monday_item_id, week_of)
 * where week_of is the ISO Monday of the current week in UTC - the same
 * anchor the cron uses, so both sides agree on "this week".
 */

export type WeeklyUpdateCacheRow = {
  parts: EditableParts
  channel: WeeklyUpdateChannel
  templateName: string | null
}

/** ISO date (YYYY-MM-DD) of the Monday of the week containing `d`, in UTC.
 *  Shared by the cron writer and the dialog reader so a snapshot written
 *  Monday morning is found on every open through the following Sunday. */
export function mondayOfUtc(d: Date = new Date()): string {
  const day = d.getUTCDay() // 0 = Sunday, 1 = Monday, … 6 = Saturday
  const offsetFromMonday = (day + 6) % 7 // Mon→0, Tue→1, …, Sun→6
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - offsetFromMonday)
  return monday.toISOString().slice(0, 10)
}

/** Fetch a cached snapshot for a client + week. Returns null on a miss or
 *  any lookup error (a cache failure must never block the live build). */
export async function readWeeklyUpdateCache(
  mondayItemId: string,
  weekOf: string = mondayOfUtc(),
): Promise<WeeklyUpdateCacheRow | null> {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from("weekly_update_cache")
      .select("parts, channel, template_name")
      .eq("monday_item_id", mondayItemId)
      .eq("week_of", weekOf)
      .maybeSingle<{
        parts: EditableParts | null
        channel: string | null
        template_name: string | null
      }>()
    if (!data?.parts) return null
    const channel: WeeklyUpdateChannel =
      data.channel === "email" || data.channel === "whatsapp" ? data.channel : "unknown"
    return { parts: data.parts, channel, templateName: data.template_name }
  } catch (e) {
    console.error(
      "[weekly-update-cache] read failed:",
      e instanceof Error ? e.message : e,
    )
    return null
  }
}

/** Upsert a snapshot for a client + week. Best-effort: a write failure is
 *  logged and swallowed (the caller already has the built parts to serve). */
export async function writeWeeklyUpdateCache(args: {
  mondayItemId: string
  parts: EditableParts
  channel: WeeklyUpdateChannel
  templateName: string | null
  weekOf?: string
}): Promise<void> {
  try {
    const supabase = await createAdminClient()
    await supabase.from("weekly_update_cache").upsert(
      {
        monday_item_id: args.mondayItemId,
        week_of: args.weekOf ?? mondayOfUtc(),
        parts: args.parts,
        channel: args.channel,
        template_name: args.templateName,
        built_at: new Date().toISOString(),
      },
      { onConflict: "monday_item_id,week_of" },
    )
  } catch (e) {
    console.error(
      "[weekly-update-cache] write failed:",
      e instanceof Error ? e.message : e,
    )
  }
}
