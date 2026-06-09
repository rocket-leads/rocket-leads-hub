import type { MondayClient } from "@/lib/integrations/monday"
import { createAdminClient } from "@/lib/supabase/server"
import { collectClientAiContext, type ClientAiContext } from "./insights/context"
import { listFolderFiles, getFileContent, type DriveFile } from "@/lib/integrations/google-drive"

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
 * Hub — Monday updates, Trengo conversations, Fathom kick-offs, agreement
 * data, Drive files — just never plumbed into creative-refresh.
 *
 * Roy 2026-06-09.
 */

/** Filename keywords that historically carry the kind of long-form
 *  product/ICP context we want Pedro to read. Conservative list — too
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
 *  for legacy clients that never ran Pedro Onboard — caller renders
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
  return `MONDAY CRM UPDATES (afgelopen 14d — wat het team intern noteert; status counts = all-time):\n${ctx.mondayTrengo.mondayUpdates.slice(0, 1500)}`
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
      return `[${date} · ${e.kind} · ${e.source}] ${e.title}${e.body ? ` — ${e.body.slice(0, 200)}` : ""}`
    })
  if (lines.length === 0) return ""
  return `HUB INBOX (interne team-notes over deze klant):\n${lines.join("\n")}`
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
  /** Ready-to-inject text block — splice this directly into the prompt. */
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
  }
  /** Rough char budget — useful to log/track token cost growth. */
  charCount: number
}

/**
 * Build the full context block for one client.
 *
 * Calls collectClientAiContext under the hood + fetches Drive content
 * in parallel. Every source has its own try/catch — a slow Trengo or
 * a broken Drive share returns an empty section rather than failing
 * the whole context build.
 */
export async function buildCreativeRefreshContext(
  client: MondayClient,
): Promise<CreativeRefreshContextResult> {
  const [ctx, drive, brief] = await Promise.all([
    collectClientAiContext(client),
    fetchDriveContext(client.googleDriveId ?? ""),
    fetchBrief(client.mondayItemId),
  ])

  const briefBlock = fmtBriefBlock(brief)
  const sections = [
    briefBlock,
    fmtAgreementBlock(ctx),
    fmtMondayUpdatesBlock(ctx),
    fmtFathomBlock(ctx),
    fmtTrengoBlock(ctx),
    fmtInboxBlock(ctx),
    fmtDriveBlock(drive),
  ].filter((s) => s.length > 0)

  const block = sections.length > 0
    ? `CLIENT CONTEXT (ground-truth bronnen — gebruik dit om de proposals te grounden, NIET om te speculeren):\n\n${sections.join("\n\n")}`
    : `CLIENT CONTEXT: geen aanvullende bronnen beschikbaar — alleen Meta performance. Wees expliciet voorzichtig met aannames over wat klant verkoopt of wie de doelgroep is.`

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
    },
    charCount: block.length,
  }
}
