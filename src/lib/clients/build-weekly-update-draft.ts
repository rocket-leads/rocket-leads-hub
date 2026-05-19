import { createAdminClient } from "@/lib/supabase/server"
import { fetchClientById, type MondayClient } from "@/lib/integrations/monday"
import { parsePedroBody } from "@/lib/pedro/insights/types"
import { readCache } from "@/lib/cache"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import {
  composeInitialParts,
  type EditableParts,
} from "@/lib/clients/client-update-template"
import {
  resolveWeeklyUpdateTemplate,
  type WaTemplateResolution,
} from "@/lib/clients/resolve-wa-template"

/**
 * Shared "build a weekly update draft for ONE client" pipeline.
 *
 * Used by the Monday-morning cron (`/api/cron/weekly-update-drafts`) and
 * the interactive Client Update dialog endpoint so both walk identical
 * composition logic — KPI + Pedro lookup, hardcoded `rl_weekly_<voornaam>`
 * template resolution, channel detection.
 *
 * WhatsApp path: always uses the V2 multi-variable template
 * (`rl_weekly_<voornaam>`). No env flag, no V1 fallback. If the template
 * isn't approved in Trengo yet, Trengo errors at send-time with a clear
 * "template not found" — better than the old silent V1 fallback which
 * hid the misconfiguration.
 *
 * Email path: skips template resolution entirely. Trengo's email endpoint
 * accepts the multi-line body free-text with our own greeting + sign-off
 * baked into the content.
 */

export type WeeklyUpdateChannel = "whatsapp" | "email" | "unknown"

export type WeeklyUpdateDraftResult = {
  parts: EditableParts
  channel: WeeklyUpdateChannel
  channelLabel: string
  trengoContactLinked: boolean
  /** Resolved `rl_weekly_<voornaam>` slug for the WhatsApp path. Null for
   *  email channels or when we can't derive a clean first name from
   *  users.name (rare; user row needs fixing). */
  whatsappTemplateName: string | null
  whatsappTemplateSource: WaTemplateResolution["source"]
}

export function detectChannel(label: string): WeeklyUpdateChannel {
  const l = (label ?? "").toLowerCase()
  if (l.includes("whatsapp") || l.includes("wa") || l.includes("app")) return "whatsapp"
  if (l.includes("email") || l.includes("mail")) return "email"
  return "unknown"
}

async function loadKpi(mondayItemId: string): Promise<KpiSummary | null> {
  const cache = await readCache<Record<string, KpiSummary>>("kpi_summaries")
  return cache?.[mondayItemId] ?? null
}

async function loadPedroBody(mondayItemId: string) {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("pedro_insights")
    .select("body")
    .eq("monday_item_id", mondayItemId)
    .eq("insight_type", "client_pedro")
    .maybeSingle()
  return parsePedroBody(data?.body ?? null)
}

async function loadHubUserName(userId: string): Promise<{ name: string | null } | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("users")
    .select("name")
    .eq("id", userId)
    .maybeSingle<{ name: string | null }>()
  return data
}

/**
 * Look up the Hub user id of the AM assigned to this client on Monday.
 *
 * Why: the template (`rl_weekly_<voornaam>`) belongs to the AM, not to
 * whoever happens to be logged in. When Roy (admin) reviews Danny's
 * client in the queue, the WhatsApp message should still go out as
 * Danny's template — that's the slug the Trengo channel has approved
 * AND the slug whose body contains "Groetjes, Danny".
 *
 * Returns null when the Monday `accountManager` field is empty OR the
 * mapping isn't set up in Settings → Users yet. Callers fall back to
 * the logged-in user's id in that case so a missing mapping doesn't
 * block sends entirely.
 */
export async function resolveAmUserIdForClient(
  monday: MondayClient,
): Promise<string | null> {
  const amName = monday.accountManager?.trim()
  if (!amName) return null
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("user_column_mappings")
    .select("user_id")
    .eq("monday_column_role", "account_manager")
    .eq("monday_person_name", amName)
    .maybeSingle<{ user_id: string }>()
  return data?.user_id ?? null
}

/**
 * Compose a draft for the given client + user. `client` can be passed in
 * when the caller already has the Monday row (cron pre-fetches all clients
 * in one batch — we don't want to re-fetch one-by-one per client).
 *
 * `userId` is the FALLBACK identity for template resolution. The function
 * always tries the client's assigned AM first (via Monday accountManager
 * → user_column_mappings); only when no mapping exists does it fall back
 * to the passed `userId`. This keeps Roy-as-admin reviewing a Danny client
 * sending out as Danny's template, not Roy's.
 */
export async function buildWeeklyUpdateDraft(args: {
  userId: string
  mondayItemId: string
  /** Pre-loaded client row to skip the per-call Monday fetch. When omitted,
   *  we fetch via fetchClientById. The dialog endpoint always omits this;
   *  the cron always passes it. */
  client?: MondayClient
}): Promise<WeeklyUpdateDraftResult | null> {
  const client = args.client ?? (await fetchClientById(args.mondayItemId))
  if (!client) return null

  const channel = detectChannel(client.contactChannel)
  const isEmail = channel === "email"

  // Whose template + sign-off name to use. Prefer the AM mapped to this
  // client on Monday; fall back to the calling user when no mapping
  // exists so the dialog still works for un-mapped clients.
  const amUserId = (await resolveAmUserIdForClient(client)) ?? args.userId

  // Always resolve the weekly template for WhatsApp. Email skips it.
  const [kpi, pedro, waTemplate, hubUser] = await Promise.all([
    loadKpi(args.mondayItemId),
    loadPedroBody(args.mondayItemId),
    isEmail
      ? Promise.resolve({ name: null as string | null, source: "none" as const })
      : resolveWeeklyUpdateTemplate({ userId: amUserId, mondayItemId: args.mondayItemId }),
    loadHubUserName(amUserId),
  ])

  // AM first name for the email sign-off + WhatsApp preview. Prefer the
  // resolved slug (`rl_weekly_danny` → "danny") so the rendered text
  // matches the template; fall back to the AM user's `users.name`.
  const amFirstName =
    (waTemplate.name?.replace(/^rl_weekly_/i, "").trim() ||
      hubUser?.name?.split(/\s+/)[0] ||
      "Roel").toString()

  const composed = composeInitialParts({
    firstName: client.firstName,
    clientId: client.mondayItemId,
    clientName: client.companyName || client.name,
    amFirstName,
    channel,
    kpi,
    pedro,
  })

  return {
    parts: composed.parts,
    channel,
    channelLabel: client.contactChannel,
    trengoContactLinked: !!client.trengoContactId,
    whatsappTemplateName: waTemplate.name,
    whatsappTemplateSource: waTemplate.source,
  }
}
