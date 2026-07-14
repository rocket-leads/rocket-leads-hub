import { createAdminClient } from "@/lib/supabase/server"
import { fetchClientById, type MondayClient } from "@/lib/integrations/monday"
import {
  fetchOverdueInvoices,
  type OverdueInvoice,
} from "@/lib/integrations/stripe"
import { parsePedroBody } from "@/lib/pedro/insights/types"
import {
  fetchKpisForWindow,
  type KpiSummary,
} from "@/app/api/kpi-summaries/route"
import {
  composeInitialParts,
  type EditableParts,
} from "@/lib/clients/client-update-template"
import {
  resolveWeeklyUpdateTemplate,
  type WaTemplateResolution,
} from "@/lib/clients/resolve-wa-template"
import { resolveClientSendChannel } from "@/lib/clients/send-channel"

/**
 * Shared "build a weekly update draft for ONE client" pipeline.
 *
 * Called by the interactive Client Update dialog endpoint
 * (`POST /api/clients/[id]/client-update`) each time an AM opens the
 * "Update" button on the clients table - KPI + Pedro lookup, hardcoded
 * `rl_weekly_<voornaam>` template resolution, channel detection.
 *
 * WhatsApp path: always uses the V2 multi-variable template
 * (`rl_weekly_<voornaam>`). No env flag, no V1 fallback. If the template
 * isn't approved in Trengo yet, Trengo errors at send-time with a clear
 * "template not found" - better than the old silent V1 fallback which
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
  /** Whether the draft has enough contact info on Monday (phone for
   *  WhatsApp, email for Email) to be sent. Was named after the legacy
   *  trengo_contact_id link; semantics now driven by Monday's phone +
   *  email columns. Kept under the same field name so existing dialog
   *  client code (client-update-button.tsx) keeps working unchanged. */
  trengoContactLinked: boolean
  /** Resolved `rl_weekly_<voornaam>` slug for the WhatsApp path. Null for
   *  email channels or when we can't derive a clean first name from
   *  users.name (rare; user row needs fixing). */
  whatsappTemplateName: string | null
  whatsappTemplateSource: WaTemplateResolution["source"]
  /** Email + phone pulled directly from Monday's client columns, shown
   *  in the dialog as "To: <address>" so the user verifies the actual
   *  recipient before pressing send. Used to come from a Trengo contact
   *  lookup; now sourced from Monday so the preview matches what the
   *  send path will actually use. */
  recipientEmail: string | null
  recipientPhone: string | null
}

export function detectChannel(label: string): WeeklyUpdateChannel {
  const l = (label ?? "").toLowerCase()
  if (l.includes("whatsapp") || l.includes("wa") || l.includes("app")) return "whatsapp"
  if (l.includes("email") || l.includes("mail")) return "email"
  return "unknown"
}

/** Format an ISO date (YYYY-MM-DD) in UTC. */
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Range covering the most recently completed Monday → Sunday week,
 * in UTC. Anchor on `now` so calling on Monday morning still gives
 * "last week" rather than "the week we're currently in".
 *
 * Examples (all UTC):
 *   now = Mon 2026-05-18 06:00 → { start: 2026-05-11, end: 2026-05-17 }
 *   now = Tue 2026-05-19 08:00 → { start: 2026-05-11, end: 2026-05-17 }
 *   now = Sun 2026-05-24 23:59 → { start: 2026-05-11, end: 2026-05-17 }
 */
export function lastCompletedWeek(now: Date = new Date()): { startDate: string; endDate: string } {
  const day = now.getUTCDay() // 0 = Sun, 1 = Mon, ... 6 = Sat
  const sundayOffset = day === 0 ? 7 : day // Sun → 7 days back, Mon → 1, etc.
  const lastSunday = new Date(now)
  lastSunday.setUTCDate(now.getUTCDate() - sundayOffset)
  const lastMonday = new Date(lastSunday)
  lastMonday.setUTCDate(lastSunday.getUTCDate() - 6)
  return { startDate: fmtDate(lastMonday), endDate: fmtDate(lastSunday) }
}

/**
 * Format a date range as "11 t/m 17 mei" (Dutch). Years dropped when
 * both ends fall in the current year; months dropped on the start when
 * both sides land in the same month.
 */
export function formatWeekLabel(startISO: string, endISO: string): string {
  const start = new Date(`${startISO}T00:00:00Z`)
  const end = new Date(`${endISO}T00:00:00Z`)
  const months = [
    "jan", "feb", "mrt", "apr", "mei", "jun",
    "jul", "aug", "sep", "okt", "nov", "dec",
  ]
  const sd = start.getUTCDate()
  const sm = months[start.getUTCMonth()]
  const ed = end.getUTCDate()
  const em = months[end.getUTCMonth()]
  if (sm === em) return `${sd} t/m ${ed} ${em}`
  return `${sd} ${sm} t/m ${ed} ${em}`
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
 * Danny's template - that's the slug the Trengo channel has approved
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
 * in one batch - we don't want to re-fetch one-by-one per client).
 *
 * `userId` is the FALLBACK identity for template resolution. The function
 * always tries the client's assigned AM first (via Monday accountManager
 * → user_column_mappings); only when no mapping exists does it fall back
 * to the passed `userId`. This keeps Roy-as-admin reviewing a Danny client
 * sending out as Danny's template, not Roy's.
 *
 * KPI strategy: the weekly update is a snapshot of LAST WEEK (Monday
 * through Sunday), not a rolling 7d window. The cron pre-fetches KPI
 * for every Live client for that specific range and passes the result
 * in via `kpi`. When `kpi` is omitted (dialog calling for a single
 * client), the function fetches inline for the same Mon-Sun range.
 */
