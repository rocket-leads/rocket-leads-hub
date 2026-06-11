import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { MondayClient } from "@/lib/integrations/monday"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { readCache } from "@/lib/cache"
import { fetchMetaAdDetails } from "@/lib/integrations/meta"
import { computeAccountStats, computeTrend, scoreAd } from "@/lib/pedro/performance"
import { collectClientAiContext } from "@/lib/pedro/insights/context"

/**
 * Pedro per-client monthly digest.
 *
 * Fires on the 1st of every month for every Live client. Pedro reads the
 * last 30 days of Meta performance + Monday/Trengo qualitative context,
 * then composes a four-section summary:
 *  1. Winners - what to double down on next month
 *  2. Losers - what to pause / cut
 *  3. Focus - concrete priority for the next 30 days
 *  4. Risks - anything to watch (CPL drift, lead-quality signals, churn)
 *
 * Output lands as a single inbox task per client, assigned to the CM.
 * The intent is "the CM walks in on the 1st, sees Pedro's review queued
 * up alongside their other tasks, and starts the month with a plan
 * instead of a blank slate".
 *
 * Dedupe via source_ref->>kind = 'pedro_monthly_digest' AND
 * source_ref->>monthYear = 'YYYY-MM' so re-runs in the same month don't
 * double-post. Re-running a previous month is a no-op (skipped).
 *
 * Skipped clients:
 *  - No Meta ad account → nothing to digest, skipped
 *  - No spend at all in the window → skipped (campaign was paused all month)
 *  - Claude failure → skipped silently, no task created
 */

const anthropic = new Anthropic()

const WINDOW_DAYS = 30

export type DigestRunResult = {
  liveClients: number
  attempted: number
  created: number
  skippedNoMeta: number
  skippedNoSpend: number
  skippedExisting: number
  skippedNoCm: number
  failed: number
  errors: Array<{ client: string; error: string }>
}

type ClaudeDigestOutput = {
  headline: string
  winners: string[]
  losers: string[]
  focus: string[]
  risks: string[]
}

function dateRange(days: number): { start: string; end: string } {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days + 1)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

function priorRange(days: number): { start: string; end: string } {
  const end = new Date()
  end.setDate(end.getDate() - days)
  const start = new Date()
  start.setDate(start.getDate() - days * 2 + 1)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

/**
 * Resolve the campaign manager → hub user_id, mirrors the helper used by
 * auto-trigger.ts so the digest task lands in the same inbox as Pedro's
 * other automation output.
 */
async function resolveCmUserId(
  supabase: SupabaseClient,
  client: MondayClient,
): Promise<string | null> {
  const cmName = client.campaignManager?.trim()
  if (!cmName) return null
  const { data } = await supabase
    .from("user_column_mappings")
    .select("user_id")
    .eq("monday_column_role", "campaign_manager")
    .eq("monday_person_name", cmName)
    .maybeSingle<{ user_id: string }>()
  return data?.user_id ?? null
}

async function askClaudeForDigest(
  client: MondayClient,
  perfBlock: string,
  qualitativeBlock: string,
): Promise<ClaudeDigestOutput | null> {
  const prompt = `Je bent Pedro, senior campaign manager bij Rocket Leads. Je schrijft de maandelijkse review voor klant "${client.companyName || client.name}" voor de campaign manager. Het doel: de CM begint de nieuwe maand met een concreet plan, niet met een blank canvas.

PERFORMANCE (laatste 30 dagen):
${perfBlock}

KWALITATIEVE CONTEXT:
${qualitativeBlock}

OUTPUT REGELS:
- Wees concreet en cijfer-gedreven. Citeer ad-namen, CPL, spend.
- Géén padding. Géén "het ziet er goed uit" zonder cijfers erachter.
- Per sectie: 2-4 bullets, max 1 zin per bullet. Lege array is geldig als er niets te zeggen is.
- Volg knowledge/campaigns.md kernregels:
  · ad-fatigue is de default - winners moeten geïtereerd worden, niet "laten lopen"
  · budget verhogen is niet de oplossing (vast advertentiebudget)
  · CPL/CPA verandering <25% = ruis, niet rapporteren
  · lead-quality is leidend boven volume

ALLEEN JSON (geen markdown wrapper, geen code fences):

{
  "headline": "1 zin met de maand-samenvatting (max 100 chars)",
  "winners": ["bullet 1", "bullet 2"],
  "losers": ["bullet 1"],
  "focus": ["bullet 1", "bullet 2"],
  "risks": ["bullet 1"]
}`

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    })
    const raw = message.content[0]?.type === "text" ? message.content[0].text : ""
    const cleaned = raw.replace(/```json|```/g, "").trim()
    const parsed = JSON.parse(cleaned) as ClaudeDigestOutput
    return parsed
  } catch (e) {
    console.error("[pedro/monthly-digest] Claude failed:", e instanceof Error ? e.message : e)
    return null
  }
}

