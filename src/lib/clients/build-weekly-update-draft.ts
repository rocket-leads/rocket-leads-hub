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
  resolveWaTemplate,
  resolveWeeklyUpdateTemplate,
  type WaTemplateResolution,
} from "@/lib/clients/resolve-wa-template"

/**
 * Shared "build a weekly update draft for ONE client" pipeline.
 *
 * Originally lived inline in the GET /client-update route. Hoisted here so
 * the Monday-morning cron (`/api/cron/weekly-update-drafts`) and the
 * interactive dialog endpoint both walk the SAME composition logic — KPI
 * + Pedro lookup, V2/V1 template resolution, channel detection — without
 * duplicating fallback rules or AM-name extraction.
 *
 * Returns enough data to:
 *   - render the dialog identically whether the draft was pre-generated or
 *     freshly composed on open
 *   - persist into `weekly_update_drafts` (cron path) including the
 *     resolved template name + version so re-opening doesn't re-resolve
 *     against a potentially-different Trengo state.
 */

export type WeeklyUpdateChannel = "whatsapp" | "email" | "unknown"

export type WeeklyUpdateDraftResult = {
  parts: EditableParts
  channel: WeeklyUpdateChannel
  channelLabel: string
  trengoContactLinked: boolean
  whatsappTemplateName: string | null
  whatsappTemplateSource: WaTemplateResolution["source"]
  /** 1 = V1 universal single-var. 2 = V2 multi-var weekly. Null when email. */
  templateVersion: 1 | 2 | null
  /** Human-readable diagnostic — null when V2 active or email. */
  templateVersionReason: string | null
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
 * Compose a draft for the given client + user. `client` can be passed in
 * when the caller already has the Monday row (cron pre-fetches all clients
 * in one batch — we don't want to re-fetch one-by-one per client).
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
  const v2Enabled = !isEmail && process.env.WEEKLY_UPDATE_TEMPLATE_V2 === "true"

  const [kpi, pedro, v2Template, hubUser] = await Promise.all([
    loadKpi(args.mondayItemId),
    loadPedroBody(args.mondayItemId),
    v2Enabled
      ? resolveWeeklyUpdateTemplate({ userId: args.userId, mondayItemId: args.mondayItemId })
      : Promise.resolve({ name: null as string | null, source: "none" as const }),
    loadHubUserName(args.userId),
  ])

  const useV2 = !!v2Template.name
  const v1Template =
    isEmail || useV2
      ? { name: null as string | null, source: "none" as const }
      : await resolveWaTemplate({ userId: args.userId, mondayItemId: args.mondayItemId })

  const waTemplate = useV2 ? v2Template : v1Template

  let templateVersionReason: string | null = null
  if (!isEmail && !useV2) {
    if (!v2Enabled) {
      templateVersionReason =
        "WEEKLY_UPDATE_TEMPLATE_V2 env-flag staat uit in Vercel (zet 'm op true en redeploy)."
    } else {
      // Hardcoded resolver only returns null when users.name can't be
      // parsed into an ASCII first name. Everything else (template not
      // existing in Trengo) bubbles up as an error at send-time.
      const amSlug = hubUser?.name?.split(/\s+/)[0]?.toLowerCase() ?? "<voornaam>"
      templateVersionReason = `Kan voornaam niet afleiden uit users.name (verwacht rl_weekly_${amSlug}). Check Settings → Users.`
    }
  }

  const amFirstName =
    (waTemplate.name?.replace(/^rl_(weekly|universal)_/i, "").trim() ||
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
    templateVersion: isEmail ? null : useV2 ? 2 : 1,
    templateVersionReason,
  }
}