export async function buildWeeklyUpdateDraft(args: {
  userId: string
  mondayItemId: string
  /** Pre-loaded client row to skip the per-call Monday fetch. When omitted,
   *  we fetch via fetchClientById. The dialog endpoint always omits this;
   *  the cron always passes it. */
  client?: MondayClient
  /** Pre-fetched KPI for this client + the weekly window. When omitted,
   *  we fetch fresh for the most recently completed Mon-Sun. Cron passes
   *  this from its bulk fetch; dialog skips and lets us fetch one. */
  kpi?: KpiSummary | null
  /** Override the "last completed week" anchor. Used in tests; production
   *  callers leave it undefined so we anchor on real time. */
  now?: Date
}): Promise<WeeklyUpdateDraftResult | null> {
  const client = args.client ?? (await fetchClientById(args.mondayItemId))
  if (!client) return null

  const channel = detectChannel(client.contactChannel)
  const isEmail = channel === "email"

  // Whose template + sign-off name to use. Prefer the AM mapped to this
  // client on Monday; fall back to the calling user when no mapping
  // exists so the dialog still works for un-mapped clients.
  const amUserId = (await resolveAmUserIdForClient(client)) ?? args.userId

  // Fresh per-week KPI fetch when the caller didn't pre-load one.
  const weekRange = lastCompletedWeek(args.now)
  const kpiPromise: Promise<KpiSummary | null> =
    args.kpi !== undefined
      ? Promise.resolve(args.kpi)
      : fetchKpisForWindow({
          clients: [
            {
              mondayItemId: client.mondayItemId,
              metaAdAccountId: client.metaAdAccountId || null,
              clientBoardId: client.clientBoardId || null,
            },
          ],
          startDate: weekRange.startDate,
          endDate: weekRange.endDate,
        })
          .then((map) => map[client.mondayItemId] ?? null)
          .catch(() => null)

  // Always resolve the weekly template for WhatsApp. Email skips it.
  // No more Trengo contact fetch - recipient is read straight from the
  // Monday phone/email columns via resolveClientSendChannel. Saves the
  // 200-800 ms Trengo roundtrip on every dialog open and makes the
  // preview match what the send path actually uses.
  const [kpi, pedro, waTemplate, hubUser, overdueInvoices] = await Promise.all([
    kpiPromise,
    loadPedroBody(args.mondayItemId),
    isEmail
      ? Promise.resolve({ name: null as string | null, source: "none" as const })
      : resolveWeeklyUpdateTemplate({ userId: amUserId, mondayItemId: args.mondayItemId }),
    loadHubUserName(amUserId),
    client.stripeCustomerId
      ? fetchOverdueInvoices(client.stripeCustomerId).catch(() => [] as OverdueInvoice[])
      : Promise.resolve([] as OverdueInvoice[]),
  ])

  const resolvedChannel = resolveClientSendChannel(client)
  const recipientPhone =
    resolvedChannel.ok && resolvedChannel.channel.kind === "whatsapp"
      ? resolvedChannel.channel.phone
      : client.phone || null
  const recipientEmail =
    resolvedChannel.ok && resolvedChannel.channel.kind === "email"
      ? resolvedChannel.channel.email
      : client.email || null

  // AM first name for the email sign-off + WhatsApp preview. Prefer
  // `users.name` because the resolved template slug may carry a
  // version suffix (e.g. `rl_weekly_danny_2` after a Meta re-approval)
  // which we don't want bleeding into the rendered "Groetjes, …"
  // line. Falls back to the slug-stripped name when the user row
  // has no name, then a hardcoded default.
  const amFirstName =
    (hubUser?.name?.split(/\s+/)[0] ||
      waTemplate.name?.replace(/^rl_weekly_/i, "").trim() ||
      "Roel").toString()

  const composed = composeInitialParts({
    firstName: client.firstName,
    clientId: client.mondayItemId,
    clientName: client.companyName || client.name,
    amFirstName,
    channel,
    kpi,
    pedro,
    weekLabel: formatWeekLabel(weekRange.startDate, weekRange.endDate),
    overdueInvoices: overdueInvoices.map((inv) => ({
      amountDue: inv.amountDue,
      hostedUrl: inv.hostedUrl,
      number: inv.number,
    })),
  })

  return {
    parts: composed.parts,
    channel,
    channelLabel: client.contactChannel,
    trengoContactLinked: resolvedChannel.ok,
    whatsappTemplateName: waTemplate.name,
    whatsappTemplateSource: waTemplate.source,
    recipientEmail,
    recipientPhone,
  }
}