function renderPerfBlock(
  ads: Awaited<ReturnType<typeof fetchMetaAdDetails>>,
  priorAds: Awaited<ReturnType<typeof fetchMetaAdDetails>>,
): string {
  const stats = computeAccountStats(ads)
  const priorStats = computeAccountStats(priorAds)
  const trend = computeTrend(
    { totalSpend: stats.totalSpend, totalLeads: stats.totalLeads, avgCpl: stats.avgCpl },
    { totalSpend: priorStats.totalSpend, totalLeads: priorStats.totalLeads, avgCpl: priorStats.avgCpl },
  )

  const scored = ads.map((a) => scoreAd(a, stats.avgCpl))
  const winners = scored
    .filter((a) => a.verdict === "winner")
    .sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity))
    .slice(0, 5)
  const losers = scored
    .filter((a) => a.verdict === "loser")
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 5)

  const fmtMoney = (n: number) => `€${n.toFixed(2)}`
  const fmtCpl = (n: number | null) => (n === null ? "-" : `€${n.toFixed(2)}`)

  const lines: string[] = []
  lines.push(`Account totals (30d): spend ${fmtMoney(stats.totalSpend)}, ${stats.totalLeads} leads, avg CPL ${fmtCpl(stats.avgCpl)}`)
  lines.push(`vs prior 30d: spend ${fmtMoney(priorStats.totalSpend)}, ${priorStats.totalLeads} leads, avg CPL ${fmtCpl(priorStats.avgCpl)}`)
  if (trend) {
    const cplDelta = trend.cplDeltaPct === null ? "n/a" : `${trend.cplDeltaPct > 0 ? "+" : ""}${trend.cplDeltaPct.toFixed(0)}%`
    lines.push(`Trend CPL: ${cplDelta} (note: <25% = ruis)`)
  }
  lines.push("")
  lines.push(`Winners (${winners.length}):`)
  for (const w of winners) {
    lines.push(`  - "${w.adName}" - ${fmtMoney(w.spend)} spend, ${w.leads} leads, CPL ${fmtCpl(w.cpl)}`)
  }
  if (winners.length === 0) lines.push("  - (geen winners in window)")
  lines.push("")
  lines.push(`Losers (${losers.length}):`)
  for (const l of losers) {
    lines.push(`  - "${l.adName}" - ${fmtMoney(l.spend)} spend, ${l.leads} leads, CPL ${fmtCpl(l.cpl)} - ${l.reason}`)
  }
  if (losers.length === 0) lines.push("  - (geen duidelijke losers)")

  return lines.join("\n")
}

