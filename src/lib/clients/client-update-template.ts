import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { PedroInsightBody } from "@/lib/pedro/insights/types"

/**
 * Weekly-update template — composes the {{1}} body for the Trengo WhatsApp
 * HSM template `rl_universal_<voornaam>` (e.g. `rl_universal_roel`,
 * `rl_universal_danny`). The Trengo template owns the greeting prefix
 * ("Hey ") and the sign-off ("Groetjes <am>") via its approved body; this
 * file only produces what fills the {{1}} placeholder in between.
 *
 * What we DO NOT include in the body (Trengo template already provides):
 *   - Opening greeting word ("Hey" / "Hoi" / "Hi")
 *   - AM sign-off ("Groetjes Roel")
 *
 * What we DO include and ALL of it is editable in the dialog:
 *   - First-name line ("Bram!") so the message reads "Hey Bram! …"
 *   - Intro sentence
 *   - 7-day KPI block (incl. numbers — AM can correct if a number looks off)
 *   - Qualitative trend sentence
 *   - Pedro's conclusion sentence
 *   - Actions header + bullet list
 *
 * Per Roy: "ik wil echt alles kunnen aanpassen, zelfs de data in de 7-Day
 * update". So the previous locked/editable split is collapsed — every field
 * lives in `EditableParts` and the dialog binds each to an editable input.
 *
 * The render stays deterministic per (clientId, ISO week) so re-opening the
 * dialog within the same week returns the same draft, but next week rotates
 * to a different intro phrasing for natural variation.
 *
 * No AI call — pulls straight from Pedro's daily cache + the 7d KPI cache.
 */

// ─── Variant pools (rotated per week) ─────────────────────────────────────

export const INTROS = [
  "Even een korte update over je campagne van de afgelopen week:",
  "Hier de wekelijkse update over je campagne:",
  "Korte check-in over hoe het draait afgelopen 7 dagen:",
  "Snelle update over de cijfers van afgelopen week:",
] as const

/**
 * Default action-bullet pool. Used when Pedro hasn't generated actions yet
 * (new client, cron hasn't tickt, no signal): we pre-fill three plausible
 * actions from the campaign-manager playbook so the AM only has to tweak
 * them instead of starting from a blank list.
 *
 * Items are written to be generic-but-credible — none of them refer to a
 * specific ad name, so they read fine for any client. The seed rotates which
 * three appear per week so the same client doesn't get the literal same
 * starter list two weeks in a row.
 */
const DEFAULT_ACTIONS = [
  "Nieuwe creatives lanceren met verse hooks",
  "Top-performer dupliceren in een tweede ad set",
  "Lead-kwaliteit checken met de opvolging voor feedback",
  "Underperformer pauzeren en budget herverdelen",
  "Frequency check op de winnende ad set",
  "Nieuwe angle testen voor volgende week",
] as const

/** Conclusion-zin op basis van de CPL delta. Used when Pedro hasn't produced
 *  a conclusion yet.
 *
 *  IMPORTANT: must NOT restate what the trend sentence already says. The
 *  trend sentence covers "wat is er gebeurd" (CPL loopt op / mooie beweging)
 *  — the conclusion is then *complementary*, focusing on "wat doe ik
 *  komende dagen". Mirroring the trend would produce a visibly-duplicate
 *  message ("Kost per lead loopt op …" twice in a row). */
function defaultConclusion(kpi: KpiSummary | null): string {
  if (!kpi || !kpi.prevCpl || kpi.prevPeriodReliable === false) {
    return "Ik kijk komende dagen mee om bij te sturen waar nodig."
  }
  const pct = ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100
  if (pct <= -25) return "Hier gaan we komende week op doorbouwen, de winnende richting blijven we pushen."
  if (pct <= -10) return "Goeie kant op, ik laat de huidige set lopen en plan een refresh in."
  if (pct >= 25) return "Komende dagen werk ik aan optimalisaties, nieuwe creatives staan klaar."
  if (pct >= 10) return "Komende dagen kijk ik naar nieuwe creatives om dit weer omlaag te krijgen."
  return "Komende dagen kijk ik of we ergens scherper kunnen."
}

