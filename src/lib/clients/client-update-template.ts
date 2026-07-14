import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { PedroInsightBody } from "@/lib/pedro/insights/types"

/**
 * Weekly-update template - composes the {{1}} body for the Trengo WhatsApp
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
 *   - 7-day KPI block (incl. numbers - AM can correct if a number looks off)
 *   - Qualitative trend sentence
 *   - Pedro's conclusion sentence
 *   - Actions header + bullet list
 *
 * Per Roy: "ik wil echt alles kunnen aanpassen, zelfs de data in de 7-Day
 * update". So the previous locked/editable split is collapsed - every field
 * lives in `EditableParts` and the dialog binds each to an editable input.
 *
 * The render stays deterministic per (clientId, ISO week) so re-opening the
 * dialog within the same week returns the same draft, but next week rotates
 * to a different intro phrasing for natural variation.
 *
 * No AI call - pulls straight from Pedro's daily cache + the 7d KPI cache.
 */

// ─── Variant pools (rotated per week) ─────────────────────────────────────

export const INTROS = [
  "Even een korte update over je campagne van de afgelopen week:",
  "Hier de wekelijkse update over je campagne:",
  "Korte check-in over hoe het draait afgelopen 7 dagen:",
  "Snelle update over de cijfers van afgelopen week:",
] as const

/** Conclusion-zin op basis van de CPL delta. Used when Pedro hasn't produced
 *  a conclusion yet.
 *
 *  IMPORTANT (Roy 2026-07-14): must be a NEUTRAL, honest stance - never a
 *  fabricated specific commitment. Earlier phrasings like "nieuwe creatives
 *  staan klaar" or "plan een refresh in" asserted concrete work nobody had
 *  agreed to (the CM might not do it, and it can contradict the data). The
 *  client-facing conclusion states what genuinely happens - we monitor and
 *  optimise daily (process.md Fase 4) - without promising a specific task.
 *
 *  Must also NOT restate the trend sentence ("wat is er gebeurd"); this is
 *  complementary and forward-leaning in tone only. */
function defaultConclusion(kpi: KpiSummary | null): string {
  if (!kpi || !kpi.prevCpl || kpi.prevPeriodReliable === false) {
    return "Ik houd de campagne dagelijks in de gaten en stuur bij waar nodig."
  }
  const pct = ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100
  if (pct <= -25) return "Sterke lijn, die houden we vast."
  if (pct <= -10) return "Goeie richting, we blijven dit volgen en bijsturen waar nodig."
  if (pct >= 25) return "Hier ligt deze week onze aandacht, we optimaliseren dagelijks."
  if (pct >= 10) return "Hier letten we op en sturen dagelijks bij waar nodig."
  return "We houden de cijfers dagelijks in de gaten."
}

// ─── Types ────────────────────────────────────────────────────────────────

/** Delivery channel. Drives the message shape:
 *   - whatsapp / unknown → short body, opener is just "{name}!", no signOff
 *     (the Trengo HSM template wraps with "Hey " + "Groetjes …" itself).
 *   - email → real email shape: subject line, "Hé {name}," greeting in the
 *     body, full conclusion paragraph, our own "Groetjes,\n{am}" sign-off.
 *     No template wrapper - we send free-text via Trengo's email channel. */
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
  /** Free-form AM context - dictated above the bubble. Gets inserted into
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
   *  metadata, not body content - `renderFromParts` does NOT include it in
   *  the rendered string. */
  subject: string
  /** Email-only: closing line. The AM's name is NEVER pre-filled - the
   *  message is already sent FROM the AM's account, so adding their name
   *  again is redundant. Defaults to `Groetjes,` (or empty) and the AM can
   *  customise. Empty for WhatsApp (template handles sign-off). */
  signOff: string
  /** Auto-populated when the client has one or more overdue Stripe
   *  invoices: a short "betaal hier" block listing each invoice with its
   *  amount + Stripe-hosted payment URL. Empty string when there's
   *  nothing overdue. AM can edit / strip per send. Lives BEFORE the
   *  actions section so the call-to-action reads naturally as part of
   *  the closing context. Roy 2026-05-23. */
  overdueBlock: string
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
 *  when there's no reliable baseline - caller can keep the line out. */
