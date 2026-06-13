import type { MondayClient } from "@/lib/integrations/monday"
import { createAdminClient } from "@/lib/supabase/server"
import { collectClientAiContext, type ClientAiContext } from "./insights/context"
import { listFolderFiles, getFileContent, type DriveFile } from "@/lib/integrations/google-drive"
import { resolveVisualStylePolicy } from "./visual-style-policy"

/**
 * Full creative-refresh context composer.
 *
 * Pulls every grounded context source the Hub has on a client (the
 * ClientAiContext bundle + Google Drive folder contents) and renders
 * them as a single CLIENT CONTEXT block ready to inject at the top of
 * the creative-refresh prompt.
 *
 * Why this matters (Roy's Zumex flag 2026-06-09): without grounded
 * context Pedro hallucinated B2C smoothie ads for a B2B industrial
 * juicer company. The information to prevent that was already in the
 * Hub - Monday updates, Trengo conversations, Fathom kick-offs, agreement
 * data, Drive files - just never plumbed into creative-refresh.
 *
 * Roy 2026-06-09.
 */

/** Filename keywords that historically carry the kind of long-form
 *  product/ICP context we want Pedro to read. Conservative list - too
 *  permissive and we burn tokens on irrelevant files. */
const DRIVE_KEYWORD_RE = /(kick.?off|brief|intake|onboard|start|propositie|aanbod|positionering|brand|style.?guide|gids|manual|strateg)/i

/** Max files we'll pull content from per refresh. Each ~1KB of text =
 *  ~250 tokens; 3 files keeps the context block under ~750 tokens. */
const DRIVE_MAX_FILES = 3

/** Char cap per Drive file content. Bigger files get the first slice;
 *  most kick-off docs / briefs are ≤2KB anyway. */
const DRIVE_CONTENT_CHARS = 2000

/** Mime types we know how to extract text from. PDFs go through the
 *  extractor in google-drive.ts; Docs/Sheets/Slides export as text. */
const SUPPORTED_DRIVE_MIMES = new Set([
  "application/pdf",
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
])

type DriveContentEntry = {
  name: string
  mimeType: string
  modifiedTime: string
  content: string | null
  error?: string
}

/**
 * Fetch + read the most-likely-relevant Drive files. Best-effort: any
 * folder-access error returns an empty list rather than failing the
 * whole context build (we still have Monday/Trengo/Fathom to fall back
 * on). The Drive folder id comes from the client's `googleDriveId`
 * Monday field.
 */
async function fetchDriveContext(
  googleDriveId: string,
): Promise<{ files: DriveContentEntry[]; folderListed: boolean; error?: string }> {
  if (!googleDriveId?.trim()) {
    return { files: [], folderListed: false }
  }
  let allFiles: DriveFile[]
  try {
    allFiles = await listFolderFiles(googleDriveId.trim())
  } catch (e) {
    return {
      files: [],
      folderListed: false,
      error: e instanceof Error ? e.message : "Drive folder niet toegankelijk",
    }
  }

  // Score: keyword match in name wins; otherwise fall back to recent
  // modification. Within keyword matches, prefer recent.
  const scored = allFiles.map((f) => ({
    file: f,
    keywordHit: DRIVE_KEYWORD_RE.test(f.name),
    modifiedMs: Date.parse(f.modifiedTime) || 0,
  }))

  const sorted = scored.sort((a, b) => {
    if (a.keywordHit !== b.keywordHit) return a.keywordHit ? -1 : 1
    return b.modifiedMs - a.modifiedMs
  })

  const candidates = sorted
    .filter((s) => SUPPORTED_DRIVE_MIMES.has(s.file.mimeType))
    .slice(0, DRIVE_MAX_FILES)

  const results: DriveContentEntry[] = []
  for (const cand of candidates) {
    try {
      const raw = await getFileContent(cand.file.id, cand.file.mimeType)
      results.push({
        name: cand.file.name,
        mimeType: cand.file.mimeType,
        modifiedTime: cand.file.modifiedTime,
        content: raw.slice(0, DRIVE_CONTENT_CHARS) || null,
      })
    } catch (e) {
      results.push({
        name: cand.file.name,
        mimeType: cand.file.mimeType,
        modifiedTime: cand.file.modifiedTime,
        content: null,
        error: e instanceof Error ? e.message : "read failed",
      })
    }
  }

  return { files: results, folderListed: true }
}