/** Pick 3 distinct default actions from the pool, rotated weekly by seed.
 *  Step of 2 keeps the trio reasonably spread across the pool rather than
 *  three consecutive items every time. */
function defaultActions(seed: number): string[] {
  const len = DEFAULT_ACTIONS.length
  const picks = new Set<number>()
  for (let step = 0; picks.size < 3 && step < len * 2; step += 2) {
    picks.add((seed + step) % len)
  }
  return Array.from(picks).map((i) => DEFAULT_ACTIONS[i])
}

// ─── Types ────────────────────────────────────────────────────────────────

/** Every field the AM sees in the dialog is editable. No `LockedSections`
 *  anymore — the only fixed strings live in the Trengo template wrapper
 *  ("Hey ..." prefix + "Groetjes ..." suffix) which we never render here. */
export type EditableParts = {
  /** First-name line, e.g. "Bram!". Lands directly after the template's
   *  fixed "Hey " prefix, so a leading "Hé" here would double the greeting. */
  opener: string
  intro: string
  /** Pre-rendered KPI block as a multi-line editable string. Includes the 📊
   *  header, bullets, and the week-vs-week delta line. AM can edit any of it. */
  kpiBlock: string
  /** Qualitative trend sentence (empty when there's no notable move). */
  trendSentence: string
  /** Pedro's conclusion sentence (or the empty-state fallback). */
  conclusion: string
  /** Header above the action list. Editable so the AM can swap "deze week"
   *  for "komende dagen" or similar phrasing. */
  actionsHeader: string
  /** Pedro's action bullets (empty array allowed). */
  actions: string[]
}

export type ComposedUpdate = {
  parts: EditableParts
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function seedHash(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function isoWeek(d: Date): number {
  const target = new Date(d.valueOf())
  const dayNr = (d.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNr + 3)
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4))
  const diff = target.valueOf() - firstThursday.valueOf()
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000))
}

function pick<T>(pool: readonly T[], seed: number): T {
  return pool[seed % pool.length]
}

function fmtEur(n: number): string {
  if (!Number.isFinite(n)) return "€0"
  return `€${Math.round(n).toLocaleString("nl-NL")}`
}

