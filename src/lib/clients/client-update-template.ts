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

/** Delivery channel. Drives the message shape:
 *   - whatsapp / unknown → short body, opener is just "{name}!", no signOff
 *     (the Trengo HSM template wraps with "Hey " + "Groetjes …" itself).
 *   - email → real email shape: subject line, "Hé {name}," greeting in the
 *     body, full conclusion paragraph, our own "Groetjes,\n{am}" sign-off.
 *     No template wrapper — we send free-text via Trengo's email channel. */
export type Channel = "whatsapp" | "email" | "unknown"

/** Every field the AM sees in the dialog is editable. */
export type EditableParts = {
  /** First-name line. WhatsApp: `Bram!` (template adds "Hey "). Email:
   *  `Hé Bram,` (full salutation since email has no template wrapper). */
  opener: string
  intro: string
  /** Pre-rendered KPI block as a multi-line editable string. */
  kpiBlock: string
  /** Qualitative trend sentence (empty when there's no notable move). */
  trendSentence: string
  /** Free-form AM context — dictated above the bubble. Gets inserted into
   *  the body between the trend sentence and Pedro's conclusion so the AM
   *  can override the AI framing with their own ("we hebben de drempel
   *  verhoogd, daarom is CPL gestegen"). Empty by default. */
  note: string
  /** Pedro's conclusion sentence (or the empty-state fallback). */
  conclusion: string
  /** Header above the action list. */
  actionsHeader: string
  /** Pedro's action bullets (empty array allowed). */
  actions: string[]
  /** Email-only: subject line. Empty string for WhatsApp. Sent as message
   *  metadata, not body content — `renderFromParts` does NOT include it in
   *  the rendered string. */
  subject: string
  /** Email-only: closing line. The AM's name is NEVER pre-filled — the
   *  message is already sent FROM the AM's account, so adding their name
   *  again is redundant. Defaults to `Groetjes,` (or empty) and the AM can
   *  customise. Empty for WhatsApp (template handles sign-off). */
  signOff: string
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
  /** Drives opener / subject / signOff defaults. Defaults to "whatsapp"
   *  when omitted so older callers keep their behaviour. */
  channel?: Channel
  /** Client's company name (or display name) — only used to seed the
   *  email subject ("Wekelijkse update {name}"). Optional; falls back to
   *  the firstName when missing. */
  clientName?: string
  /** AM's first name — only used to seed the email sign-off ("Groetjes,
   *  {amFirstName}"). Capitalised on render. Falls back to "Roel" when
   *  missing so the placeholder still reads naturally. */
  amFirstName?: string
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
  const channel: Channel = input.channel ?? "whatsapp"
  const isEmail = channel === "email"

  // Opener differs per channel: email gets a full salutation in the body
  // ("Hé Bram,") because there's no template wrapper; WhatsApp gets just
  // "Bram!" since the Trengo HSM template prepends "Hey ".
  const opener = firstName
    ? isEmail
      ? `Hé ${firstName},`
      : `${firstName}!`
    : isEmail
      ? "Hé,"
      : ""

  // Email-only metadata. Subject reads like a real weekly-update email; the
  // sign-off uses the AM's first name so the recipient gets a recognisable
  // sender even when their mail client truncates the From header.
  const subject = isEmail
    ? `Wekelijkse update ${(input.clientName ?? firstName ?? "campagne").trim()}`.trim()
    : ""
  const amName = (input.amFirstName ?? "").trim() || "Roel"
  const signOff = isEmail
    ? `Groetjes,\n${amName.charAt(0).toUpperCase()}${amName.slice(1)}`
    : ""

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
      note: "",
      conclusion,
      actionsHeader: noSignal ? "" : "✅ Wat we deze week gaan doen:",
      actions,
      subject,
      signOff,
    },
  }
}

// ─── Render to final string ──────────────────────────────────────────────

/** Pure stringification of the editable parts. Skips empty fields so a
 *  cleared-out section doesn't leave a stray blank line behind.
 *
 *  Subject is NOT emitted — it's metadata sent alongside the body when the
 *  channel is email. The sign-off IS emitted (at the end) when set; it's
 *  only set in email mode by `composeInitialParts`. */