function cplDeltaBullet(kpi: KpiSummary | null): string {
  if (!kpi) return ""
  if (!kpi.prevCpl || kpi.prevPeriodReliable === false) return ""
  const pct = ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100
  if (Math.abs(pct) < 1) return "• Verschil met vorige week: stabiel"
  const abs = Math.abs(pct).toFixed(0)
  const direction = pct > 0 ? "stijging" : "daling"
  return `• Verschil met vorige week: ${abs}% ${direction}`
}

/** Strip artefacts that make Pedro's conclusion contradict the KPI bullets
 *  above it in the client-facing weekly update:
 *
 *  - `(7d)` / `(14d)` / `(prev 7d)` / `(30d)` / `(all-time)` window labels.
 *    These are CM-internal and the AI prompt already forbids them in
 *    client output, but Haiku violates it often enough that we need a
 *    post-processing backstop.
 *
 *  - "... naar €12,71" specific CPL claims. Pedro's conclusion was
 *    generated against the rolling 7d window from the daily cron; the
 *    KPI bullets show last week's Mon-Sun window. Those two CPLs almost
 *    always differ, so a sentence like "CPL is flink gedaald naar €12,71"
 *    appearing right under "Kosten per lead: €8,46" reads as a
 *    contradiction to the client. Stripping the trailing "naar €X,XX"
 *    leaves the directional sentiment ("CPL is flink gedaald.") intact
 *    while removing the conflicting number.
 *
 *  Used only when injecting Pedro's conclusion into the client-facing
 *  weekly update - the watch list / CM views still get the original
 *  text because CMs DO want the precise window labels.
 */