function renderQualitativeBlock(ctx: Awaited<ReturnType<typeof collectClientAiContext>>): string {
  const lines: string[] = []
  if (ctx.mondayTrengo?.mondayUpdates) {
    lines.push("Monday updates (laatste 14d):")
    lines.push(ctx.mondayTrengo.mondayUpdates.slice(0, 1500))
    lines.push("")
  }
  if (ctx.mondayTrengo?.trengoSummary) {
    lines.push("Trengo conversaties (laatste 14d):")
    lines.push(ctx.mondayTrengo.trengoSummary.slice(0, 1000))
    lines.push("")
  }
  if (ctx.fathomMeetings.length > 0) {
    lines.push(`Recente meetings (${ctx.fathomMeetings.length}):`)
    for (const m of ctx.fathomMeetings.slice(0, 3)) {
      lines.push(`  - ${m.scheduledAt?.slice(0, 10) ?? "?"} ${m.title ?? ""}: ${m.summary?.slice(0, 250) ?? ""}`)
    }
    lines.push("")
  }
  if (ctx.billing) {
    lines.push(`Billing: ${ctx.billing.status} - outstanding ${ctx.billing.outstanding ?? 0}`)
  }
  if (lines.length === 0) {
    return "(Geen Monday/Trengo/Fathom context beschikbaar - Meta-only digest.)"
  }
  return lines.join("\n")
}

function renderTaskBody(client: MondayClient, monthLabel: string, digest: ClaudeDigestOutput): string {
  const list = (items: string[]) =>
    items.length === 0 ? "_(niets opvallends)_" : items.map((s) => `- ${s}`).join("\n")

  return [
    `**Pedro maand-review - ${monthLabel}**`,
    "",
    `> ${digest.headline}`,
    "",
    "**🏆 Winners - verdubbel hierop:**",
    list(digest.winners),
    "",
    "**⏸ Losers - pauzeren of vervangen:**",
    list(digest.losers),
    "",
    "**🎯 Focus voor de komende 30 dagen:**",
    list(digest.focus),
    "",
    "**⚠️ Risks om in de gaten te houden:**",
    list(digest.risks),
    "",
    "---",
    `_Pedro genereerde dit op basis van 30d Meta performance + Monday/Trengo context. Cijfers van 30d, niet 7d._`,
    "",
    `[→ Open in Pedro](/pedro?clientId=${client.mondayItemId})`,
    `[→ Open klant detail](/clients/${client.mondayItemId})`,
  ].join("\n")
}

/**
 * Run the digest for one client. Returns a status describing what
 * happened so the cron caller can roll up counts.
 */
export async function runMonthlyDigestForClient(
  supabase: SupabaseClient,
  client: MondayClient,
  monthYear: string, // "YYYY-MM"
  monthLabel: string, // human label like "April 2026"
): Promise<
  | { status: "skipped-no-meta" }
  | { status: "skipped-no-spend" }
  | { status: "skipped-existing" }
  | { status: "skipped-no-cm" }
  | { status: "failed"; error: string }
  | { status: "created"; taskId: string }