// ─── Renderers per section ──────────────────────────────────────────────

function trim(s: string | null | undefined, max: number): string {
  if (!s) return ""
  return s.replace(/\s+/g, " ").trim().slice(0, max)
}

/** Fetch the latest pedro_client_state.brief for this client. Empty
 *  for legacy clients that never ran Pedro Onboard - caller renders
 *  a no-brief sentinel in that case so Pedro knows context is sparse. */
async function fetchBrief(
  mondayItemId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from("pedro_client_state")
      .select("brief")
      .eq("client_id", mondayItemId)
      .order("campaign_number", { ascending: false })
      .limit(1)
      .maybeSingle<{ brief: Record<string, unknown> | null }>()
    return data?.brief ?? null
  } catch {
    return null
  }
}

/** Per-client brand identity (hex codes + font families) from the most
 *  recent saved brand_style. Pedro references these by name in image
 *  prompts so Gemini renders headlines/CTA in brand-consistent colors
 *  and typefaces. Roy 2026-06-10. */
async function fetchBrandStyle(
  mondayItemId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from("pedro_client_state")
      .select("brand_style")
      .eq("client_id", mondayItemId)
      .order("campaign_number", { ascending: false })
      .limit(1)
      .maybeSingle<{ brand_style: Record<string, unknown> | null }>()
    return data?.brand_style ?? null
  } catch {
    return null
  }
}

/** Recent CM iterations on this client's creatives - explicit feedback,
 *  prompt edits, manual uploads. Pulled into the prompt so Pedro learns
 *  per-client preferences (logo size, headline format, photo style) and
 *  needs fewer iterations to land the first-shot output. Roy 2026-06-10
 *  per knowledge/campaigns.md §Image Creative Principles #5.
 *
 *  Roy 2026-06-13: split into a dual loop. Per-client (scope in
 *  'client','both') is STRICT — Pedro must never repeat the same
 *  mistake on this client. Global (scope in 'global','both') is
 *  ADVISORY — general craft notes from all clients; Pedro decides
 *  per-generation whether each one applies in context. */
type FeedbackRow = {
  feedback_type: "explicit" | "prompt_edit" | "regen" | "upload"
  feedback_text: string
  created_at: string
  /** Source client — only set on global-pool rows so the prompt can
   *  hint "deze tip is uit een andere klant" without exposing IDs. */
  source_client_id?: string | null
}