function fmtCpl(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "n.v.t."
  return `€${n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** CPL delta bullet as "stabiel" / "X% stijging" / "X% daling". Empty string
 *  when there's no reliable baseline — caller can keep the line out. */
function cplDeltaBullet(kpi: KpiSummary | null): string {
  if (!kpi) return ""
  if (!kpi.prevCpl || kpi.prevPeriodReliable === false) return ""
  const pct = ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100
  if (Math.abs(pct) < 1) return "• Verschil met vorige week: stabiel"
  const abs = Math.abs(pct).toFixed(0)
  const direction = pct > 0 ? "stijging" : "daling"
  return `• Verschil met vorige week: ${abs}% ${direction}`
}

function trendSentenceFor(kpi: KpiSummary | null): string {
  if (!kpi) return ""
  if (!kpi.prevCpl || kpi.prevPeriodReliable === false) return ""
  const pct = ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100
  if (pct <= -25) return "Sterke verbetering deze week."
  if (pct <= -10) return "Mooie beweging deze week."
  if (pct >= 25) return "Kosten per lead lopen op, daar zit ons aandachtspunt."
  if (pct >= 10) return "Kosten per lead lopen wat op, daar letten we op."
  return ""
}

function buildKpiBlock(kpi: KpiSummary | null): string {
  if (!kpi) return ""
  const lines = [
    "📊 Afgelopen 7 dagen",
    `• Ad spend: ${fmtEur(kpi.adSpend)}`,
    `• Leads: ${kpi.leads}`,
    `• Kosten per lead: ${fmtCpl(kpi.cpl)}`,
  ]
  const delta = cplDeltaBullet(kpi)
  if (delta) lines.push(delta)
  return lines.join("\n")
}

// ─── Compose initial parts ───────────────────────────────────────────────

export type ComposeInput = {
  firstName: string
  clientId: string
  kpi: KpiSummary | null
  pedro: PedroInsightBody | null
  /** Render date — pass `new Date()` in production, fixed dates in tests. */
  now?: Date
}

/** Build the initial draft. Picks a weekly intro variant + pre-renders KPI
 *  numbers; everything ends up in `parts` so the dialog can bind each field
 *  to an editable input. */
export function composeInitialParts(input: ComposeInput): ComposedUpdate {
  const now = input.now ?? new Date()
  const seed = seedHash(`${input.clientId}:${now.getUTCFullYear()}:${isoWeek(now)}`)
  const intro = pick(INTROS, seed >> 3)
  const firstName = (input.firstName ?? "").trim()
  // No greeting word here — Trengo template's "Hey " prefix already covers it.
  const opener = firstName ? `${firstName}!` : ""

  // Empty-state for paused / pre-launch clients. Lives in the conclusion
  // field so the AM still gets a starter sentence to flesh out, while the
  // other fields stay empty and don't render.
  const noSignal = !input.kpi && !input.pedro

  // Conclusion: Pedro's text wins. When Pedro hasn't produced anything,
  // fall back to a CPL-delta-shaped default — same tone as the trend
  // sentence, so the AM's pre-fill always reads sensibly even with zero AI.
  const pedroConclusion = input.pedro?.conclusion?.trim() ?? ""
  const conclusion = noSignal
    ? "We zijn nog aan het opstarten met je campagne. Zodra er cijfers zijn deel ik die direct."
    : pedroConclusion || defaultConclusion(input.kpi)

  // Actions: Pedro's bullets win. When Pedro produced none, pre-fill three
  // generic playbook actions so the AM only tweaks them. Empty-state skips
  // actions entirely — there's nothing to act on yet.
  const pedroActions = (input.pedro?.actions ?? []).filter((a) => a.trim().length > 0)
  const actions = noSignal
    ? []
    : pedroActions.length > 0
      ? pedroActions.slice(0, 3)
      : defaultActions(seed)

  return {
    parts: {
      opener,
      intro: noSignal ? "" : intro,
      kpiBlock: buildKpiBlock(input.kpi),
      trendSentence: trendSentenceFor(input.kpi),
      conclusion,
      actionsHeader: noSignal ? "" : "✅ Wat we deze week gaan doen:",
      actions,
    },
  }
}

// ─── Render to final string ──────────────────────────────────────────────

/** Pure stringification of the editable parts. Skips empty fields so a
 *  cleared-out section doesn't leave a stray blank line behind. */
export function renderFromParts(parts: EditableParts): string {
  const blocks: string[] = []
  if (parts.opener?.trim()) blocks.push(parts.opener.trim())
  if (parts.intro?.trim()) blocks.push(parts.intro.trim())
  if (parts.kpiBlock?.trim()) blocks.push(parts.kpiBlock.trim())
  if (parts.trendSentence?.trim()) blocks.push(parts.trendSentence.trim())
  if (parts.conclusion?.trim()) blocks.push(parts.conclusion.trim())

  const validActions = parts.actions.map((a) => a.trim()).filter(Boolean)
  if (validActions.length > 0) {
    const actionLines: string[] = []
    if (parts.actionsHeader?.trim()) actionLines.push(parts.actionsHeader.trim())
    for (const a of validActions) actionLines.push(`• ${a}`)
    blocks.push(actionLines.join("\n"))
  }

  return blocks.join("\n\n").trim()
}

// ─── Backwards-compat wrapper ────────────────────────────────────────────

/** Single-shot compose + render. */
export function renderWeeklyUpdate(input: ComposeInput): string {
  return renderFromParts(composeInitialParts(input).parts)
}