function sanitizePedroConclusionForClient(s: string): string {
  return (
    s
      // Strip "(7d)" / "(14d)" / "(prev 7d)" / "(30d)" / "(all-time)" tags.
      .replace(/\s*\((?:prev\s+)?(?:\d+d|all-time)\)/gi, "")
      // Strip "<preposition> €X,XX" CPL specifics (naar / op / van / tot /
      // richting / rond). Tolerates optional thousands separator + 0-2
      // decimals. Keeps the directional verb ("CPL is flink gedaald").
      .replace(
        /\s+(?:naar|op|van|tot|richting|rond)\s+€\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?/gi,
        "",
      )
      // Strip any remaining bare "€X,XX" the preposition pass missed.
      .replace(/\s*€\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?/gi, "")
      // Repair dangling stubs: removing a number can leave a short clause
      // that ends in a bare linking/state verb ("…, CPL is." / "…, spend
      // was."), which reads as a broken sentence to the client. Drop that
      // trailing clause (from its leading comma) so the sentence closes
      // cleanly. Bounded length + verb anchor keeps it from eating real
      // clauses. Roy 2026-07-14.
      .replace(
        /,\s+[^,.!?]{1,30}?\s+(?:is|zijn|was|waren|wordt|worden|blijft|blijven|ligt|liggen|staat|staan)\s*(?=[.!?]|$)/gi,
        "",
      )
      // Collapse the double-space / orphan-comma cases the strips can create.
      .replace(/\s+([.,!?])/g, "$1")
      .replace(/,\s*\./g, ".")
      .replace(/ {2,}/g, " ")
      .trim()
  )
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

/** Per-channel KPI rendering.
 *
 *  - WhatsApp: bullets only. The approved template body provides the
 *    "📊 Cijfers deze week:" header above {{3}} so adding our own would
 *    double it up.
 *  - Email: includes the "📊 Afgelopen 7 dagen" header line because the
 *    email body has no template wrapper - we render everything ourselves.
 */
function buildKpiBlock(kpi: KpiSummary | null, channel: Channel): string {
  if (!kpi) return ""
  const lines: string[] = []
  if (channel === "email") lines.push("📊 Afgelopen 7 dagen")
  lines.push(
    `• Ad spend: ${fmtEur(kpi.adSpend)}`,
    `• Leads: ${kpi.leads}`,
    `• Kosten per lead: ${fmtCpl(kpi.cpl)}`,
  )
  const delta = cplDeltaBullet(kpi)
  if (delta) lines.push(delta)
  return lines.join("\n")
}

/** Build the "betaal hier" block listing each overdue invoice with its
 *  Stripe-hosted payment URL. Returns "" when there's nothing overdue
 *  (or when every overdue invoice somehow lacks a hosted URL, which
 *  shouldn't happen but we don't want a header with no links).
 *
 *  WhatsApp keeps a tight one-line-per-invoice layout - Trengo strips
 *  most formatting. Email uses the same shape; HTML rendering of the
 *  URL is up to Trengo's email pipeline.
 */
export function buildOverdueBlock(invoices: OverdueInvoiceForBlock[] | undefined): string {
  if (!invoices || invoices.length === 0) return ""
  const usable = invoices.filter((i) => !!i.hostedUrl)
  if (usable.length === 0) return ""
  const header = usable.length === 1
    ? "⚠️ Openstaande factuur - je kunt direct betalen via deze link:"
    : "⚠️ Openstaande facturen - je kunt direct betalen via onderstaande links:"
  const lines = [header]
  for (const inv of usable) {
    const label = inv.number ? `Factuur ${inv.number}` : "Factuur"
    lines.push(`• ${label} - ${fmtEur(inv.amountDue)}: ${inv.hostedUrl}`)
  }
  return lines.join("\n")
}

// ─── Compose initial parts ───────────────────────────────────────────────

/** Subset of OverdueInvoice the composer cares about. Loose shape so
 *  callers can pass either the Stripe helper's result or a stub from
 *  tests without coupling to the integrations module. */
export type OverdueInvoiceForBlock = {
  amountDue: number
  hostedUrl: string | null
  number: string | null
}

export type ComposeInput = {
  firstName: string
  clientId: string
  /** Drives opener / subject / signOff defaults. Defaults to "whatsapp"
   *  when omitted so older callers keep their behaviour. */
  channel?: Channel
  /** Client's company name (or display name) - only used to seed the
   *  email subject ("Wekelijkse update {name}"). Optional; falls back to
   *  the firstName when missing. */
  clientName?: string
  /** AM's first name - only used to seed the email sign-off ("Groetjes,
   *  {amFirstName}"). Capitalised on render. Falls back to "Roel" when
   *  missing so the placeholder still reads naturally. */
  amFirstName?: string
  kpi: KpiSummary | null
  pedro: PedroInsightBody | null
  /** Render date - pass `new Date()` in production, fixed dates in tests. */
  now?: Date
  /** Human-readable date range for the week the update covers (e.g.
   *  "11 t/m 17 mei"). When set, the intro reads "Hier de update over
   *  de week van {weekLabel}:" instead of one of the random INTROS
   *  variants. Lets the AM see the precise window the KPIs cover so
   *  "afgelopen week" can never mean "rolling 7d". */
  weekLabel?: string
  /** Overdue invoices for this client (Stripe `status: open` with
   *  `due_date < now`). When non-empty, the composer auto-populates
   *  `overdueBlock` with a payment-link list so the client can settle
   *  directly from the message. Empty / omitted → no block, AM's
   *  weekly update stays clean. Roy 2026-05-23. */
  overdueInvoices?: OverdueInvoiceForBlock[]
}

/** Build the initial draft. Picks a weekly intro variant + pre-renders KPI
 *  numbers; everything ends up in `parts` so the dialog can bind each field
 *  to an editable input. */
export function composeInitialParts(input: ComposeInput): ComposedUpdate {
  const now = input.now ?? new Date()
  const seed = seedHash(`${input.clientId}:${now.getUTCFullYear()}:${isoWeek(now)}`)
  // Prefer the deterministic, date-explicit intro when the caller passed
  // a weekLabel. Falls back to the rotating INTROS pool for legacy code
  // paths (tests, ad-hoc dialog opens without a date anchor).
  const intro = input.weekLabel
    ? `Hier de update over de week van ${input.weekLabel}:`
    : pick(INTROS, seed >> 3)
  const firstName = (input.firstName ?? "").trim()
  const channel: Channel = input.channel ?? "whatsapp"
  const isEmail = channel === "email"

  // Opener differs per channel:
  // - Email: full salutation in the body ("Hé Bram,") since there's no
  //   template wrapper.
  // - WhatsApp: just the first name (no "!"); the Trengo template body is
  //   "Hey {{1}}," - Trengo adds the "Hey " prefix and the trailing ",".
  const opener = firstName
    ? isEmail
      ? `Hé ${firstName},`
      : firstName
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

  // Conclusion: one editable block combining the qualitative trend
  // headline + Pedro's nuance. The composer used to ship these as two
  // separate paragraphs (`trendSentence` + `conclusion`), but AMs
  // experienced them as one block and editing across two fields was
  // awkward. They're now merged here; trendSentence stays empty on
  // EditableParts so the rendered output isn't duplicated.
  const pedroConclusion = sanitizePedroConclusionForClient(
    input.pedro?.conclusion?.trim() ?? "",
  )
  const trendLine = trendSentenceFor(input.kpi)
  const bodyConclusion = pedroConclusion || defaultConclusion(input.kpi)
  const conclusion = noSignal
    ? "We zijn nog aan het opstarten met je campagne. Zodra er cijfers zijn deel ik die direct."
    : trendLine
      ? `${trendLine}\n\n${bodyConclusion}`
      : bodyConclusion

  // Actions: ONLY Pedro's data-grounded bullets - never a generic filler
  // list. Roy 2026-07-14: the old fallback invented plausible-but-fake
  // actions ("nieuwe angle testen") that committed the team to work nobody
  // agreed to. When Pedro has nothing concrete, the section stays empty:
  // for email `renderFromParts` omits it entirely, and for WhatsApp the
  // fixed template header falls back to an honest "we optimise daily" line
  // (see `partsToWeeklyUpdateParams`), not a fabricated task.
  const pedroActions = (input.pedro?.actions ?? []).filter((a) => a.trim().length > 0)
  const actions = noSignal ? [] : pedroActions.slice(0, 3)

  return {
    parts: {
      opener,
      intro: noSignal ? "" : intro,
      kpiBlock: buildKpiBlock(input.kpi, channel),
      // trendSentence merged into `conclusion` above. Field kept on the
      // type for backwards compat with stored drafts, but always empty
      // for new composes - renderers should ignore it.
      trendSentence: "",
      note: "",
      conclusion,
      // WhatsApp: empty - the approved template body provides
      // "✅ Wat we deze week gaan doen:" above {{5}}. Email: still
      // included since email has no template wrapper.
      actionsHeader: noSignal
        ? ""
        : isEmail
          ? "✅ Wat we deze week gaan doen:"
          : "",
      actions,
      subject,
      signOff,
      overdueBlock: buildOverdueBlock(input.overdueInvoices),
    },
  }
}

// ─── Render to final string ──────────────────────────────────────────────

/** Pure stringification of the editable parts. Skips empty fields so a
 *  cleared-out section doesn't leave a stray blank line behind.
 *
 *  Subject is NOT emitted - it's metadata sent alongside the body when the
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

  // Overdue invoices sit between actions and sign-off - they're a
  // call-to-action so reading order is: what happened → what we're
  // doing → please settle these → sign off.
  if (parts.overdueBlock?.trim()) blocks.push(parts.overdueBlock.trim())

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
 * already contains the structural pieces - paragraph breaks, the "📊 Cijfers
 * deze week:" header, the "✅ Wat we deze week gaan doen:" header, and the
 * per-AM sign-off - so the variables hold ONLY the bare content.
 *
 * Slot mapping:
 *   [0] → {{1}}  first name (no trailing "!")
 *   [1] → {{2}}  intro sentence
 *   [2] → {{3}}  KPI as flat comma-separated phrase, no bullets
 *                ("Ad spend: €389, leads: 66, kosten per lead: €5,90")
 *   [3] → {{4}}  trend + AM note + conclusion as one flowing paragraph
 *   [4] → {{5}}  actions as flowing sentences joined with spaces, no bullets
 *
 * Why bullet-free: Meta accepts `•` characters in template body params,
 * BUT the per-AM real-world testing showed Trengo / Meta rejecting our
 * 5-var sends despite all sanitisation. The user asked for prose-style
 * params (Ad spend: €X, leads: Y, …) instead of bulleted ones; that's
 * the format that gets through cleanly. The template body itself can
 * still wrap the bullets visually if Meta-approved that way.
 *
 * Email keeps its bulleted/multi-line shape - it uses `renderFromParts`,
 * not this function, since email has no HSM-template variable limits.
 */
export function partsToWeeklyUpdateParams(parts: EditableParts): string[] {
  const firstName = String(parts.opener ?? "")
    .replace(/[!?.,;:]+$/, "")
    .trim()

  const intro = sanitizeForWaParam(parts.intro)

  // KPI: strip the leading "📊 …" header, drop bullet markers from each
  // line, join with comma-space so it reads as a sentence-style phrase.
  // Ensures the final phrase ends with a period so the next paragraph
  // doesn't run on awkwardly when WhatsApp wraps it.
  const kpiInline = sanitizeForWaParam(
    finishSentence(
      stripLeadingHeaderLine(String(parts.kpiBlock ?? ""))
        .split("\n")
        .map((line) => line.replace(/^\s*[•\-*]\s*/, "").trim())
        .filter(Boolean)
        .join(", "),
    ),
  )

  // Trend, AM note, and Pedro's conclusion all describe "what's happening"
  // and slot into the same paragraph between KPIs and the action list.
  const bodyInline = sanitizeForWaParam(
    [parts.trendSentence, parts.note, parts.conclusion]
      .map((s) => String(s ?? "").trim())
      .filter(Boolean)
      .join(" "),
  )

  // Actions: each is its own sentence/question. Drop bullet markers,
  // ensure trailing punctuation, join with single spaces so they read
  // as a flowing paragraph.
  //
  // Overdue invoices ride along in the same slot: WhatsApp HSM templates
  // only have 5 body variables, and Meta does not allow URLs in template
  // params for most categories - we therefore inline them into the action
  // paragraph so they land somewhere visible. The "betaal hier" sentence
  // + URLs come AFTER the actions so the optimisation actions read first
  // and the payment ask is the closing CTA. Empty overdue block adds
  // nothing.
  const overdueInline = sanitizeForWaParam(
    String(parts.overdueBlock ?? "")
      .split("\n")
      .map((line) => line.replace(/^\s*[•\-*]\s*/, "").trim())
      .filter(Boolean)
      .map(finishSentence)
      .join(" "),
  )
  const actionsInline = sanitizeForWaParam(
    [
      (parts.actions ?? [])
        .map((a) => String(a ?? "").trim().replace(/^[•\-*]\s*/, ""))
        .filter(Boolean)
        .map(finishSentence)
        .join(" "),
      overdueInline,
    ]
      .filter(Boolean)
      .join(" "),
  )

  // Meta rejects WhatsApp template body parameters that are empty, null,
  // or anything other than a non-empty string - the error surfaces as
  // "JSON schema constraint 'type' for the JSON field 'text.body' …
  // expected: 'string'", which is misleading (empty string IS a string,
  // but Meta validates non-empty here). Guarantee every slot has
  // *something* sensible by substituting a per-slot fallback when our
  // composer produced nothing useful. The AM can always edit before
  // sending; this is the floor.
  return [
    firstName || "daar",
    intro || "Update over de afgelopen week.",
    kpiInline || "Geen meetbare cijfers deze week.",
    bodyInline || "Ik houd de campagne dagelijks in de gaten en stuur bij waar nodig.",
    // WhatsApp forces content under the fixed "✅ Wat we deze week gaan
    // doen:" template header, so an empty {{5}} isn't allowed. When Pedro
    // gave us no concrete, data-grounded actions we do NOT invent a task -
    // we state the honest standard practice (daily optimisation, process.md
    // Fase 4) instead of a fabricated commitment. Roy 2026-07-14.
    actionsInline || "We optimaliseren de campagne dagelijks en sturen bij waar nodig.",
  ]
}

/** Append a trailing period when the string doesn't already end with
 *  one of `.!?:` - so chained sentences/phrases don't run together. */
function finishSentence(s: string): string {
  const t = s.trim()
  if (!t) return t
  return /[.!?:]$/.test(t) ? t : `${t}.`
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
  // Coerce: callers can hand us `null`/`undefined` from optional-field
  // EditableParts and we must NEVER let those reach the Trengo payload
  // (Meta rejects non-string body params with a misleading "expected:
  // 'string'" 422). Empty string is a valid intermediate - the per-slot
  // empty fallback in partsToWeeklyUpdateParams handles those.
  const str = String(s ?? "")
  if (!str) return ""
  return str
    .replace(/\n\s*[•\-*]\s+/g, " • ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
}