async function fetchCreativeFeedback(
  mondayItemId: string,
  limit = 12,
): Promise<FeedbackRow[]> {
  try {
    const supabase = await createAdminClient()
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
    // Per-client strict loop: rows that the classifier tagged as
    // 'client' or 'both' for THIS client_id. These bind tightly to
    // this brand / audience / industry.
    const { data } = await supabase
      .from("pedro_creative_feedback")
      .select("feedback_type, feedback_text, created_at")
      .eq("client_id", mondayItemId)
      .in("scope", ["client", "both"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit)
    return (data ?? []) as FeedbackRow[]
  } catch {
    return []
  }
}

/** Global advisory pool — feedback the classifier flagged as broadly
 *  applicable ('global' or 'both'). Pulled across ALL clients; Pedro
 *  picks the ones that fit the current generation's context.
 *
 *  We pull a slightly larger window (180d) here because globally-
 *  applicable craft notes age more slowly than per-client preferences.
 *  De-dup is best-effort via text-similarity below. */
async function fetchGlobalCreativeFeedback(
  excludeClientId: string,
  limit = 18,
): Promise<FeedbackRow[]> {
  try {
    const supabase = await createAdminClient()
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString()
    const { data } = await supabase
      .from("pedro_creative_feedback")
      .select("feedback_type, feedback_text, created_at, client_id")
      .in("scope", ["global", "both"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit * 3) // over-fetch to leave headroom for dedup
    const rows = (data ?? []) as Array<{
      feedback_type: FeedbackRow["feedback_type"]
      feedback_text: string
      created_at: string
      client_id: string
    }>
    // Skip rows that came from THIS client — they're already in the
    // per-client strict block, no need to repeat advisory-side.
    const filtered = rows.filter((r) => r.client_id !== excludeClientId)
    // Naive dedup: collapse near-identical feedback text (first 80 chars,
    // case-insensitive, whitespace-normalised). Keeps the most recent.
    const seen = new Set<string>()
    const deduped: FeedbackRow[] = []
    for (const r of filtered) {
      const key = r.feedback_text
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80)
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push({
        feedback_type: r.feedback_type,
        feedback_text: r.feedback_text,
        created_at: r.created_at,
        source_client_id: r.client_id,
      })
      if (deduped.length >= limit) break
    }
    return deduped
  } catch {
    return []
  }
}

function fmtBriefBlock(brief: Record<string, unknown> | null): string {
  if (!brief) return ""
  const fields: Array<[string, string]> = []
  const fieldMap: Record<string, string> = {
    bedrijf: "Bedrijf",
    sector: "Sector",
    doel: "Doelgroep",
    doelgroep: "Doelgroep",
    pijn: "Pijnpunten",
    pijnpunten: "Pijnpunten",
    aanbod: "Aanbod",
    usps: "USPs",
  }
  for (const [key, label] of Object.entries(fieldMap)) {
    const val = brief[key]
    if (typeof val === "string" && val.trim()) {
      fields.push([label, trim(val, 400)])
    }
  }
  if (fields.length === 0) return ""
  return `BRIEF (handmatig ingevuld bij onboarding):\n${fields.map(([l, v]) => `- ${l}: ${v}`).join("\n")}`
}

function fmtAgreementBlock(ctx: ClientAiContext): string {
  if (!ctx.agreement) return ""
  const a = ctx.agreement.agreement
  const platforms = a.platforms.length > 0 ? a.platforms.join(", ") : "geen"
  return `AGREEMENT (wat klant betaalt = signaal voor seriousness/scale):\n- Ad budget: €${a.ad_budget}/mnd · Platforms: ${platforms} · MRR €${ctx.agreement.monthly} · follow-up: ${a.follow_up}`
}

function fmtMondayUpdatesBlock(ctx: ClientAiContext): string {
  if (!ctx.sources.mondayUpdates || !ctx.mondayTrengo?.mondayUpdates) return ""
  return `MONDAY CRM UPDATES (afgelopen 14d - wat het team intern noteert; status counts = all-time):\n${ctx.mondayTrengo.mondayUpdates.slice(0, 1500)}`
}

function fmtTrengoBlock(ctx: ClientAiContext): string {
  if (!ctx.sources.trengoSummary || !ctx.mondayTrengo?.trengoSummary) return ""
  return `TRENGO CONVERSATIONS (WA/email met klant, afgelopen 14d):\n${ctx.mondayTrengo.trengoSummary.slice(0, 1200)}`
}

function fmtFathomBlock(ctx: ClientAiContext): string {
  if (!ctx.sources.fathomMeetings || ctx.fathomMeetings.length === 0) return ""
  // Prioritise kick-off meetings: they carry the most "what does this client sell, who's
  // their target" info. After kick-off, evaluation calls reveal current pain points.
  const sorted = [...ctx.fathomMeetings].sort((a, b) => {
    const score = (m: typeof a) => {
      if (m.meetingType === "kick_off") return 3
      if (m.meetingType === "evaluation") return 2
      if (m.meetingType === "sales") return 1
      return 0
    }
    return score(b) - score(a)
  })
  const lines = sorted.slice(0, 3).map((m) => {
    const date = m.scheduledAt ? m.scheduledAt.slice(0, 10) : "?"
    const summary = m.summary ? m.summary.slice(0, 500) : "(geen samenvatting)"
    return `[${date} · ${m.meetingType ?? "meeting"}] ${m.title ?? ""}\n  ${summary}`
  })
  return `FATHOM MEETINGS (transcripts, prioriteit op kick-off → evaluation → sales):\n${lines.join("\n")}`
}

function fmtInboxBlock(ctx: ClientAiContext): string {
  if (!ctx.sources.inboxEvents || ctx.inboxEvents.length === 0) return ""
  const lines = ctx.inboxEvents
    .slice(0, 6)
    .filter((e) => e.body && e.body.trim().length > 0)
    .map((e) => {
      const date = e.createdAt.slice(0, 10)
      return `[${date} · ${e.kind} · ${e.source}] ${e.title}${e.body ? ` - ${e.body.slice(0, 200)}` : ""}`
    })
  if (lines.length === 0) return ""
  return `HUB INBOX (interne team-notes over deze klant):\n${lines.join("\n")}`
}

/** Pull the visual-style config out of a brief blob. Returns null when
 *  the brief is empty or has no visual-style fields (pre-2026-06-10) -
 *  policy resolver normalises null into defaults. */
function readVisualStyleConfig(
  brief: Record<string, unknown> | null,
): import("./visual-style-policy").VisualStyleConfig | null {
  if (!brief) return null
  const out: import("./visual-style-policy").VisualStyleConfig = {}
  if (
    brief.visualStyleMode === "website" ||
    brief.visualStyleMode === "drive_only" ||
    brief.visualStyleMode === "winning_ad_only" ||
    brief.visualStyleMode === "custom"
  ) {
    out.visualStyleMode = brief.visualStyleMode
  }
  if (typeof brief.customStylePrompt === "string") {
    out.customStylePrompt = brief.customStylePrompt
  }
  if (
    brief.fallbackFontHeading === "inter" ||
    brief.fallbackFontHeading === "manrope" ||
    brief.fallbackFontHeading === "plus_jakarta"
  ) {
    out.fallbackFontHeading = brief.fallbackFontHeading
  }
  const t = brief.websiteToggles as Record<string, unknown> | undefined | null
  if (t && typeof t === "object") {
    out.websiteToggles = {
      useColors: t.useColors !== false,
      useFonts: t.useFonts !== false,
      useLookFeel: t.useLookFeel !== false,
      useLogo: t.useLogo !== false,
    }
  }
  return out
}

/** Coerce a raw JSONB brand_style blob into the BrandStyle shape. Used
 *  here only to pass into the visual-style policy resolver - that helper
 *  is strict about field shapes so we filter unknown values upfront. */
function coerceBrandStyle(
  raw: Record<string, unknown> | null,
): import("./helpers").BrandStyle | null {
  if (!raw) return null
  const str = (v: unknown) => (typeof v === "string" ? v : undefined)
  const verdictRaw = raw.qualityVerdict as Record<string, unknown> | undefined
  const verdict =
    verdictRaw && typeof verdictRaw === "object"
      ? {
          score: typeof verdictRaw.score === "number" ? verdictRaw.score : 0,
          axes: {
            design_quality:
              typeof (verdictRaw.axes as Record<string, unknown>)?.design_quality === "number"
                ? ((verdictRaw.axes as Record<string, unknown>).design_quality as number)
                : null,
            photo_quality:
              typeof (verdictRaw.axes as Record<string, unknown>)?.photo_quality === "number"
                ? ((verdictRaw.axes as Record<string, unknown>).photo_quality as number)
                : null,
            brand_consistency:
              typeof (verdictRaw.axes as Record<string, unknown>)?.brand_consistency === "number"
                ? ((verdictRaw.axes as Record<string, unknown>).brand_consistency as number)
                : null,
            completeness:
              typeof (verdictRaw.axes as Record<string, unknown>)?.completeness === "number"
                ? ((verdictRaw.axes as Record<string, unknown>).completeness as number)
                : null,
          },
          flags: Array.isArray(verdictRaw.flags)
            ? (verdictRaw.flags as unknown[]).filter((f): f is string => typeof f === "string")
            : [],
          summary: typeof verdictRaw.summary === "string" ? verdictRaw.summary : "",
          computedAt:
            typeof verdictRaw.computedAt === "string" ? verdictRaw.computedAt : "",
          model: typeof verdictRaw.model === "string" ? verdictRaw.model : "",
        }
      : undefined
  return {
    primaryColor: str(raw.primaryColor) ?? "",
    secondaryColor: str(raw.secondaryColor) ?? "",
    accentColor: str(raw.accentColor),
    tone: str(raw.tone) ?? "",
    industry: str(raw.industry) ?? "",
    brandKeywords: str(raw.brandKeywords) ?? "",
    visualStyle: str(raw.visualStyle) ?? "",
    headingFont: str(raw.headingFont),
    bodyFont: str(raw.bodyFont),
    logoUrl: str(raw.logoUrl),
    heroImageUrl: str(raw.heroImageUrl),
    taglineHeadline: str(raw.taglineHeadline),
    taglineSubline: str(raw.taglineSubline),
    qualityVerdict: verdict,
  }
}

function fmtBrandStyleBlock(
  brand: Record<string, unknown> | null,
  brief: Record<string, unknown> | null,
): string {
  // Pure resolver - no DB access, no side effects. Brief carries the CM
  // controls (mode + toggles + custom prompt + fallback font); brand
  // carries the scraped fingerprint + its quality verdict.
  const config = readVisualStyleConfig(brief)
  const brandStyle = coerceBrandStyle(brand)
  const policy = resolveVisualStylePolicy(config, brandStyle)
  if (policy.brandBlockLines.length === 0) return ""
  return policy.brandBlockLines.join("\n")
}

function fmtFeedbackBlock(rows: FeedbackRow[]): string {
  if (rows.length === 0) return ""
  // Weight: explicit feedback weighs heaviest. Prompt edits are also
  // strong (CM steered the model away from the default). Upload events
  // tell Pedro that the AI was UNUSABLE for that variant. Regen is
  // low-signal (we skip them in the prompt block).
  const weighted = rows.filter((r) => r.feedback_type !== "regen")
  if (weighted.length === 0) return ""
  // Most-recent first, max 8 lines so we stay under ~600 chars.
  const lines = weighted.slice(0, 8).map((r) => {
    const date = r.created_at.slice(0, 10)
    const tag = r.feedback_type === "explicit"
      ? "CM"
      : r.feedback_type === "prompt_edit"
        ? "edit"
        : "upload"
    const body = r.feedback_text.replace(/\s+/g, " ").trim().slice(0, 240)
    return `- [${date} · ${tag}] ${body}`
  })
  // STRICT framing — Pedro mag deze NOOIT meer missen op deze klant.
  // Same wording als de eerdere block; classifier-tag verandert alleen
  // welke rows hier landen, niet hoe ze worden ingeleest.
  return `KLANT-FEEDBACK PATRONEN — STRIKT (laatste 90d, Pedro moet ELKE volgende imagePrompt voor deze klant hierop afstemmen; recente feedback wint van oude; deze regels zijn brand/taste/audience-specifiek en niet onderhandelbaar):\n${lines.join("\n")}`
}

/** Advisory block — globally-applicable craft notes from the rest of
 *  the client portfolio. Different framing from the strict per-client
 *  block: Pedro decides PER GENERATION whether each note applies given
 *  the current variant's context. Roy 2026-06-13. */
function fmtGlobalFeedbackBlock(rows: FeedbackRow[]): string {
  if (rows.length === 0) return ""
  const weighted = rows.filter((r) => r.feedback_type !== "regen")
  if (weighted.length === 0) return ""
  const lines = weighted.slice(0, 10).map((r) => {
    const date = r.created_at.slice(0, 10)
    const tag = r.feedback_type === "explicit"
      ? "CM"
      : r.feedback_type === "prompt_edit"
        ? "edit"
        : "upload"
    const body = r.feedback_text.replace(/\s+/g, " ").trim().slice(0, 200)
    return `- [${date} · ${tag}] ${body}`
  })
  return `GLOBALE CRAFT-NOTES (laatste 180d uit andere klanten - ADVISORY, geen STRIKTE regels): dit zijn algemene design / quality / craft lessen die CMs op andere creatives hebben gegeven. Pedro beoordeelt PER GENERATIE of een note relevant is voor deze specifieke variant — pas alleen toe wanneer het past in de context, negeer wanneer het botst met klant-specifieke voorkeuren of brief-richting:\n${lines.join("\n")}`
}

function fmtDriveBlock(drive: Awaited<ReturnType<typeof fetchDriveContext>>): string {
  if (!drive.folderListed) {
    return drive.error
      ? `GOOGLE DRIVE: niet toegankelijk (${drive.error}). Service-account heeft mogelijk geen Viewer-rechten op de folder.`
      : ""
  }
  if (drive.files.length === 0) {
    return `GOOGLE DRIVE: folder is leeg of bevat geen kick-off/brief/brand docs.`
  }
  const blocks = drive.files.map((f) => {
    const date = f.modifiedTime ? ` (modified ${f.modifiedTime.slice(0, 10)})` : ""
    if (f.content) {
      return `--- ${f.name}${date} ---\n${f.content}`
    }
    return `--- ${f.name}${date} --- (${f.error ?? "geen content"})`
  })
  return `GOOGLE DRIVE (top ${drive.files.length} bestanden uit klant-folder, gekozen op naam-match + recentheid):\n${blocks.join("\n\n")}`
}

// ─── Public API ─────────────────────────────────────────────────────────

export type CreativeRefreshContextResult = {
  /** Ready-to-inject text block - splice this directly into the prompt. */
  block: string
  /** Per-source flags for downstream observability / debugging. */
  sources: {
    brief: boolean
    agreement: boolean
    mondayUpdates: boolean
    trengoSummary: boolean
    fathomMeetings: boolean
    inboxEvents: boolean
    drive: boolean
    driveFileCount: number
    /** Whether brand_style (hex codes + fonts) was injected. */
    brandStyle: boolean
    /** Number of weighted CM-feedback rows pulled into the prompt
     *  (excludes raw regen events). 0 = no feedback loop yet. */
    feedbackCount: number
    /** Number of globally-applicable craft notes pulled in from other
     *  clients' history (scope in 'global','both', excludes regen).
     *  Roy 2026-06-13: dual feedback loop signal. */
    globalFeedbackCount: number
  }
  /** Rough char budget - useful to log/track token cost growth. */
  charCount: number
}

/**
 * Build the full context block for one client.
 *
 * Calls collectClientAiContext under the hood + fetches Drive content
 * in parallel. Every source has its own try/catch - a slow Trengo or
 * a broken Drive share returns an empty section rather than failing
 * the whole context build.
 */
export async function buildCreativeRefreshContext(
  client: MondayClient,
): Promise<CreativeRefreshContextResult> {
  const [ctx, drive, brief, brand, feedback, globalFeedback] = await Promise.all([
    collectClientAiContext(client),
    fetchDriveContext(client.googleDriveId ?? ""),
    fetchBrief(client.mondayItemId),
    fetchBrandStyle(client.mondayItemId),
    fetchCreativeFeedback(client.mondayItemId, 12),
    fetchGlobalCreativeFeedback(client.mondayItemId, 18),
  ])

  const briefBlock = fmtBriefBlock(brief)
  // Brand block consults the brief for the CM's visual-style config
  // (mode + toggles + fallback font + custom prompt). When that block
  // says "fingerprint suppressed (quality <40)" or "Drive only" etc,
  // the block here changes shape accordingly.
  const brandBlock = fmtBrandStyleBlock(brand, brief)
  const feedbackBlock = fmtFeedbackBlock(feedback)
  // Global advisory block sits AFTER the strict per-client block so
  // Pedro reads it as the lower-priority signal. When per-client and
  // global notes conflict, the per-client wins (the framing above says
  // so explicitly).
  const globalFeedbackBlock = fmtGlobalFeedbackBlock(globalFeedback)
  const sections = [
    briefBlock,
    brandBlock,
    feedbackBlock,
    globalFeedbackBlock,
    fmtAgreementBlock(ctx),
    fmtMondayUpdatesBlock(ctx),
    fmtFathomBlock(ctx),
    fmtTrengoBlock(ctx),
    fmtInboxBlock(ctx),
    fmtDriveBlock(drive),
  ].filter((s) => s.length > 0)

  const block = sections.length > 0
    ? `CLIENT CONTEXT (ground-truth bronnen - gebruik dit om de proposals te grounden, NIET om te speculeren):\n\n${sections.join("\n\n")}`
    : `CLIENT CONTEXT: geen aanvullende bronnen beschikbaar - alleen Meta performance. Wees expliciet voorzichtig met aannames over wat klant verkoopt of wie de doelgroep is.`

  return {
    block,
    sources: {
      brief: briefBlock.length > 0,
      agreement: !!ctx.agreement,
      mondayUpdates: !!ctx.sources.mondayUpdates,
      trengoSummary: !!ctx.sources.trengoSummary,
      fathomMeetings: ctx.sources.fathomMeetings,
      inboxEvents: ctx.sources.inboxEvents,
      drive: drive.folderListed,
      driveFileCount: drive.files.length,
      brandStyle: brandBlock.length > 0,
      feedbackCount: feedback.filter((r) => r.feedback_type !== "regen").length,
      globalFeedbackCount: globalFeedback.filter((r) => r.feedback_type !== "regen").length,
    },
    charCount: block.length,
  }
}