> {
  if (!client.metaAdAccountId) return { status: "skipped-no-meta" }

  // Dedupe: skip if a digest task was already created for (client, monthYear)
  const { data: existing } = await supabase
    .from("inbox_events")
    .select("id")
    .eq("client_id", client.mondayItemId)
    .eq("source", "automation")
    .filter("source_ref->>kind", "eq", "pedro_monthly_digest")
    .filter("source_ref->>monthYear", "eq", monthYear)
    .limit(1)
    .maybeSingle<{ id: string }>()
  if (existing) return { status: "skipped-existing" }

  // Fetch performance + qualitative context in parallel
  const cur = dateRange(WINDOW_DAYS)
  const prior = priorRange(WINDOW_DAYS)

  const [adsRaw, adsPriorRaw, ctx] = await Promise.all([
    fetchMetaAdDetails(client.metaAdAccountId, cur.start, cur.end).catch(() => []),
    fetchMetaAdDetails(client.metaAdAccountId, prior.start, prior.end).catch(() => []),
    collectClientAiContext(client).catch(() => null),
  ])

  const stats = computeAccountStats(adsRaw)
  if (stats.totalSpend === 0) return { status: "skipped-no-spend" }

  const perfBlock = renderPerfBlock(adsRaw, adsPriorRaw)
  const qualitativeBlock = ctx ? renderQualitativeBlock(ctx) : "(Context-collector failed.)"

  const digest = await askClaudeForDigest(client, perfBlock, qualitativeBlock)
  if (!digest) return { status: "failed", error: "claude-empty" }

  const cmUserId = await resolveCmUserId(supabase, client)
  // Roy's rule: surface even unassigned tasks rather than dropping them.
  // CM resolution failure → assignee_id null, but still create the task.
  if (!cmUserId) {
    console.warn(
      `[pedro/monthly-digest] no CM mapping for "${client.companyName || client.name}" (CM=${client.campaignManager || "-"}); creating unassigned task`,
    )
  }

  const body = renderTaskBody(client, monthLabel, digest)
  const title = `Pedro maand-review ${monthLabel} - ${client.companyName || client.name}`

  try {
    const { data: inserted } = await supabase
      .from("inbox_events")
      .insert({
        kind: "task",
        client_id: client.mondayItemId,
        author_id: null,
        assignee_id: cmUserId,
        title,
        body,
        status: "open",
        priority: "normal",
        source: "automation",
        source_ref: {
          kind: "pedro_monthly_digest",
          monthYear,
          clientId: client.mondayItemId,
        },
      })
      .select("id")
      .single<{ id: string }>()
    if (!inserted) return { status: "failed", error: "insert-empty" }
    return { status: "created", taskId: inserted.id }
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : "insert-failed" }
  }
}

/**
 * Compute the canonical "previous month" label given a run date. The cron
 * fires on the 1st, so the digest covers the month that just ended.
 *  - 2026-05-01 run → monthYear "2026-04", label "April 2026"
 *  - Re-running on 2026-05-12 with a forced override is allowed via the
 *    `now` param (used by the manual /api/cron route in admin mode).
 */
export function previousMonth(now = new Date()): { monthYear: string; label: string } {
  const d = new Date(now)
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const label = d.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
  return { monthYear: `${yyyy}-${mm}`, label }
}

export async function runMonthlyDigestForAllClients(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<DigestRunResult> {
  const result: DigestRunResult = {
    liveClients: 0,
    attempted: 0,
    created: 0,
    skippedNoMeta: 0,
    skippedNoSpend: 0,
    skippedExisting: 0,
    skippedNoCm: 0,
    failed: 0,
    errors: [],
  }

  // Live clients only - onboarding/churned shouldn't get a "review last
  // month" task. Same source-of-truth as refresh-pedro-insights.
  const cached = await readCache<{ current: MondayClient[] }>("monday_boards")
  const data = cached ?? (await fetchBothBoards())
  const liveClients = data.current.filter((c) => c.campaignStatus === "Live")
  result.liveClients = liveClients.length

  const { monthYear, label } = previousMonth(now)

  // Sequential - Anthropic is the bottleneck, not Supabase. Avoiding
  // parallel fan-out keeps Claude rate-limit pressure low and the cron
  // log readable. ~30s per client × ~30 clients = ~15 min, well within
  // a 5-min Vercel cron budget after the cron clamp; chunk if it grows.
  for (const client of liveClients) {
    result.attempted++
    try {
      const r = await runMonthlyDigestForClient(supabase, client, monthYear, label)
      switch (r.status) {
        case "created":
          result.created++
          break
        case "skipped-no-meta":
          result.skippedNoMeta++
          break
        case "skipped-no-spend":
          result.skippedNoSpend++
          break
        case "skipped-existing":
          result.skippedExisting++
          break
        case "skipped-no-cm":
          result.skippedNoCm++
          break
        case "failed":
          result.failed++
          result.errors.push({ client: client.name, error: r.error })
          break
      }
    } catch (e) {
      result.failed++
      result.errors.push({
        client: client.name,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return result
}