export function renderFromParts(parts: EditableParts): string {
  const blocks: string[] = []
  if (parts.opener?.trim()) blocks.push(parts.opener.trim())
  if (parts.intro?.trim()) blocks.push(parts.intro.trim())
  if (parts.kpiBlock?.trim()) blocks.push(parts.kpiBlock.trim())
  if (parts.trendSentence?.trim()) blocks.push(parts.trendSentence.trim())
  // AM's dictated context lands BEFORE Pedro's conclusion so the human voice
  // anchors the framing ("we hebben dit gedaan, daarom is X gestegen") and
  // Pedro's conclusion plays a supporting role rather than competing.
  if (parts.note?.trim()) blocks.push(parts.note.trim())
  if (parts.conclusion?.trim()) blocks.push(parts.conclusion.trim())

  const validActions = parts.actions.map((a) => a.trim()).filter(Boolean)
  if (validActions.length > 0) {
    const actionLines: string[] = []
    if (parts.actionsHeader?.trim()) actionLines.push(parts.actionsHeader.trim())
    for (const a of validActions) actionLines.push(`• ${a}`)
    blocks.push(actionLines.join("\n"))
  }

  if (parts.signOff?.trim()) blocks.push(parts.signOff.trim())

  return blocks.join("\n\n").trim()
}

// ─── Backwards-compat wrapper ────────────────────────────────────────────

/** Single-shot compose + render. */
export function renderWeeklyUpdate(input: ComposeInput): string {
  return renderFromParts(composeInitialParts(input).parts)
}

// ─── Multi-variable template params (V2) ─────────────────────────────────

/**
 * Map the AM-edited parts into the five ordered params for the V2 Weekly
 * Update HSM template (`rl_weekly_<voornaam>`). The template body
 * already contains the structural pieces — paragraph breaks, the "📊 Cijfers
 * deze week:" header, the "✅ Wat we deze week gaan doen:" header, and the
 * per-AM sign-off — so the variables hold ONLY the bare content.
 *
 * Slot mapping:
 *   [0] → {{1}}  first name (no trailing "!")
 *   [1] → {{2}}  intro sentence
 *   [2] → {{3}}  KPI bullets inline ("• CPL: €X • Spend: €Y • Leads: Z")
 *   [3] → {{4}}  trend + AM note + conclusion combined into one flat block
 *   [4] → {{5}}  action bullets inline ("• Actie 1 • Actie 2")
 *
 * Every value is fed through `sanitizeWaTemplateParam` as the final safety
 * net — Meta rejects newlines / tabs / 4+ consecutive whitespace in body
 * variables, and this is the boundary where we guarantee compliance.
 *
 * The AM's `kpiBlock` typically starts with "📊 KPI deze week:" + bullets;
 * we strip that leading header line because the template body already
 * provides "📊 Cijfers deze week:". Same for `actionsHeader` — dropped
 * because the template fixes "✅ Wat we deze week gaan doen:".
 */
export function partsToWeeklyUpdateParams(parts: EditableParts): string[] {
  const firstName = parts.opener.replace(/[!?.,;:]+$/, "").trim()

  const intro = sanitizeForWaParam(parts.intro)

  const kpiInline = sanitizeForWaParam(stripLeadingHeaderLine(parts.kpiBlock))

  // Trend, AM note, and Pedro's conclusion all describe "what's happening"
  // and slot into the same paragraph between KPIs and the action list.
  const bodyInline = sanitizeForWaParam(
    [parts.trendSentence, parts.note, parts.conclusion]
      .map((s) => (s ?? "").trim())
      .filter(Boolean)
      .join(" "),
  )

  const actionsInline = sanitizeForWaParam(
    parts.actions
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => `• ${a.replace(/^[•\-*]\s*/, "")}`)
      .join(" "),
  )

  return [firstName, intro, kpiInline, bodyInline, actionsInline]
}

/** Strip everything before the first bullet line. Turns
 *  "📊 KPI block:\n• CPL: …\n• Spend: …" into "• CPL: …\n• Spend: …" so
 *  the template's own "📊 Cijfers deze week:" header doesn't double up. */
function stripLeadingHeaderLine(s: string): string {
  const lines = s.split("\n")
  const firstBulletIdx = lines.findIndex((l) => /^\s*[•\-*]/.test(l))
  if (firstBulletIdx === -1) return s
  return lines.slice(firstBulletIdx).join("\n")
}

/** Inline `sanitizeWaTemplateParam` so this module doesn't take a runtime
 *  dep on `src/lib/inbox/reply.ts` (template-rendering shouldn't pull in
 *  the inbox send pipeline). Kept identical so behaviour matches the API
 *  boundary's defensive sanitiser. Tested directly in this file's test
 *  suite + indirectly via reply.test.ts. */
function sanitizeForWaParam(s: string): string {
  if (!s) return s
  return s
    .replace(/\n\s*[•\-*]\s+/g, " • ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
}
