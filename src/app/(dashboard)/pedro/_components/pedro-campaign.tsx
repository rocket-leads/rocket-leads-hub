"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { parseScriptText, generateScriptDocx, type ScriptVideo } from "@/lib/pedro/generate-script-docx";
import { clientSlug, buildClientMD, parseClientMD, type ClientData, type ClientCampaign } from "@/lib/pedro/client-database";
import type { PedroClient } from "../page";
import { StageActionBar } from "./stage-action-bar";
import { saveIfChanged } from "@/lib/pedro/save-if-changed";
import {
  anglesString,
  scriptContext as buildScriptContext,
  styleReference,
  huisstijlContext as buildHuisstijlContext,
  huisstijlForLp as buildHuisstijlForLp,
  previousManusReference,
  // The other build* prompt functions moved server-side (#7); only the
  // creatives master prompt stays client-side because it's a static
  // string assembly that doesn't hit Claude.
  buildCreativesMasterPrompt,
} from "@/lib/pedro/prompts";

// ── Types ──
interface BriefData {
  bedrijf: string;
  sector: string;
  doel: string;
  pijn: string;
  aanbod: string;
  usps: string;
  hooksAM: string;
  hooksExtra: string;
}

interface Angle {
  nummer: number;
  titel: string;
  beschrijving: string;
}

interface AdCopy {
  variantA: string;
  variantB: string;
  headlines: string;
  beschrijving: string;
}

interface BrandStyle {
  primaryColor: string;
  secondaryColor: string;
  accentColor?: string;
  tone: string;
  industry: string;
  brandKeywords: string;
  visualStyle: string;
}

interface ExtractedColor {
  hex: string;
  score: number;
  source: string;
  luminance: number;
}

interface MetaAd {
  id: string;
  name: string;
  body: string;
  title: string;
  imageUrl: string;
  accountName: string;
  campaignName: string;
}

// ── Helpers ──
/** Stage → typed prompt-builder args. Mirrors STAGE_CONFIGS on the
 *  server side. Server picks the prompt builder + default model +
 *  default max_tokens from the stage name; client just sends typed
 *  options. */
type StageOptionsMap = {
  angles: import("@/lib/pedro/prompts").AnglesPromptArgs;
  script: import("@/lib/pedro/prompts").ScriptPromptArgs;
  creatives: import("@/lib/pedro/prompts").CreativesDescriptionsArgs;
  lp: import("@/lib/pedro/prompts").LpPromptArgs;
  "ad-copy": import("@/lib/pedro/prompts").AdCopyPromptArgs;
};
type StageName = keyof StageOptionsMap;

type ClaudeCtx = {
  clientId?: string | null;
  /** "haiku" override for structured-output stages, "sonnet" for prose.
   *  Server falls back to a sensible per-stage default — set this only
   *  when forcing a different tier than the default. */
  model?: "sonnet" | "haiku";
  /** Override max_tokens when the per-stage default isn't enough — e.g.
   *  the truncation-retry doubles this before re-calling. */
  maxTokens?: number;
  /** Called with each text delta as Claude streams. The cumulative full
   *  text so far is passed alongside the delta so prose stages can drive
   *  a state setter directly without managing their own buffer. JSON
   *  stages don't pass this — they need the final text to parse. */
  onDelta?: (delta: string, fullSoFar: string) => void;
};

type ClaudeResult = { text: string; stopReason: string | null };

/**
 * Consumes the streaming SSE response from /api/pedro/claude. The route
 * only speaks SSE, so prose stages can render progressively via onDelta
 * and JSON stages just await the final text. The route's `done` event
 * carries the canonical full text + stop_reason, so we don't have to
 * trust concatenated deltas for correctness.
 */
async function callClaudeRaw<S extends StageName>(
  stage: S,
  options: StageOptionsMap[S],
  ctx?: ClaudeCtx,
): Promise<ClaudeResult> {
  const res = await fetch("/api/pedro/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      stage,
      options,
      // Server enriches the system prompt with prior Pedro outputs +
      // cross-client examples for this stage when clientId is present.
      clientId: ctx?.clientId ?? undefined,
      model: ctx?.model,
      maxTokens: ctx?.maxTokens,
    }),
  });
  // Vercel 504 / gateway errors return HTML, not JSON — guard before parsing
  // so the catch block surfaces a meaningful message instead of "Unexpected
  // token < in JSON".
  if (!res.body) {
    // No stream body at all = gateway/edge swallowed the response. Try
    // to surface whatever error text we can.
    const raw = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200) || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let canonicalText = "";
  let stopReason: string | null = null;
  let pendingError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nlIdx: number;
    while ((nlIdx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nlIdx).trim();
      buffer = buffer.slice(nlIdx + 1);
      if (!line.startsWith("data:")) continue;
      const payloadRaw = line.slice(5).trim();
      if (!payloadRaw) continue;
      let payload: { type?: string; delta?: string; text?: string; stopReason?: string | null; message?: string };
      try {
        payload = JSON.parse(payloadRaw);
      } catch {
        continue;
      }
      if (payload.type === "text" && typeof payload.delta === "string") {
        fullText += payload.delta;
        ctx?.onDelta?.(payload.delta, fullText);
      } else if (payload.type === "done") {
        canonicalText = typeof payload.text === "string" ? payload.text : fullText;
        stopReason = payload.stopReason ?? null;
      } else if (payload.type === "error") {
        pendingError = payload.message ?? "Pedro stream error";
      }
    }
  }

  if (pendingError) throw new Error(pendingError);
  return { text: canonicalText || fullText, stopReason };
}

/**
 * Text-stage Pedro call with automatic truncation retry. When the
 * model hits the maxTokens cap (`stop_reason === "max_tokens"`) we
 * retry once with 2x the cap so the CM doesn't end up with a half-
 * generated LP or Manus prompt. One retry is enough — if 2x still
 * truncates the prompt is unreasonably large and the CM needs to know.
 */
async function callPedro<S extends StageName>(
  stage: S,
  options: StageOptionsMap[S],
  ctx?: ClaudeCtx,
): Promise<string> {
  const first = await callClaudeRaw(stage, options, ctx);
  if (first.stopReason !== "max_tokens") return first.text;
  const baseTokens = ctx?.maxTokens;
  const retryTokens = baseTokens ? baseTokens * 2 : 4000;
  console.warn(`[pedro] truncated on stage ${stage} — retrying at ${retryTokens} tokens`);
  const retry = await callClaudeRaw(stage, options, { ...ctx, maxTokens: retryTokens });
  if (retry.stopReason === "max_tokens") {
    console.warn(`[pedro] still truncated at ${retryTokens} tokens — returning anyway`);
  }
  return retry.text;
}

/**
 * JSON-stage Pedro call with parse-validation + one retry. Catches
 * the classic failure mode where Claude adds a preamble ("Hier is je
 * JSON:") that crashes parseJSON and surfaces as a generic toast.
 *
 * Retry path: we can't append "geef alleen JSON" to the prompt anymore
 * since the server owns prompt construction, so we send a follow-up
 * via the special `_jsonRetry` flag in options. The server-side
 * builders for JSON stages (angles, ad-copy) honour this by appending
 * the strict reminder before sending to Claude. Pragmatic shortcut to
 * keep client-side parsing logic working without dual-mode routes.
 */
async function callPedroJson<T, S extends Extract<StageName, "angles" | "ad-copy">>(
  stage: S,
  options: StageOptionsMap[S],
  ctx?: ClaudeCtx,
): Promise<T> {
  const first = await callPedro(stage, options, ctx);
  try {
    return parseJSON<T>(first);
  } catch (e) {
    console.warn(`[pedro] JSON parse failed on ${stage}, retrying with stricter options:`, e);
    const retryOptions = {
      ...options,
      _jsonRetry: true,
    } as StageOptionsMap[S];
    const retry = await callPedro(stage, retryOptions, ctx);
    return parseJSON<T>(retry);
  }
}

function sanitizeOutput(text: string): string {
  return text
    .replace(/[\u2014\u2013]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

function parseJSON<T>(raw: string): T {
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

// ── Reusable UI pieces ──
function Spinner({ text, sub }: { text: string; sub: string }) {
  return (
    <div className="flex flex-col items-center py-10 gap-2.5">
      <div className="w-7 h-7 border-2 border-border border-t-primary rounded-full animate-[spin_0.7s_linear_infinite]" />
      <div className="text-sm text-muted-foreground">{text}</div>
      <div className="text-xs text-muted-foreground/60">{sub}</div>
    </div>
  );
}

function OutputBlock({ content, expandFull }: { content: string; expandFull?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="bg-muted/40 border border-border rounded-lg p-3.5 pr-11 text-[13px] leading-[1.7] text-foreground whitespace-pre-wrap relative"
      style={{ minHeight: expandFull ? 400 : 70, height: "auto" }}
    >
      <button
        onClick={() => {
          navigator.clipboard.writeText(content);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className={`absolute top-2.5 right-2.5 inline-flex items-center h-6 px-2 text-[10px] font-medium bg-background border border-border rounded-md cursor-pointer transition-colors whitespace-nowrap ${
          copied ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/40" : "text-muted-foreground hover:text-foreground hover:bg-accent"
        }`}
      >
        {copied ? "Gekopieerd" : "Kopieer"}
      </button>
      {content}
    </div>
  );
}

function Card({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-2xl border bg-card p-6 mb-5 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] transition-colors ${
        active ? "border-primary/30 ring-1 ring-primary/20" : "border-border/60"
      }`}
    >
      {children}
    </div>
  );
}

// Standard field label used across the brief form. Matches the
// Settings + Client Info + Billing labels (12px, sentence-case, normal
// weight). Replaces the old 10px uppercase tracking-[0.12em] style
// that made Pedro feel like a different product.
function FieldLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <label className={`text-xs font-medium text-muted-foreground ${className ?? ""}`}>
      {children}
    </label>
  );
}

// ── Brief explainability — types + UI helper ──
// When the auto-brief endpoint fills the form, Pedro tags each field
// with the input it pulled from (kick-off / eval / Trengo / etc.). The
// tag below each field surfaces this so the AM can verify provenance
// without re-reading transcripts.
type FieldSource =
  | "kickoff_meeting"
  | "kickoff_update"
  | "evaluation"
  | "monday_updates"
  | "trengo"
  | "client_metadata"
  | "past_campaign"
  | "inferred"
  | "unknown";

type BriefSources = Partial<Record<keyof BriefData, FieldSource[]>>;

const SOURCE_LABELS: Record<FieldSource, string> = {
  kickoff_meeting: "kick-off meeting",
  kickoff_update: "kick-off update",
  evaluation: "evaluatie",
  monday_updates: "Monday updates",
  trengo: "Trengo berichten",
  client_metadata: "klantgegevens",
  past_campaign: "vorige campagne",
  inferred: "Pedro afgeleid",
  unknown: "?",
};

function SourceTag({ sources }: { sources: FieldSource[] | undefined }) {
  if (!sources || sources.length === 0) return null;
  const label = sources.map((s) => SOURCE_LABELS[s] ?? s).join(" + ");
  return (
    <div
      className="text-[10px] text-muted-foreground/60 mt-1 italic"
      title={`Pedro vulde dit veld op basis van: ${label}`}
    >
      Bron: {label}
    </div>
  );
}

// Shared generation rules + per-stage prompts now live in
// `@/lib/pedro/prompts` — kept here only as a comment-marker for greppers.

// ── Main Component ──
// Sections map to steps internally for backwards compatibility
type SectionName = "brief" | "angles" | "script" | "creatives" | "lp" | "ad-copy";
// Reordered 2026-05-22 (Roy): LP comes BEFORE creatives because LP
// defines the kernboodschap, creatives align headlines to the LP
// hero, and ad copy aligns to both. Earlier order had creatives before
// LP which inverted the dependency.
const SECTION_TO_STEP: Record<SectionName, number> = {
  brief: 1, angles: 2, script: 3, lp: 4, creatives: 5, "ad-copy": 6,
};
const STEP_TO_SECTION: Record<number, SectionName> = {
  1: "brief", 2: "angles", 3: "script", 4: "lp", 5: "creatives", 6: "ad-copy",
};

export function Campaign({
  section,
  setSection,
  clients,
  selectedClientId,
  selectedClientName,
  onSelectClient,
}: {
  section: SectionName
  /** Widened to allow Campaign to navigate out to the Research tab, which
   *  sits between Brief and Angles in the canonical flow. */
  setSection: (s: SectionName | "research") => void
  clients: PedroClient[]
  /** Driven by the global Pedro picker at the top of the page. */
  selectedClientId: string | null
  selectedClientName: string
  /** When the user picks a different client from inside the brief, propagate
   *  to the global picker (still rendered up top). */
  onSelectClient: (clientId: string, clientName: string) => void
}) {
  const step = SECTION_TO_STEP[section] || 1;
  const setStep = (n: number) => setSection(STEP_TO_SECTION[n] || "brief");

  // Step 1: Brief
  const [brief, setBrief] = useState<BriefData>({
    bedrijf: "", sector: "", doel: "", pijn: "", aanbod: "", usps: "", hooksAM: "", hooksExtra: "",
  });
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // Auto-brief state — clientId comes from the parent now (global picker).
  const [autoFilling, setAutoFilling] = useState(false);
  const [autoBriefSource, setAutoBriefSource] = useState<string | null>(null);
  // Per-field provenance from auto-brief — populated when Pedro fills the
  // brief; surfaces as small "Bron: X" tags below each input field.
  const [briefSources, setBriefSources] = useState<BriefSources>({});

  // Website analysis
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [brandStyle, setBrandStyle] = useState<BrandStyle | null>(null);
  const [extractedColors, setExtractedColors] = useState<ExtractedColor[]>([]);
  const [websiteAnalyzing, setWebsiteAnalyzing] = useState(false);
  const [huisstijlOverride, setHuisstijlOverride] = useState(false);

  // Meta style reference (silent background fetch)
  const [metaStyleRef, setMetaStyleRef] = useState("");
  const metaFetched = useRef(false);

  // Step 2: Angles
  const [angles, setAngles] = useState<Angle[]>([]);
  const [selectedAngles, setSelectedAngles] = useState<Angle[]>([]);
  const [anglesLoading, setAnglesLoading] = useState(false);
  // Multi-select regenerate: angle.nummer values the CM has marked
  // for refresh. Separate from selectedAngles (which feeds downstream
  // stages) so the CM can keep an angle selected for use while still
  // asking Pedro to come up with a better wording for it.
  const [regenAngleSet, setRegenAngleSet] = useState<Set<number>>(new Set());
  const [regenAngleSteering, setRegenAngleSteering] = useState("");
  const [regenAnglesLoading, setRegenAnglesLoading] = useState(false);
  // Parallel-mode generation (#5a): fires script (optional) + creatives +
  // lp in parallel, then ad-copy. CM can launch the whole back-half from
  // a single button on the angles save bar instead of stepping through
  // 4 spinners.
  type ParallelStage = "idle" | "running" | "done" | "skipped" | "error";
  const [parallelRunning, setParallelRunning] = useState(false);
  const [parallelProgress, setParallelProgress] = useState<{
    script: ParallelStage;
    creatives: ParallelStage;
    lp: ParallelStage;
    adCopy: ParallelStage;
  }>({ script: "idle", creatives: "idle", lp: "idle", adCopy: "idle" });

  // Client deliverable (#5b): the "Deliverable #1" markdown doc that
  // gets stored against the client. Distinct from the in-memory
  // download flow above — this hits the server, reads the latest
  // saved stage versions, and upserts to pedro_deliverables so the
  // client detail page can show + serve it.
  const [deliverableSaving, setDeliverableSaving] = useState(false);

  // Step 3: Script (optional)
  const [script, setScript] = useState("");
  const [scriptVideos, setScriptVideos] = useState<ScriptVideo[]>([]);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptSkipped, setScriptSkipped] = useState(false);

  // Step 4: Creatives
  const [qty, setQty] = useState(3);
  const [formats, setFormats] = useState<string[]>(["Static 1:1 (1080×1080)"]);
  const [driveLink, setDriveLink] = useState("");
  const [huisstijl, setHuisstijl] = useState("");
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [brandbookName, setBrandbookName] = useState("");
  const [manusPrompt, setManusPrompt] = useState("");
  const [manusLoading, setManusLoading] = useState(false);
  // Optional steering note for creatives regenerate — empty string =
  // standard regenerate. CM uses this to push iterations in a
  // specific direction without rewriting the whole prompt builder.
  const [creativesSteering, setCreativesSteering] = useState("");

  // Step 5: LP
  const [stijl, setStijl] = useState("Urgentie-gedreven");
  const [lengte, setLengte] = useState("Medium - + social proof + USP's");
  const [pixelId, setPixelId] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [utmStr, setUtmStr] = useState("");
  const [lpPrompt, setLpPrompt] = useState("");
  const [lpLoading, setLpLoading] = useState(false);
  const [showLpCard, setShowLpCard] = useState(false);

  // Step 6: Ad copy (last - uses LP context)
  const [adCopy, setAdCopy] = useState<AdCopy | null>(null);
  const [adCopyLoading, setAdCopyLoading] = useState(false);
  const [copyTab, setCopyTab] = useState<"primary" | "headlines" | "desc">("primary");

  // Client database
  const [clientDB, setClientDB] = useState<ClientData | null>(null);
  const [clientDBStatus, setClientDBStatus] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const goTo = (n: number) => {
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateBrief = (field: keyof BriefData, value: string) => {
    setBrief((prev) => ({ ...prev, [field]: value }));
    // Manual edit invalidates the AI source provenance for this field.
    setBriefSources((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  // Per-call context helpers — every prompt builder takes its context
  // as plain strings, so we close over current state here and pass the
  // result in. The builders themselves live in `@/lib/pedro/prompts`.
  const anglesStr = () => anglesString(selectedAngles);
  const scriptCtx = () => buildScriptContext({ script, scriptSkipped });
  const styleRef = () => styleReference(metaStyleRef);
  const huisstijlOpts = () => ({ brandStyle, huisstijl, huisstijlOverride });
  const huisstijlCtx = () => buildHuisstijlContext(huisstijlOpts());
  const huisstijlLpCtx = () => buildHuisstijlForLp(huisstijlOpts());

  // ── Website analysis ──
  async function analyzeWebsite() {
    const url = websiteUrl.trim();
    if (!url) { showToast("Vul een website URL in"); return; }
    setWebsiteAnalyzing(true);
    setBrandStyle(null);
    setExtractedColors([]);
    setHuisstijlOverride(false);
    try {
      const res = await fetch("/api/pedro/analyze-website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        showToast(data.error || "Website analyse mislukt");
      } else {
        setBrandStyle(data.brandStyle);
        setExtractedColors(data.extractedColors || []);
        const bs = data.brandStyle;
        setHuisstijl(`Primary: ${bs.primaryColor}, Secondary: ${bs.secondaryColor}${bs.accentColor ? `, Accent: ${bs.accentColor}` : ""}`);
        showToast("Kleuren geëxtraheerd -- controleer de swatches");
      }
    } catch {
      showToast("Website analyse mislukt - controleer de URL");
    }
    setWebsiteAnalyzing(false);
  }

  // Manual color override from swatch click or input
  function overrideBrandColor(field: "primaryColor" | "secondaryColor" | "accentColor", hex: string) {
    if (!brandStyle) return;
    setBrandStyle({ ...brandStyle, [field]: hex });
    setHuisstijl(`Primary: ${field === "primaryColor" ? hex : brandStyle.primaryColor}, Secondary: ${field === "secondaryColor" ? hex : brandStyle.secondaryColor}`);
  }

  // ── Auto-fetch Meta RL campaigns on mount (silent) ──
  useEffect(() => {
    if (metaFetched.current) return;
    metaFetched.current = true;
    (async () => {
      try {
        const res = await fetch("/api/pedro/meta/campaigns");
        const data = await res.json();
        const ads: MetaAd[] = data.ads || [];
        if (ads.length > 0) {
          // Pick up to 8 diverse ads as style reference
          const sample = ads.slice(0, 8);
          const ref = sample.map((ad, i) =>
            `[Ad ${i + 1}] "${ad.title}" - ${ad.body.substring(0, 250)}`
          ).join("\n");
          setMetaStyleRef(ref);
        }
      } catch {
        // Silent fail - style reference is optional
      }
    })();
  }, []);

  // ── Scroll to top on section change ──
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [section]);

  // ── Hub client coupling: pick a client + load existing state OR AI auto-fill ──
  // Replaces Mike's monday search + kick-off parser. The new flow uses the
  // hub's full context (Monday updates, Fathom transcripts prioritising the
  // most recent evaluation, Trengo) — see /api/pedro/auto-brief.
  //
  // Behaviour: pick a client → load any saved state. If state exists, restore
  // brief/angles/script/etc and DON'T auto-run AI (user can re-trigger via
  // the AI auto-fill button). If no saved state, kick off auto-brief so the
  // AM never starts from a blank canvas.
  // Load any saved state for the active client. Called automatically
  // whenever selectedClientId changes (driven by the global picker).
  //
  // Loading priority (Roy's directive 2026-05-09):
  //   1. Latest SAVED VERSION per stage (pedro_stage_versions) — canonical
  //   2. DRAFT slot (pedro_client_state) — fallback for stages without v1+
  //   3. Auto-brief — only when neither exists for this client
  //
  // Why saved-versions first: a returning AM expects "I saved v1, now
  // I want to continue editing v1". Drafts can be stale, partial, or
  // wiped by experiments — saved versions are the explicit canonical
  // record. Editing then auto-saves to draft until the user explicitly
  // commits a new version (v2, v3, ...).
  const loadClientState = useCallback(async function loadClientState(clientId: string, clientName: string) {
    setAutoBriefSource(null);
    setImportStatus(null);
    setBriefSources({});

    // Fetch draft + saved versions in parallel
    let draftState: Record<string, unknown> | null = null;
    let savedByStage = new Map<string, { version_number: number; data: unknown }>();
    let highestVersion = 0;

    try {
      const [stateRes, versionsRes] = await Promise.all([
        fetch(`/api/pedro/client-state?clientId=${encodeURIComponent(clientId)}`),
        fetch(`/api/pedro/saved-versions?clientId=${encodeURIComponent(clientId)}`),
      ]);
      if (stateRes.ok) {
        const sd = await stateRes.json();
        draftState = sd.state ?? null;
      }
      if (versionsRes.ok) {
        const vd = await versionsRes.json();
        const versions: Array<{ stage: string; version_number: number; data: unknown }> = vd.versions ?? [];
        // Saved-versions API returns ordered by saved_at desc — take first per stage.
        for (const v of versions) {
          if (!savedByStage.has(v.stage)) savedByStage.set(v.stage, { version_number: v.version_number, data: v.data });
          if (v.version_number > highestVersion) highestVersion = v.version_number;
        }
      }
    } catch {
      /* silent — fall through to auto-brief */
    }

    const hasAnything = !!draftState || savedByStage.size > 0;

    if (hasAnything) {
      // Helper: prefer saved-version data, fall back to draft slot.
      const sv = (stage: string) => savedByStage.get(stage)?.data;

      // Brief
      const brief = (sv("brief") ?? draftState?.brief) as Partial<BriefData> | undefined;
      if (brief && typeof brief === "object") {
        setBrief((prev) => ({ ...prev, ...brief }));
      }

      // Angles
      const angles = sv("angles") ?? draftState?.selected_angles;
      if (Array.isArray(angles)) setSelectedAngles(angles as Angle[]);

      // Script — saved version stores { script_text, script_videos }; draft has them as separate columns
      const scriptSaved = sv("script") as { script_text?: string; script_videos?: ScriptVideo[] } | undefined;
      if (scriptSaved) {
        if (typeof scriptSaved.script_text === "string") setScript(scriptSaved.script_text);
        if (Array.isArray(scriptSaved.script_videos)) setScriptVideos(scriptSaved.script_videos);
      } else if (draftState) {
        if (typeof draftState.script_text === "string") setScript(draftState.script_text);
        if (Array.isArray(draftState.script_videos)) setScriptVideos(draftState.script_videos as ScriptVideo[]);
      }

      // Creatives
      const cr = (sv("creatives") as Record<string, unknown> | undefined) ?? (draftState?.creatives as Record<string, unknown> | undefined);
      if (cr) {
        if (typeof cr.qty === "number") setQty(cr.qty);
        if (Array.isArray(cr.formats)) setFormats(cr.formats as string[]);
        if (typeof cr.driveLink === "string") setDriveLink(cr.driveLink);
        if (typeof cr.brandbookName === "string") setBrandbookName(cr.brandbookName);
        if (typeof cr.huisstijl === "string") setHuisstijl(cr.huisstijl);
        if (typeof cr.manusPrompt === "string") setManusPrompt(cr.manusPrompt);
      }

      // LP
      const lp = (sv("lp") as Record<string, unknown> | undefined) ?? (draftState?.lp as Record<string, unknown> | undefined);
      if (lp) {
        if (typeof lp.stijl === "string") setStijl(lp.stijl);
        if (typeof lp.lengte === "string") setLengte(lp.lengte);
        if (typeof lp.pixelId === "string") setPixelId(lp.pixelId);
        if (typeof lp.webhookUrl === "string") setWebhookUrl(lp.webhookUrl);
        if (typeof lp.utmStr === "string") setUtmStr(lp.utmStr);
        if (typeof lp.lpPrompt === "string") setLpPrompt(lp.lpPrompt);
      }

      // Ad copy
      const ac = (sv("ad-copy") as AdCopy | undefined) ?? (draftState?.ad_copy as AdCopy | undefined);
      if (ac) setAdCopy(ac);

      // Brand style — only stored in draft
      if (draftState?.brand_style) setBrandStyle(draftState.brand_style as BrandStyle);
      const meta = draftState?.auto_brief_meta as { source?: string } | undefined;
      if (meta?.source) setAutoBriefSource(meta.source);

      // Status message — different copy depending on whether saved versions
      // exist (canonical) or only a draft (in-progress).
      if (savedByStage.size > 0) {
        const stages = Array.from(savedByStage.keys()).sort();
        setImportStatus(
          `Geladen vanuit opgeslagen versie${highestVersion > 1 ? `s (laatst: v${highestVersion})` : " (v1)"} — bewerk en sla op als nieuwe versie. Stages: ${stages.join(", ")}.`,
        );
        showToast(`Versie ${highestVersion > 1 ? `tot v${highestVersion}` : "v1"} geladen ✓`);
      } else {
        setImportStatus(`Draft van "${clientName}" geladen — sla op als versie zodra je tevreden bent.`);
        showToast(`Draft geladen ✓`);
      }
    } else {
      // Fresh client — Pedro auto-fills the brief from hub context.
      void runAutoBrief(clientId, clientName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch the prop-driven client and reload Campaign state on change.
  // Track the last-loaded id to avoid re-loading on every render.
  const lastLoadedClientRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedClientId) return;
    if (selectedClientId === lastLoadedClientRef.current) return;
    lastLoadedClientRef.current = selectedClientId;
    void loadClientState(selectedClientId, selectedClientName);
  }, [selectedClientId, selectedClientName, loadClientState]);

  // ── Auto-save: debounced 800ms write of every Pedro deliverable to
  // pedro_client_state. Triggered when any of the 6 stages' output changes.
  // Skipped while no client is selected, while auto-fill is running, and
  // on the very first render (so we don't immediately wipe a freshly
  // loaded existing campaign with empty defaults). ──
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const skipNextSaveRef = useRef(true);
  useEffect(() => {
    // Reset the "skip first save" flag whenever a new client is picked.
    skipNextSaveRef.current = true;
  }, [selectedClientId]);

  useEffect(() => {
    if (!selectedClientId) return;
    if (autoFilling) return;
    // First effect run after client-select / auto-fill load is just hydration —
    // skip writing back. Subsequent runs are real edits.
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const payload = {
        clientId: selectedClientId,
        brief,
        selected_angles: selectedAngles,
        script_text: script || null,
        script_videos: scriptVideos,
        creatives: { qty, formats, driveLink, brandbookName, huisstijl, manusPrompt },
        lp: { stijl, lengte, pixelId, webhookUrl, utmStr, lpPrompt },
        ad_copy: adCopy,
        brand_style: brandStyle,
        auto_brief_meta: autoBriefSource ? { source: autoBriefSource } : null,
      };
      fetch("/api/pedro/client-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {
        /* silent — save retries on next state change */
      });
    }, 800);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedClientId,
    autoFilling,
    brief,
    selectedAngles,
    script,
    scriptVideos,
    qty,
    formats,
    driveLink,
    brandbookName,
    huisstijl,
    manusPrompt,
    stijl,
    lengte,
    pixelId,
    webhookUrl,
    utmStr,
    lpPrompt,
    adCopy,
    brandStyle,
    autoBriefSource,
  ]);

  // Save current stage data as a new explicit version, then navigate to
  // the next section. Skips the POST when nothing has changed since the
  // latest existing version (Roy 2026-05-09 — "geen onnodige versies").
  // Tab navigation up top stays as the "navigate without saving" escape
  // hatch.
  async function saveStageAndContinue(args: {
    stage: "brief" | "angles" | "script" | "creatives" | "lp" | "ad-copy";
    data: unknown;
    nextSection: SectionName | "research";
  }) {
    const result = await saveIfChanged({
      clientId: selectedClientId,
      stage: args.stage,
      data: args.data,
    });
    if (result.saved) {
      showToast(`✓ Opgeslagen als v${result.versionNumber}`);
    } else if (result.reason === "unchanged") {
      showToast(`v${result.versionNumber} ongewijzigd — geen nieuwe versie`);
    }
    setSection(args.nextSection);
  }

  async function runAutoBrief(clientId?: string, clientName?: string) {
    const id = clientId ?? selectedClientId;
    const name = clientName ?? selectedClientName;
    if (!id) {
      showToast("Selecteer eerst een klant");
      return;
    }
    setAutoFilling(true);
    setImportStatus(null);
    showToast(`Pedro pakt context van "${name}" erbij…`);
    try {
      const res = await fetch("/api/pedro/auto-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        showToast(data.error || "AI auto-fill mislukt");
        setAutoFilling(false);
        return;
      }
      const b = data.brief as {
        bedrijf: string
        sector: string
        doelgroep: string
        pijnpunten: string
        aanbod: string
        usps: string
        marketingHooks: string
        websiteUrl: string
        driveLink: string
        source: string
        _sources?: Record<string, string[]>
      };
      setBrief((prev) => ({
        ...prev,
        bedrijf: b.bedrijf || prev.bedrijf,
        sector: b.sector || prev.sector,
        doel: b.doelgroep || prev.doel,
        pijn: b.pijnpunten || prev.pijn,
        aanbod: b.aanbod || prev.aanbod,
        usps: b.usps || prev.usps,
        hooksAM: b.marketingHooks || prev.hooksAM,
      }));
      // Map API source-keys → form field-keys, then store. Brief UI
      // renders a small "Bron: X" tag below each field that has sources.
      if (b._sources) {
        const next: BriefSources = {};
        if (b._sources.bedrijf) next.bedrijf = b._sources.bedrijf as FieldSource[];
        if (b._sources.sector) next.sector = b._sources.sector as FieldSource[];
        if (b._sources.doelgroep) next.doel = b._sources.doelgroep as FieldSource[];
        if (b._sources.pijnpunten) next.pijn = b._sources.pijnpunten as FieldSource[];
        if (b._sources.aanbod) next.aanbod = b._sources.aanbod as FieldSource[];
        if (b._sources.usps) next.usps = b._sources.usps as FieldSource[];
        if (b._sources.marketingHooks) next.hooksAM = b._sources.marketingHooks as FieldSource[];
        setBriefSources(next);
      }
      if (b.websiteUrl) setWebsiteUrl(b.websiteUrl);
      if (b.driveLink) setDriveLink(b.driveLink);
      setAutoBriefSource(b.source || "");
      setImportStatus(`Brief auto-gevuld voor "${name}" — controleer en vul aan`);
      showToast("Pedro heeft de brief ingevuld ✓");
    } catch {
      showToast("AI auto-fill mislukt");
    }
    setAutoFilling(false);
  }

  // ── Step 2: Angles ──
  async function doAngles() {
    if (!brief.bedrijf || !brief.aanbod) {
      showToast("Vul minimaal bedrijfsnaam en aanbod in");
      return;
    }
    goTo(2);
    setAnglesLoading(true);
    setAngles([]);
    setSelectedAngles([]);

    // Pull the latest research for this client (saved version preferred,
    // falls back to library entry). Adds branche-specific winning patterns
    // as Claude context — Roy's directive: research feeds angles, niet
    // skippen.
    let researchContext = "";
    if (selectedClientId) {
      try {
        const verRes = await fetch(
          `/api/pedro/saved-versions?clientId=${encodeURIComponent(selectedClientId)}&stage=research`,
        );
        if (verRes.ok) {
          const verData = await verRes.json();
          const latest = (verData.versions ?? [])[0];
          const r = latest?.data?.research;
          if (r) {
            const angles = (r?.insights?.winningAngles ?? []).slice(0, 5);
            const hooks = (r?.insights?.commonHooks ?? []).slice(0, 5);
            researchContext = `\n\nRESEARCH (laatst opgeslagen voor deze klant):\n` +
              (angles.length ? `Winnende angles in deze branche:\n${angles.map((a: string) => `- ${a}`).join("\n")}\n` : "") +
              (hooks.length ? `Hook-patronen die werken:\n${hooks.map((h: string) => `- ${h}`).join("\n")}\n` : "") +
              `\nGebruik deze research als inspiratie — varieer er bovenop, kopieer niet.`;
          }
        }
      } catch {
        /* silent — research is optional context */
      }
    }

    try {
      // Server picks the prompt builder + Haiku default for JSON
      // stages. callPedroJson handles parse-fail retry.
      const parsed = await callPedroJson<Angle[], "angles">(
        "angles",
        {
          brief,
          researchContext,
          styleRef: styleRef(),
          huisstijl: huisstijlCtx(),
        },
        { clientId: selectedClientId }
      );
      setAngles(parsed.map((a) => ({ ...a, titel: sanitizeOutput(a.titel), beschrijving: sanitizeOutput(a.beschrijving) })));
      // Fresh batch — clear any stale regenerate selection.
      setRegenAngleSet(new Set());
      setRegenAngleSteering("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "onbekende fout";
      console.error("doAngles error:", e);
      showToast(`Fout bij genereren angles: ${msg}`);
    }
    setAnglesLoading(false);
  }

  // ── Step 2b: Regenerate selected angles ──
  // CM marks N angles for refresh (separate from "selected for use"),
  // optionally adds a steering note ("maak ze harder confronterend"),
  // and Pedro returns N fresh angles that explicitly avoid the angles
  // the CM kept. We renumber the returned angles to the slots they're
  // replacing so the position-in-list stays stable.
  async function regenerateSelectedAngles() {
    if (regenAngleSet.size === 0 || regenAnglesLoading) return;
    if (regenAngleSet.size === angles.length) {
      // Regenerating ALL is the same as "Nieuwe angles" without keep-context.
      // Fall through to the normal flow for clarity.
      void doAngles();
      return;
    }
    setRegenAnglesLoading(true);
    try {
      const targets = angles.filter((a) => regenAngleSet.has(a.nummer));
      const keep = angles.filter((a) => !regenAngleSet.has(a.nummer));

      const parsed = await callPedroJson<Angle[], "angles">(
        "angles",
        {
          brief,
          styleRef: styleRef(),
          huisstijl: huisstijlCtx(),
          count: targets.length,
          keepAngles: keep,
          steering: regenAngleSteering.trim() || undefined,
        },
        { clientId: selectedClientId }
      );

      // Position-stable replace: parsed[0] swaps into targets[0]'s slot
      // (keeping that slot's `nummer`), etc. If Claude returns fewer
      // items than asked, only the first N slots are replaced.
      const replacementByNummer = new Map<number, Angle>();
      targets.forEach((t, i) => {
        const fresh = parsed[i];
        if (!fresh) return;
        replacementByNummer.set(t.nummer, {
          nummer: t.nummer,
          titel: sanitizeOutput(fresh.titel),
          beschrijving: sanitizeOutput(fresh.beschrijving),
        });
      });
      const next = angles.map((a) => replacementByNummer.get(a.nummer) ?? a);
      setAngles(next);
      // Also refresh selectedAngles so downstream stages see the new
      // wording when the CM had already pre-selected a regenerated one.
      setSelectedAngles((prev) =>
        prev.map((sa) => replacementByNummer.get(sa.nummer) ?? sa),
      );
      setRegenAngleSet(new Set());
      setRegenAngleSteering("");
      showToast(`✓ ${replacementByNummer.size} angle${replacementByNummer.size === 1 ? "" : "s"} geregenereerd`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "onbekende fout";
      console.error("regenerateSelectedAngles error:", e);
      showToast(`Fout bij regenereren angles: ${msg}`);
    }
    setRegenAnglesLoading(false);
  }

  // ── Step 3: Script (uses brief + chosen angle) ──
  const SCRIPT_GUIDELINES = `📋 OPNAMERICHTLIJNEN:
• Neem video staand op: 9:16 of 4:5
• Enthousiast, upbeat en blij overkomen
• Pauzes tussen zinnen - die knippen we eruit
• Goede belichting: natuurlijk licht, groot raam of buiten
• 1-3 seconden extra aan begin en einde van elke clip
• Geen filters, geen logo's op kleding, schone achtergrond
• Bestanden benoemen: Hook 1, Hook 2 etc. in map "Video 1" of "Video 2"`;

  async function doScript(opts?: { skipNav?: boolean }) {
    if (!opts?.skipNav) goTo(3);
    setScriptLoading(true);
    setScript("");
    setScriptSkipped(false);
    try {
      // onDelta streams the script into the textarea live so the CM
      // sees video 1/2/3 appear as Claude writes them, instead of a
      // 30-60s spinner. parseScriptText runs once at the end on the
      // canonical full text.
      const res = sanitizeOutput(await callPedro(
        "script",
        {
          brief,
          anglesStr: anglesStr(),
          styleRef: styleRef(),
          huisstijl: huisstijlCtx(),
        },
        {
          clientId: selectedClientId,
          onDelta: (_d, full) => setScript(sanitizeOutput(full)),
        }
      ));
      setScript(res);
      setScriptVideos(parseScriptText(res));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Pedro script failed:", e);
      showToast(`Fout bij genereren script: ${msg}`);
    }
    setScriptLoading(false);
  }

  function skipScript() {
    setScriptSkipped(true);
    setScript("");
    setScriptVideos([]);
    goTo(4);
  }

  function updateVideoField(videoIdx: number, field: keyof ScriptVideo, value: string | string[]) {
    setScriptVideos((prev) => prev.map((v, i) => i === videoIdx ? { ...v, [field]: value } : v));
  }

  function updateHook(videoIdx: number, hookIdx: number, value: string) {
    setScriptVideos((prev) =>
      prev.map((v, i) =>
        i === videoIdx ? { ...v, hooks: v.hooks.map((h, j) => (j === hookIdx ? value : h)) } : v
      )
    );
  }

  async function downloadScriptDocx() {
    if (scriptVideos.length === 0) return;
    try {
      const blob = await generateScriptDocx(scriptVideos, brief.bedrijf || "Client");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const slug = brief.bedrijf.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
      a.download = `scripts-${slug || "campaign"}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Scripts gedownload als .docx ✓");
    } catch {
      showToast("Fout bij genereren .docx");
    }
  }

  // ── Step 4: Creatives (uses brief + angle + script if not skipped) ──
  // Master prompt + per-creative description prompt live in
  // `@/lib/pedro/prompts/build-creatives`.

  async function doCreative(_opts?: { skipNav?: boolean }) {
    // doCreative doesn't navigate by default (creatives is step 4 and
    // the CM stays on that step) — opts is accepted for symmetry with
    // the other handlers and future-proofing parallel mode.
    setManusLoading(true);
    setManusPrompt("");
    try {
      // Section 1: The filled master prompt (static, no AI needed)
      const masterPrompt = buildCreativesMasterPrompt({
        brief,
        anglesStr: anglesStr(),
        qty,
        formats,
        driveLink,
        brandStyle,
        huisstijl,
        previousManusRef: previousManusReference(clientDB),
      });

      // Streaming prefix — master prompt + divider + heading. As
      // Claude's creative descriptions stream in we keep prepending
      // this prefix so the CM sees the full Manus brief assembling
      // top-to-bottom. The warning block + final assembly run once at
      // the end.
      const streamPrefix = `${masterPrompt}\n\n---\n\n## CREATIVES VOOR DEZE CAMPAGNE\n\n`;

      // Section 2: Ask Claude to generate only the creative descriptions.
      // Server defaults to 4000 max tokens for the creatives stage — at
      // qty=5+ the creatives section used to cut off mid-creative.
      // callPedro's auto-retry at 8000 covers qty=10 worst-case.
      // creativesSteering, when set, is layered on top of the standard
      // prompt — used to iterate ("alle creatives in pattern-interrupt
      // variant F", "minder generieke headlines, meer concrete cijfers").
      // lpContext makes headlines + CTA align to the LP hero — LP now
      // runs BEFORE creatives in the pipeline (Roy 2026-05-22).
      const creativeDescriptions = sanitizeOutput(await callPedro(
        "creatives",
        {
          brief,
          anglesStr: anglesStr(),
          qty,
          formats,
          driveLink,
          brandStyle,
          scriptContext: scriptCtx(),
          lpContext: lpPrompt || undefined,
          previousManusRef: previousManusReference(clientDB),
          steering: creativesSteering.trim() || undefined,
        },
        {
          clientId: selectedClientId,
          onDelta: (_d, full) => setManusPrompt(streamPrefix + sanitizeOutput(full)),
        }
      ));

      // Pre-validate: check for common issues before showing
      const warnings: string[] = [];
      if (/\$\d/.test(creativeDescriptions)) warnings.push("WAARSCHUWING: $ valuta gevonden -- verander naar €");
      if (/\b(click here|read more|learn more)\b/i.test(creativeDescriptions)) warnings.push("WAARSCHUWING: Engelse CTA tekst gevonden");
      const headlineMatches = Array.from(creativeDescriptions.matchAll(/\*\*Headline:\*\*\s*"([^"]+)"/g));
      for (const m of headlineMatches) {
        const lines = m[1].split(/\\n|\n/);
        for (const line of lines) {
          if (line.trim().split(/\s+/).length > 8) warnings.push(`WAARSCHUWING: Headline regel >8 woorden: "${line.trim()}"`);
        }
      }
      const warningBlock = warnings.length > 0 ? `\n\n⚠️ PRE-VALIDATIE:\n${warnings.join("\n")}\n` : "";

      // Combine: Section 1 (master prompt) + divider + Section 2 (creatives)
      const fullOutput = `${masterPrompt}

---

## CREATIVES VOOR DEZE CAMPAGNE
${warningBlock}
${creativeDescriptions}`;

      setManusPrompt(fullOutput);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Pedro creative prompt failed:", e);
      showToast(`Fout bij genereren creative prompt: ${msg}`);
    }
    setManusLoading(false);
  }

  // ── Step 5: LP (uses brief + angle + script if not skipped) ──
  async function doLP(_opts?: { skipNav?: boolean }) {
    setShowLpCard(true);
    setLpLoading(true);
    setLpPrompt("");
    try {
      // Server defaults to 2500 max tokens for LP — was 1200, long
      // Lovable prompts with social proof + form + FAQ were truncating
      // silently. callPedro auto-retries at 5000 if that still hits.
      // onDelta streams the Lovable prompt into the output box so the
      // CM can start reading the hero copy before the form spec lands.
      const res = sanitizeOutput(await callPedro(
        "lp",
        {
          brief,
          selectedAngles,
          anglesStr: anglesStr(),
          scriptContext: scriptCtx(),
          styleRef: styleRef(),
          huisstijl: huisstijlLpCtx(),
          stijl,
          lengte,
          pixelId,
          webhookUrl,
          utmStr,
        },
        {
          clientId: selectedClientId,
          onDelta: (_d, full) => setLpPrompt(sanitizeOutput(full)),
        }
      ));
      setLpPrompt(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Pedro LP prompt failed:", e);
      showToast(`Fout bij genereren LP prompt: ${msg}`);
    }
    setLpLoading(false);
  }

  // ── Step 6: Ad copy (uses brief + angle + script + LP headline/CTA) ──
  async function doAdCopy(opts?: { skipNav?: boolean }) {
    // Save the LP draft as a new version on the way to ad-copy — only
    // when the LP changed since the last save. Skip-when-unchanged is
    // shared with every other Pedro save (saveIfChanged helper). In
    // parallel mode we keep this save running because LP just finished
    // and needs to be on disk before ad-copy ships.
    if (selectedClientId && lpPrompt) {
      const r = await saveIfChanged({
        clientId: selectedClientId,
        stage: "lp",
        data: { stijl, lengte, pixelId, webhookUrl, utmStr, lpPrompt },
      });
      if (!opts?.skipNav) {
        if (r.saved) showToast(`✓ LP opgeslagen als v${r.versionNumber}`);
        else if (r.reason === "unchanged") showToast(`LP v${r.versionNumber} ongewijzigd`);
      }
    }

    if (!opts?.skipNav) goTo(6);
    setAdCopyLoading(true);
    setAdCopy(null);
    setCopyTab("primary");
    try {
      // Server defaults to Haiku + 1200 max_tokens for ad-copy. Text
      // fields post-sanitized after parse so smart quotes from Claude
      // don't leak into Meta copy. creativesContext makes the copy
      // align to the visual headlines/CTA of the Manus prompt — Roy
      // 2026-05-22: ad copy should match BOTH LP en creatives, not LP only.
      const parsed = await callPedroJson<AdCopy, "ad-copy">(
        "ad-copy",
        {
          brief,
          anglesStr: anglesStr(),
          scriptContext: scriptCtx(),
          lpPrompt,
          creativesContext: manusPrompt || undefined,
          styleRef: styleRef(),
          huisstijl: huisstijlCtx(),
        },
        { clientId: selectedClientId }
      );
      setAdCopy({
        variantA: sanitizeOutput(parsed.variantA),
        variantB: sanitizeOutput(parsed.variantB),
        headlines: sanitizeOutput(parsed.headlines),
        beschrijving: sanitizeOutput(parsed.beschrijving),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Pedro ad copy failed:", e);
      showToast(`Fout bij genereren ad copy: ${msg}`);
    }
    setAdCopyLoading(false);
  }

  // ── Sequential: fire the deliverables one after another ──
  // After the 2026-05-22 reorder (LP before Creatives), every
  // deliverable now depends on the previous one's output:
  //   Script (optional, await) → LP (await) → Creatives (await) → Ad copy
  // No true parallelism is possible anymore because each stage feeds the
  // next. Streaming masks the wall-clock cost — each stage's text
  // appears progressively in its own tab. parallelProgress still tracks
  // per-stage status so the CM sees what's in flight.
  async function generateAllRestParallel() {
    if (parallelRunning) return;
    if (selectedAngles.length === 0) {
      showToast("Selecteer eerst ≥1 angle");
      return;
    }
    setParallelRunning(true);
    setParallelProgress({
      script: scriptSkipped ? "skipped" : "running",
      lp: "idle",
      creatives: "idle",
      adCopy: "idle",
    });

    // 1. Script first (if not skipped) so its context flows into LP + creatives.
    if (!scriptSkipped) {
      try {
        await doScript({ skipNav: true });
        setParallelProgress((p) => ({ ...p, script: "done" }));
      } catch (e) {
        console.error("[pedro:sequence] script failed", e);
        setParallelProgress((p) => ({ ...p, script: "error" }));
        // Continue anyway — LP can run without script context.
      }
    }

    // 2. LP — feeds creatives + ad copy.
    setParallelProgress((p) => ({ ...p, lp: "running" }));
    try {
      await doLP({ skipNav: true });
      setParallelProgress((p) => ({ ...p, lp: "done" }));
    } catch (e) {
      console.error("[pedro:sequence] lp failed", e);
      setParallelProgress((p) => ({ ...p, lp: "error" }));
    }

    // 3. Creatives — uses LP context (headlines align to LP hero).
    setParallelProgress((p) => ({ ...p, creatives: "running" }));
    try {
      await doCreative({ skipNav: true });
      setParallelProgress((p) => ({ ...p, creatives: "done" }));
    } catch (e) {
      console.error("[pedro:sequence] creatives failed", e);
      setParallelProgress((p) => ({ ...p, creatives: "error" }));
    }

    // 4. Ad copy — uses LP + creatives context.
    setParallelProgress((p) => ({ ...p, adCopy: "running" }));
    try {
      await doAdCopy({ skipNav: true });
      setParallelProgress((p) => ({ ...p, adCopy: "done" }));
    } catch (e) {
      console.error("[pedro:sequence] ad-copy failed", e);
      setParallelProgress((p) => ({ ...p, adCopy: "error" }));
    }

    setParallelRunning(false);
    showToast("✓ Alle deliverables gegenereerd");
    // Navigate to ad-copy step so the CM lands on the final output.
    goTo(6);
    // Auto-save deliverable so the parallel "one click" path produces
    // an end-to-end artifact. Fire-and-forget; the manual button on
    // the ad-copy step lets the CM re-save after any edits.
    if (selectedClientId) {
      void saveClientDeliverable();
    }
  }

  // Bake the saved-versions of every stage into a single deliverable
  // markdown and store it as the client's canonical Pedro deliverable.
  // Distinct from generateAndDownloadClientMD (local snapshot only) —
  // this persists server-side so the client detail page can show + serve it.
  async function saveClientDeliverable() {
    if (!selectedClientId) {
      showToast("Geen klant geselecteerd");
      return;
    }
    if (deliverableSaving) return;
    setDeliverableSaving(true);
    try {
      const res = await fetch("/api/pedro/deliverable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClientId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      showToast("✓ Client deliverable opgeslagen");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[pedro] saveClientDeliverable failed", e);
      showToast(`Fout bij opslaan deliverable: ${msg}`);
    }
    setDeliverableSaving(false);
  }

  // ── Reset ──
  function resetAll() {
    setBrief({ bedrijf: "", sector: "", doel: "", pijn: "", aanbod: "", usps: "", hooksAM: "", hooksExtra: "" });
    // Note: clientId is owned by PedroApp; resetting Campaign doesn't clear it.
    setAutoFilling(false); setAutoBriefSource(null); setImportStatus(null);
    setWebsiteUrl(""); setBrandStyle(null); setWebsiteAnalyzing(false); setHuisstijlOverride(false);
    setAngles([]); setSelectedAngles([]);
    setScript(""); setScriptVideos([]); setScriptSkipped(false);
    setAdCopy(null);
    setQty(3); setFormats(["Static 1:1 (1080×1080)"]); setDriveLink(""); setHuisstijl(""); setUploadedImages([]); setBrandbookName(""); setManusPrompt("");
    setPixelId(""); setWebhookUrl(""); setUtmStr(""); setStijl("Urgentie-gedreven"); setLengte("Medium - + social proof + USP's"); setLpPrompt(""); setShowLpCard(false);
    setClientDB(null); setClientDBStatus(null);
    goTo(1);
    showToast("Nieuwe campagne gestart");
  }

  // ── Client database: load from MD file ──
  function handleLoadClientMD(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const md = ev.target?.result as string;
      const parsed = parseClientMD(md);
      if (!parsed || !parsed.name) {
        showToast("Ongeldig client MD bestand");
        return;
      }
      setClientDB(parsed);
      // Auto-fill brief from latest campaign + base data
      const lastCamp = parsed.campaigns[parsed.campaigns.length - 1];
      setBrief({
        bedrijf: parsed.name,
        sector: parsed.sector || "",
        doel: parsed.doelgroep || "",
        pijn: parsed.pijnpunten || "",
        aanbod: parsed.aanbod || "",
        usps: parsed.usps || "",
        hooksAM: lastCamp?.hooksAM || "",
        hooksExtra: lastCamp?.hooksExtra || "",
      });
      if (parsed.website && parsed.website !== "-") setWebsiteUrl(parsed.website);
      if (parsed.drive && parsed.drive !== "-") setDriveLink(parsed.drive);
      if (parsed.primaryColor && parsed.primaryColor !== "-") {
        setBrandStyle({
          primaryColor: parsed.primaryColor,
          secondaryColor: parsed.secondaryColor || "",
          tone: parsed.tone || "",
          industry: parsed.sector || "",
          brandKeywords: "",
          visualStyle: parsed.visualStyle || "",
        });
      }
      if (parsed.brandbook && parsed.brandbook !== "nee" && parsed.brandbook !== "-") {
        setBrandbookName(parsed.brandbook);
      }
      const campNum = parsed.campaigns.length;
      setClientDBStatus(`Data geladen uit campagne ${campNum} -- ${lastCamp?.date || parsed.lastUpdate}`);
      showToast(`Klantdata geladen -- ${parsed.name} (${campNum} campagne${campNum !== 1 ? "s" : ""})`);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // ── Client database: generate & download MD ──
  function generateAndDownloadClientMD() {
    const today = new Date().toISOString().split("T")[0];
    const bs = brandStyle;

    // Build current campaign data
    const currentCampaign: ClientCampaign = {
      number: (clientDB?.campaigns.length || 0) + 1,
      date: today,
      angle: selectedAngles.map((a) => a.titel).join(", "),
      angleDescription: selectedAngles.map((a) => a.beschrijving).join(" | "),
      hooksAM: brief.hooksAM,
      hooksExtra: brief.hooksExtra,
      scriptSummary: script ? script.split("\n").slice(0, 2).join("\n") : "-",
      creativesQty: qty,
      creativesFormats: formats.join(", "),
      manusPrompt: manusPrompt || "-",
      lpStijl: stijl,
      lpLengte: lengte,
      pixelId: pixelId || "-",
      webhookUrl: webhookUrl || "-",
      utmStr: utmStr || "utm_source=meta&utm_medium=paid",
      adCopyA: adCopy?.variantA ? adCopy.variantA.split(/\s+/).slice(0, 50).join(" ") + "..." : "-",
      adCopyB: adCopy?.variantB ? adCopy.variantB.split(/\s+/).slice(0, 50).join(" ") + "..." : "-",
    };

    // Build full client data
    const data: ClientData = clientDB
      ? {
          ...clientDB,
          lastUpdate: today,
          website: websiteUrl || clientDB.website,
          sector: brief.sector || clientDB.sector,
          drive: driveLink || clientDB.drive,
          primaryColor: bs?.primaryColor || clientDB.primaryColor,
          secondaryColor: bs?.secondaryColor || clientDB.secondaryColor,
          tone: bs?.tone || clientDB.tone,
          visualStyle: bs?.visualStyle || clientDB.visualStyle,
          brandbook: brandbookName || clientDB.brandbook,
          doelgroep: brief.doel || clientDB.doelgroep,
          pijnpunten: brief.pijn || clientDB.pijnpunten,
          aanbod: brief.aanbod || clientDB.aanbod,
          usps: brief.usps || clientDB.usps,
          campaigns: [...clientDB.campaigns, currentCampaign],
        }
      : {
          name: brief.bedrijf,
          created: today,
          lastUpdate: today,
          website: websiteUrl || "-",
          sector: brief.sector || "-",
          drive: driveLink || "-",
          primaryColor: bs?.primaryColor || "-",
          secondaryColor: bs?.secondaryColor || "-",
          tone: bs?.tone || "-",
          visualStyle: bs?.visualStyle || "-",
          brandbook: brandbookName || "nee",
          doelgroep: brief.doel || "-",
          pijnpunten: brief.pijn || "-",
          aanbod: brief.aanbod || "-",
          usps: brief.usps || "-",
          campaigns: [currentCampaign],
        };

    const md = buildClientMD(data);
    const slug = clientSlug(brief.bedrijf);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setClientDB(data);
    showToast(`Client database bijgewerkt -- ${brief.bedrijf}.md`);
  }

  // ── Brand MD generation ──
  function generateBrandMD(): string {
    const date = new Date().toISOString().split("T")[0];
    const anglesUsed = selectedAngles.map((a) => a.titel).join(", ");
    const hooks = brief.hooksExtra || brief.hooksAM || "-";
    const bs = brandStyle;
    return `# ${brief.bedrijf} - Brand Reference
**Aangemaakt:** ${date}
**Website:** ${websiteUrl || "-"}
**Sector:** ${brief.sector || bs?.industry || "-"}

## Branding
- Primary color: ${bs?.primaryColor || "-"}
- Secondary color: ${bs?.secondaryColor || "-"}
- Tone: ${bs?.tone || "-"}
- Visual style: ${bs?.visualStyle || "-"}
- Brand keywords: ${bs?.brandKeywords || "-"}

## Campagne info
- Drive link: ${driveLink || "-"}
- Brandbook: ${brandbookName || "-"}
- Gebruikte angles: ${anglesUsed || "-"}
- Hooks: ${hooks}
`;
  }

  function downloadBrandMD() {
    const md = generateBrandMD();
    const slug = brief.bedrijf.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-brand.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Brand file gedownload ✓");
  }

  const allFormats = [
    "Static 1:1 (1080×1080)",
    "Static 4:5 (1080×1350)",
    "Story 9:16 (1080×1920)",
    "Carousel eerste slide",
  ];
  const stijlOptions = ["Urgentie-gedreven", "Bold & direct", "Professioneel", "Minimalistisch"];
  const lengteOptions = ["Short - hero + CTA", "Medium - + social proof + USP's", "Long - + FAQ + bezwaren"];

  return (
    <div className="max-w-[1060px]">
      {/* ── STEP 1: Brief ── */}
      {step === 1 && (
        <>
        <StageActionBar
          clientId={selectedClientId}
          stage="brief"
          getCurrentData={() => brief}
          busy={autoFilling}
        />
        <Card active>
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="font-heading font-semibold text-base tracking-tight">Client brief</div>
              <div className="text-xs text-muted-foreground mt-[3px]">Importeer uit monday of vul handmatig in</div>
            </div>
          </div>

          {/* Auto-fill draait automatisch bij client-select (zie
              loadClientState). Manual button is dus weggevallen — sticky
              picker is bovenin Pedro, brief vult zichzelf in. Loading
              state hieronder geeft progress. */}
          {autoFilling && (
            <div className="flex items-center gap-2 mt-3 px-1">
              <div className="w-4 h-4 border-2 border-border border-t-primary rounded-full animate-[spin_0.7s_linear_infinite]" />
              <span className="text-xs text-muted-foreground">
                Pedro verzamelt Monday updates, evaluatie meetings en Trengo context…
              </span>
            </div>
          )}

          {importStatus && !autoFilling && (
            <div className="flex items-start gap-2 mt-3 px-3 py-2 bg-emerald-500/5 border border-emerald-500/20 rounded-md text-xs text-emerald-700 dark:text-emerald-400">
              <span aria-hidden>✓</span>
              <div className="flex-1">
                <div>{importStatus}</div>
                {autoBriefSource && (
                  <div className="text-muted-foreground mt-0.5">{autoBriefSource}</div>
                )}
              </div>
            </div>
          )}

          {/* Optional: load a previously-saved client .md file (legacy flow) */}
          <div className="mt-3">
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
              <input type="file" accept=".md" className="hidden" onChange={handleLoadClientMD} />
              <span>↑ Laad eerdere campagne uit .md bestand</span>
            </label>
            {clientDBStatus && (
              <div className="text-xs text-muted-foreground mt-1.5">
                {clientDBStatus}
                {clientDB && <span className="ml-2 text-muted-foreground/60">({clientDB.campaigns.length} eerdere campagne(s))</span>}
              </div>
            )}
          </div>

          <div className="my-4 border-t border-border/60" />

          {/* Website analysis */}
          <div className="flex gap-2 mb-3 mt-3">
            <input
              type="text"
              className="flex-1"
              placeholder="Website klant (bv. www.bedrijfsnaam.nl)"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && analyzeWebsite()}
            />
            <button
              className="pedro-btn-ghost whitespace-nowrap shrink-0"
              onClick={analyzeWebsite}
              disabled={websiteAnalyzing}
            >
              {websiteAnalyzing ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-[1.5px] border-border/60 border-t-purple rounded-full animate-[spin_0.7s_linear_infinite] inline-block" />
                  Analyseren...
                </span>
              ) : "🔍 Analyseer website"}
            </button>
          </div>

          {/* Brand colors result -- editable swatches */}
          {brandStyle && (
            <div className="bg-muted/30 border border-border/60 rounded-lg px-4 py-3 mb-3">
              <div className="flex items-center justify-between mb-2.5">
                <div className="text-xs font-medium text-muted-foreground">Brand kleuren · klik om te wijzigen</div>
              </div>

              {/* Active brand colors (editable) */}
              <div className="flex gap-4 mb-3">
                {(["primaryColor", "secondaryColor", "accentColor"] as const).map((field) => {
                  const color = brandStyle[field];
                  if (!color) return null;
                  const label = field === "primaryColor" ? "Primary (CTA)" : field === "secondaryColor" ? "Secondary" : "Accent";
                  return (
                    <div key={field} className="flex flex-col items-center gap-1.5">
                      <label className="relative cursor-pointer group">
                        <div
                          className="w-11 h-11 rounded-lg border border-border group-hover:border-primary transition-colors shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)]"
                          style={{ background: color }}
                        />
                        <input
                          type="color"
                          value={color}
                          onChange={(e) => overrideBrandColor(field, e.target.value)}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                      </label>
                      <span className="text-[10px] text-muted-foreground">{label}</span>
                      <input
                        type="text"
                        value={color}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (/^#[0-9a-fA-F]{6}$/.test(v)) overrideBrandColor(field, v);
                        }}
                        className="!w-[78px] !h-7 !text-[11px] !px-1.5 !py-0 text-center !bg-card !border-border"
                      />
                    </div>
                  );
                })}
              </div>

              {/* All extracted colors (click to set as primary/secondary) */}
              {extractedColors.length > 0 && (
                <div>
                  <div className="text-[9px] text-muted-foreground/60 uppercase tracking-[0.5px] mb-1.5">
                    Gevonden kleuren (klik = primary, shift+klik = secondary)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {extractedColors.map((c, i) => (
                      <button
                        key={i}
                        className="relative group cursor-pointer bg-transparent border-none p-0"
                        title={`${c.hex} (${c.source}, score: ${c.score})`}
                        onClick={(e) => {
                          if (e.shiftKey) overrideBrandColor("secondaryColor", c.hex);
                          else overrideBrandColor("primaryColor", c.hex);
                        }}
                      >
                        <div
                          className={`w-7 h-7 rounded border-2 transition-all ${
                            c.hex === brandStyle.primaryColor ? "border-emerald-500/40 scale-110" :
                            c.hex === brandStyle.secondaryColor ? "border-primary scale-110" :
                            "border-border/60 group-hover:border-muted-foreground/40"
                          }`}
                          style={{ background: c.hex }}
                        />
                        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[7px] text-muted-foreground/60 opacity-0 group-hover:opacity-100 whitespace-nowrap transition-opacity">
                          {c.score}pt
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="h-px bg-border" />

          {/* Form fields */}
          <div className="grid grid-cols-2 gap-[0.875rem] mt-4">
            <div className="flex flex-col gap-[5px]">
              <label className="text-xs font-medium text-muted-foreground">Bedrijfsnaam</label>
              <input type="text" placeholder="bv. GJJ Riooltechniek BV" value={brief.bedrijf} onChange={(e) => updateBrief("bedrijf", e.target.value)} />
              <SourceTag sources={briefSources.bedrijf} />
            </div>
            <div className="flex flex-col gap-[5px]">
              <label className="text-xs font-medium text-muted-foreground">Sector</label>
              <input type="text" placeholder="bv. Loodgieter / riool" value={brief.sector} onChange={(e) => updateBrief("sector", e.target.value)} />
              <SourceTag sources={briefSources.sector} />
            </div>
            <div className="flex flex-col gap-[5px]">
              <label className="text-xs font-medium text-muted-foreground">Doelgroep</label>
              <textarea style={{ minHeight: 80 }} placeholder="bv. B2C huiseigenaren NL, 30+, spaargeld" value={brief.doel} onChange={(e) => updateBrief("doel", e.target.value)} />
              <SourceTag sources={briefSources.doel} />
            </div>
            <div className="flex flex-col gap-[5px]">
              <label className="text-xs font-medium text-muted-foreground">Pijnpunt</label>
              <textarea style={{ minHeight: 80 }} placeholder="bv. Verstopte afvoer, dure loodgieter" value={brief.pijn} onChange={(e) => updateBrief("pijn", e.target.value)} />
              <SourceTag sources={briefSources.pijn} />
            </div>
            <div className="flex flex-col gap-[5px] col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Aanbod / dienst</label>
              <textarea placeholder="Beschrijf het aanbod, tarieven en werkwijze..." value={brief.aanbod} onChange={(e) => updateBrief("aanbod", e.target.value)} />
              <SourceTag sources={briefSources.aanbod} />
            </div>
            <div className="flex flex-col gap-[5px]">
              <label className="text-xs font-medium text-muted-foreground">USP&apos;s</label>
              <textarea style={{ minHeight: 100 }} placeholder={"- Binnen 60 min op locatie\n- 24/7 bereikbaar\n- Vaste prijzen"} value={brief.usps} onChange={(e) => updateBrief("usps", e.target.value)} />
              <SourceTag sources={briefSources.usps} />
            </div>
            <div className="flex flex-col gap-[5px]">
              <label className="text-xs font-medium text-muted-foreground">Marketing hooks (account manager)</label>
              <textarea style={{ minHeight: 100 }} placeholder="Hooks vanuit kick-off update..." value={brief.hooksAM} onChange={(e) => updateBrief("hooksAM", e.target.value)} />
              <SourceTag sources={briefSources.hooksAM} />
            </div>
            <div className="flex flex-col gap-[5px] col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Extra hooks - campaign manager</label>
              <textarea style={{ minHeight: 100 }} placeholder="Jouw eigen invalshoeken en aanvullingen op de kick-off..." value={brief.hooksExtra} onChange={(e) => updateBrief("hooksExtra", e.target.value)} />
              <div className="text-[10.5px] text-primary mt-[3px] opacity-85">
                → Pedro prioriteert deze hooks als extra laag bovenop de kick-off
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-[1.125rem] border-t border-border/60 mt-[1.125rem]">
            <div className="text-xs text-muted-foreground">Stap 1 van 6</div>
            <button
              className="pedro-btn-primary"
              onClick={() =>
                saveStageAndContinue({ stage: "brief", data: brief, nextSection: "research" })
              }
              disabled={!brief.bedrijf || !brief.aanbod}
              title={!brief.bedrijf || !brief.aanbod ? "Vul minimaal bedrijfsnaam en aanbod in" : undefined}
            >
              Opslaan &amp; naar research →
            </button>
          </div>
        </Card>
        </>
      )}

      {/* ── STEP 2: Angles ── */}
      {step === 2 && (
        <>
        <StageActionBar
          clientId={selectedClientId}
          stage="angles"
          getCurrentData={() => selectedAngles}
          busy={anglesLoading}
        />
        <Card active>
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="font-heading font-semibold text-base tracking-tight">Marketing angles</div>
              <div className="text-xs text-muted-foreground mt-[3px]">Selecteer 1 of meerdere angles om mee te testen</div>
            </div>
            <button className="pedro-btn-ghost text-[11px]" onClick={() => goTo(1)}>← Terug</button>
          </div>

          {anglesLoading ? (
            <Spinner text="Pedro analyseert brief + research..." sub="Marketing angles worden gegenereerd" />
          ) : angles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <p className="text-sm text-muted-foreground max-w-md">
                Pedro genereert 5 marketing angles op basis van de brief en (indien beschikbaar) de meest recente research voor deze klant.
              </p>
              <button
                className="pedro-btn-primary"
                onClick={doAngles}
                disabled={!brief.bedrijf || !brief.aanbod}
              >
                Pedro, genereer angles →
              </button>
            </div>
          ) : (
            <>
              <div className="text-[11px] text-muted-foreground mb-2">
                Klik op een kaart om te selecteren voor de volgende stages (ideaal 3-5). Klik op het ↻ icoontje om een angle te markeren voor regeneratie.
              </div>
              <div className="flex flex-col gap-[0.7rem]">
                {angles.map((a) => {
                  const isSelected = selectedAngles.some((s) => s.nummer === a.nummer);
                  const idx = selectedAngles.findIndex((s) => s.nummer === a.nummer);
                  const markedForRegen = regenAngleSet.has(a.nummer);
                  return (
                    <div
                      key={a.nummer}
                      onClick={() => {
                        setSelectedAngles((prev) =>
                          isSelected ? prev.filter((s) => s.nummer !== a.nummer) : prev.length >= 5 ? prev : [...prev, a]
                        );
                      }}
                      className={`bg-muted/40 border rounded-lg p-[0.875rem_1rem] cursor-pointer transition-all relative ${
                        isSelected ? "border-primary bg-primary/10" : "border-border/60 hover:border-[rgba(255,255,255,0.14)]"
                      } ${markedForRegen ? "ring-1 ring-amber-500/50" : ""}`}
                    >
                      <div className="absolute top-[0.875rem] right-[0.875rem] flex items-center gap-1.5">
                        {/* Regen toggle — separate from the select state so
                            the CM can pre-select an angle for use AND mark
                            it for a wording-refresh in the same gesture. */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRegenAngleSet((prev) => {
                              const next = new Set(prev);
                              if (next.has(a.nummer)) next.delete(a.nummer);
                              else next.add(a.nummer);
                              return next;
                            });
                          }}
                          title={markedForRegen ? "Niet regenereren" : "Markeer voor regenereren"}
                          className={`h-[18px] w-[18px] rounded-[4px] border-[1.5px] flex items-center justify-center text-[10px] leading-none transition-all ${
                            markedForRegen
                              ? "bg-amber-500/15 border-amber-500 text-amber-600 dark:text-amber-400"
                              : "border-border/60 text-muted-foreground/60 hover:border-amber-500/60 hover:text-amber-500"
                          }`}
                        >
                          ↻
                        </button>
                        <div
                          className={`w-[18px] h-[18px] rounded-[4px] border-[1.5px] flex items-center justify-center text-[9px] font-bold transition-all ${
                            isSelected ? "bg-primary border-primary text-white" : "border-border/60"
                          }`}
                        >
                          {isSelected ? idx + 1 : ""}
                        </div>
                      </div>
                      <div className="text-[9.5px] uppercase tracking-[1px] text-primary font-semibold mb-1">Angle {a.nummer}</div>
                      <div className="font-heading font-bold text-sm tracking-tight mb-1 pr-16">{a.titel}</div>
                      <div className="text-xs text-muted-foreground leading-[1.55]">{a.beschrijving}</div>
                    </div>
                  );
                })}
              </div>

              {/* Regenerate-selected panel — only renders when ≥1 marked. */}
              {regenAngleSet.size > 0 && (
                <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                  <div className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                    {regenAngleSet.size} angle{regenAngleSet.size === 1 ? "" : "s"} gemarkeerd voor regeneratie
                  </div>
                  <textarea
                    value={regenAngleSteering}
                    onChange={(e) => setRegenAngleSteering(e.target.value)}
                    placeholder="Optionele steering: bv. 'maak ze harder confronterend', 'meer richting AI', 'minder cliché' — laat leeg om Pedro vrij te laten"
                    rows={2}
                    className="w-full text-[11px] rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5 leading-snug resize-none placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      className="pedro-btn-primary text-[11px] h-7 px-3 disabled:opacity-50"
                      disabled={regenAnglesLoading}
                      onClick={regenerateSelectedAngles}
                    >
                      {regenAnglesLoading ? "Regenereren…" : `↻ Regenereer ${regenAngleSet.size} geselecteerd${regenAngleSet.size === 1 ? "e angle" : "e angles"}`}
                    </button>
                    <button
                      className="pedro-btn-ghost text-[11px] h-7 px-2"
                      onClick={() => {
                        setRegenAngleSet(new Set());
                        setRegenAngleSteering("");
                      }}
                      disabled={regenAnglesLoading}
                    >
                      Annuleer
                    </button>
                  </div>
                </div>
              )}

              {angles.length > 0 && (
                <>
                  <div className="flex items-center justify-between pt-[1.125rem] border-t border-border/60 mt-[1.125rem]">
                    <div className="flex items-center gap-3">
                      <button className="pedro-btn-ghost text-[11px]" onClick={doAngles} disabled={anglesLoading || regenAnglesLoading || parallelRunning}>↻ Nieuwe angles</button>
                      <span className="text-[11px] text-muted-foreground/60">{selectedAngles.length}/5 geselecteerd</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="pedro-btn-ghost text-[11px] h-8 px-3"
                        disabled={selectedAngles.length < 1 || parallelRunning}
                        onClick={generateAllRestParallel}
                        title="Genereer script, creatives, LP en ad copy in één keer (parallel waar mogelijk)"
                      >
                        🚀 Genereer alle deliverables
                      </button>
                      <button
                        className="pedro-btn-primary"
                        disabled={selectedAngles.length < 1 || parallelRunning}
                        onClick={() =>
                          saveStageAndContinue({
                            stage: "angles",
                            data: selectedAngles,
                            nextSection: "script",
                          })
                        }
                      >
                        Opslaan &amp; naar script ({selectedAngles.length} angle{selectedAngles.length !== 1 ? "s" : ""}) →
                      </button>
                    </div>
                  </div>

                  {/* Parallel-mode progress panel — only renders during a
                      "Genereer alle stages" run. Shows per-stage state so
                      the CM can see what's still in flight without
                      stepping into each tab. */}
                  {parallelRunning || Object.values(parallelProgress).some((s) => s !== "idle") ? (
                    <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                      <div className="text-[11px] font-medium text-primary mb-2">
                        {parallelRunning ? "Alle deliverables aan het genereren…" : "Deliverables gegenereerd"}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {([
                          ["script", "Script"],
                          ["lp", "LP"],
                          ["creatives", "Creatives"],
                          ["adCopy", "Ad copy"],
                        ] as const).map(([key, label]) => {
                          const status = parallelProgress[key];
                          const icon =
                            status === "done" ? "✓" :
                            status === "error" ? "✗" :
                            status === "skipped" ? "—" :
                            status === "running" ? "⟳" :
                            "·";
                          const tone =
                            status === "done" ? "text-emerald-500" :
                            status === "error" ? "text-red-500" :
                            status === "running" ? "text-primary" :
                            "text-muted-foreground/50";
                          return (
                            <div key={key} className="flex items-center gap-1.5 text-[11px]">
                              <span className={`tabular-nums ${tone} ${status === "running" ? "animate-pulse" : ""}`}>{icon}</span>
                              <span className={status === "done" ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
        </Card>
        </>
      )}

      {/* ── STEP 3: Script (optional) ── */}
      {step === 3 && (
        <>
        <StageActionBar
          clientId={selectedClientId}
          stage="script"
          getCurrentData={() => ({ script_text: script, script_videos: scriptVideos })}
          busy={scriptLoading}
        />
        <Card active>
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="font-heading font-semibold text-base tracking-tight">
                Video script
                <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.4px] text-muted-foreground/60 bg-muted/40 px-2 py-0.5 rounded-full border border-border/60 align-middle">Optioneel</span>
              </div>
              <div className="text-xs text-muted-foreground mt-[3px]">UGC-stijl voor Meta video ads (60 sec)</div>
            </div>
            <button className="pedro-btn-ghost text-[11px]" onClick={() => goTo(2)}>← Terug</button>
          </div>

          {scriptLoading ? (
            <Spinner text="Pedro schrijft het script..." sub="2 video's met verschillende angles" />
          ) : scriptVideos.length > 0 ? (
            <>
              {/* Editable video scripts */}
              {scriptVideos.map((video, vi) => (
                <div key={vi} className="bg-muted/40 border border-border/60 rounded-xl p-[1rem_1.125rem] mb-4">
                  <input
                    type="text"
                    value={video.title}
                    onChange={(e) => updateVideoField(vi, "title", e.target.value)}
                    className="bg-transparent border-none text-[15px] font-heading font-bold text-foreground w-full mb-3 p-0 focus:ring-0 focus:outline-none"
                  />

                  {video.hooks.map((hook, hi) => (
                    <div key={hi} className="flex gap-2 items-start mb-2">
                      <span className="text-[12px] font-bold text-primary whitespace-nowrap mt-[0.45rem] min-w-[52px]">Hook {hi + 1}:</span>
                      <textarea
                        value={hook}
                        onChange={(e) => updateHook(vi, hi, e.target.value)}
                        className="flex-1 bg-card border border-border/60 rounded-lg px-3 py-2 text-[12.5px] text-foreground leading-[1.5] resize-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                        style={{ minHeight: 36 }}
                      />
                    </div>
                  ))}

                  <div className="flex gap-2 items-start mb-2 mt-3">
                    <span className="text-[12px] font-bold text-primary whitespace-nowrap mt-[0.45rem] min-w-[52px]">Body:</span>
                    <textarea
                      value={video.body}
                      onChange={(e) => updateVideoField(vi, "body", e.target.value)}
                      className="flex-1 bg-card border border-border/60 rounded-lg px-3 py-2 text-[12.5px] text-foreground leading-[1.6] resize-vertical focus:border-primary focus:ring-2 focus:ring-primary/30"
                      style={{ minHeight: 80 }}
                    />
                  </div>

                  <div className="flex gap-2 items-start">
                    <span className="text-[12px] font-bold text-primary whitespace-nowrap mt-[0.45rem] min-w-[52px]">CTA:</span>
                    <textarea
                      value={video.cta}
                      onChange={(e) => updateVideoField(vi, "cta", e.target.value)}
                      className="flex-1 bg-card border border-border/60 rounded-lg px-3 py-2 text-[12.5px] text-foreground leading-[1.5] resize-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                      style={{ minHeight: 36 }}
                    />
                  </div>
                </div>
              ))}

              {/* Static guidelines */}
              <div className="bg-muted/40 border border-border/60 rounded-lg p-[1rem_1.125rem] mt-2">
                <div className="font-heading font-semibold text-[11.5px] text-primary uppercase tracking-[0.9px] mb-3">
                  Opnamerichtlijnen
                </div>
                <div className="text-[12.5px] text-muted-foreground leading-[1.7] whitespace-pre-wrap">
                  {SCRIPT_GUIDELINES}
                </div>
              </div>

              <div className="flex items-center justify-between pt-[1.125rem] border-t border-border/60 mt-[1.125rem]">
                <div className="flex items-center gap-2">
                  <button className="pedro-btn-ghost text-[11px]" onClick={() => doScript()}>↻ Opnieuw</button>
                  <button className="pedro-btn-ghost text-[11px]" onClick={downloadScriptDocx}>↓ Download .docx</button>
                </div>
                <button
                  className="pedro-btn-primary"
                  onClick={() =>
                    saveStageAndContinue({
                      stage: "script",
                      data: { script_text: script, script_videos: scriptVideos },
                      nextSection: "lp",
                    })
                  }
                >
                  Opslaan &amp; naar LP →
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center py-8 gap-4">
              <div className="text-xs text-muted-foreground text-center max-w-sm">
                Genereer 2 video scripts met verschillende angles, of sla deze stap over.
              </div>
              <div className="flex gap-3">
                <button className="pedro-btn-ghost" onClick={skipScript}>
                  Overslaan →
                </button>
                <button className="pedro-btn-primary" onClick={() => doScript()}>
                  Genereer scripts
                </button>
              </div>
            </div>
          )}
        </Card>
        </>
      )}

      {/* ── STEP 5: Creatives (was step 4 before LP/Creatives swap) ── */}
      {step === 5 && (
        <>
          <StageActionBar
            clientId={selectedClientId}
            stage="creatives"
            getCurrentData={() => ({ qty, formats, driveLink, brandbookName, huisstijl, manusPrompt })}
            busy={manusLoading}
          />
          <Card active>
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="font-heading font-semibold text-base tracking-tight">Creatives configuratie</div>
                <div className="text-xs text-muted-foreground mt-[3px]">Aantal, formaat en client content</div>
              </div>
              <button className="pedro-btn-ghost text-[11px]" onClick={() => goTo(4)}>← Terug naar LP</button>
            </div>

            {/* Qty */}
            <div className="bg-muted/40 border border-border/60 rounded-lg p-[1rem_1.125rem] mb-3">
              <div className="font-heading font-semibold text-[11.5px] text-primary uppercase tracking-[0.9px] mb-3">Aantal creatives</div>
              <div className="flex items-center gap-[10px]">
                <button className="w-7 h-7 rounded-md bg-card border border-border/60 text-foreground text-[15px] flex items-center justify-center cursor-pointer transition-all hover:border-primary hover:text-primary" onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
                <div className="font-heading font-bold text-lg min-w-[22px] text-center">{qty}</div>
                <button className="w-7 h-7 rounded-md bg-card border border-border/60 text-foreground text-[15px] flex items-center justify-center cursor-pointer transition-all hover:border-primary hover:text-primary" onClick={() => setQty(Math.min(6, qty + 1))}>+</button>
                <span className="text-[11.5px] text-muted-foreground/60 ml-1">creatives</span>
              </div>
            </div>

            {/* Formats */}
            <div className="bg-muted/40 border border-border/60 rounded-lg p-[1rem_1.125rem] mb-3">
              <div className="font-heading font-semibold text-[11.5px] text-primary uppercase tracking-[0.9px] mb-3">Formaat</div>
              <div className="flex flex-wrap gap-[6px]">
                {allFormats.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormats((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f])}
                    className={`px-[11px] py-1 rounded-[20px] text-[11.5px] font-medium border cursor-pointer transition-all font-inter ${
                      formats.includes(f) ? "bg-primary/10 border-primary text-primary" : "bg-transparent border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Huisstijl */}
            <div className="bg-muted/40 border border-border/60 rounded-lg p-[1rem_1.125rem] mb-3">
              <div className="flex items-center justify-between mb-3">
                <div className="font-heading font-semibold text-[11.5px] text-primary uppercase tracking-[0.9px]">Huisstijl klant</div>
                {brandStyle && !huisstijlOverride && (
                  <button
                    className="text-[10px] text-muted-foreground/60 hover:text-foreground cursor-pointer bg-transparent border-none font-inter"
                    onClick={() => setHuisstijlOverride(true)}
                  >
                    ✏️ Overschrijven
                  </button>
                )}
                {huisstijlOverride && (
                  <button
                    className="text-[10px] text-emerald-500 hover:text-foreground cursor-pointer bg-transparent border-none font-inter"
                    onClick={() => setHuisstijlOverride(false)}
                  >
                    ← Terug naar analyse
                  </button>
                )}
              </div>

              {brandStyle && !huisstijlOverride ? (
                <div>
                  <div className="flex gap-3 mb-2">
                    {(["primaryColor", "secondaryColor", "accentColor"] as const).map((field) => {
                      const color = brandStyle[field];
                      if (!color) return null;
                      const label = field === "primaryColor" ? "Primary" : field === "secondaryColor" ? "Secondary" : "Accent";
                      return (
                        <label key={field} className="flex items-center gap-1.5 cursor-pointer relative">
                          <div className="w-5 h-5 rounded border border-border/60" style={{ background: color }} />
                          <span className="text-[11px] text-muted-foreground">{label}: {color}</span>
                          <input
                            type="color"
                            value={color}
                            onChange={(e) => overrideBrandColor(field, e.target.value)}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-[5px]">
                  <label className="text-xs font-medium text-muted-foreground">
                    {huisstijlOverride ? "Overschrijf de geanalyseerde huisstijl" : "Beschrijf de huisstijl (of analyseer de website in stap 1)"}
                  </label>
                  <textarea
                    style={{ minHeight: 70 }}
                    placeholder="bv. Rood en wit, zakelijk, vertrouwen uitstralen, professionele foto's van het team"
                    value={huisstijl}
                    onChange={(e) => setHuisstijl(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Content inputs */}
            <div className="bg-muted/40 border border-border/60 rounded-lg p-[1rem_1.125rem] mb-3">
              <div className="font-heading font-semibold text-[11.5px] text-primary uppercase tracking-[0.9px] mb-3">Client content</div>
              <div className="flex flex-col gap-3">
                {/* Drive link */}
                <div className="flex flex-col gap-[5px]">
                  <label className="text-xs font-medium text-muted-foreground">Afbeeldingen uit Drive</label>
                  <input type="text" placeholder="https://drive.google.com/drive/folders/..." value={driveLink} onChange={(e) => setDriveLink(e.target.value)} />
                </div>

                {/* Image upload */}
                <div className="flex flex-col gap-[5px]">
                  <label className="text-xs font-medium text-muted-foreground">Upload afbeeldingen handmatig</label>
                  <div className="flex items-center gap-2">
                    <label className="px-3 py-[0.4rem] rounded-lg border border-border/60 text-[11.5px] text-muted-foreground cursor-pointer hover:border-primary/40 hover:text-primary transition-all">
                      Kies bestanden...
                      <input
                        type="file"
                        accept=".jpg,.jpeg,.png,.webp"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          setUploadedImages(files.map((f) => f.name));
                          if (files.length > 0) showToast(`${files.length} afbeelding(en) toegevoegd`);
                        }}
                      />
                    </label>
                    {uploadedImages.length > 0 && (
                      <span className="text-[11px] text-emerald-500">✓ {uploadedImages.length} bestand(en)</span>
                    )}
                  </div>
                  {uploadedImages.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {uploadedImages.map((name) => (
                        <span key={name} className="text-[10px] bg-card border border-border/60 rounded px-2 py-0.5 text-muted-foreground/60">{name}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Brandbook */}
                <div className="flex flex-col gap-[5px]">
                  <label className="text-xs font-medium text-muted-foreground">Brandbook uploaden (PDF)</label>
                  <div className="flex items-center gap-2">
                    <label className="px-3 py-[0.4rem] rounded-lg border border-border/60 text-[11.5px] text-muted-foreground cursor-pointer hover:border-primary/40 hover:text-primary transition-all">
                      Kies PDF...
                      <input
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setBrandbookName(file.name);
                            showToast(`Brandbook "${file.name}" toegevoegd`);
                          }
                        }}
                      />
                    </label>
                    {brandbookName && (
                      <span className="text-[11px] text-emerald-500">✓ {brandbookName}</span>
                    )}
                  </div>
                </div>

                {/* No content note */}
                {!driveLink && uploadedImages.length === 0 && (
                  <div className="text-[10.5px] text-muted-foreground/60 mt-1 opacity-85">
                    Geen afbeeldingen toegevoegd? Pedro gebruikt AI stock content.
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-[1.125rem] border-t border-border/60 mt-[1.125rem]">
              <input
                type="text"
                value={creativesSteering}
                onChange={(e) => setCreativesSteering(e.target.value)}
                placeholder="Optionele steering (bv. 'minder generieke headlines, meer concrete cijfers' of 'alle creatives in variant F pattern-interrupt')"
                className="w-full text-[11px] rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5 leading-snug placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Stap 5 van 6</div>
                <button className="pedro-btn-primary" onClick={() => doCreative()} disabled={manusLoading}>
                  {manusLoading ? "Genereren..." : manusPrompt ? "↻ Regenereer met steering" : "Genereer Manus prompt"}
                </button>
              </div>
            </div>
          </Card>

          {/* Manus prompt output */}
          {(manusLoading || manusPrompt) && (
            <Card>
              <div className="flex items-center justify-between mb-5">
                <div className="font-heading font-bold text-sm tracking-tight">Manus prompt</div>
                {manusPrompt && (
                  <div className="text-[10px] text-muted-foreground/60 font-inter">
                    {manusPrompt.length.toLocaleString()} tekens - {manusPrompt.split(/\s+/).filter(Boolean).length.toLocaleString()} woorden
                  </div>
                )}
              </div>
              {manusLoading ? (
                <Spinner text="Pedro genereert de creative prompt..." sub="Kopieer de prompt en plak in Manus" />
              ) : manusPrompt ? (
                <>
                  <div className="bg-muted/40 border border-border/60 rounded-[10px] p-[0.875rem] text-[13px] leading-[1.7] text-foreground whitespace-pre-wrap overflow-visible" style={{ height: "auto", maxHeight: "none" }}>
                    {manusPrompt}
                  </div>
                  <div className="flex items-center justify-between pt-[1.125rem] border-t border-border/60 mt-[1.125rem]">
                    <div className="flex items-center gap-2">
                      <button className="pedro-btn-primary text-[11px]" onClick={() => { navigator.clipboard.writeText(manusPrompt); showToast("Prompt gekopieerd"); }}>Kopieer prompt</button>
                      <button className="pedro-btn-ghost text-[11px]" onClick={() => doCreative()}>Opnieuw genereren</button>
                      <button className="pedro-btn-ghost text-[11px]" onClick={downloadBrandMD}>Brand MD</button>
                    </div>
                    <button
                      className="pedro-btn-primary"
                      onClick={() =>
                        saveStageAndContinue({
                          stage: "creatives",
                          data: { qty, formats, driveLink, brandbookName, huisstijl, manusPrompt },
                          nextSection: "ad-copy",
                        })
                      }
                    >
                      Opslaan &amp; naar ad copy →
                    </button>
                  </div>
                </>
              ) : null}
            </Card>
          )}
        </>
      )}

      {/* ── STEP 4: LP (was step 5 before LP/Creatives swap) ── */}
      {step === 4 && (
        <>
          <StageActionBar
            clientId={selectedClientId}
            stage="lp"
            getCurrentData={() => ({ stijl, lengte, pixelId, webhookUrl, utmStr, lpPrompt })}
            busy={lpLoading}
          />
          <Card active>
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="font-heading font-semibold text-base tracking-tight">Landingspagina configuratie</div>
                <div className="text-xs text-muted-foreground mt-[3px]">Stijl, lengte, tracking &amp; technisch</div>
              </div>
              <button className="pedro-btn-ghost text-[11px]" onClick={() => goTo(3)}>← Terug naar script</button>
            </div>

            {/* Stijl */}
            <div className="bg-muted/40 border border-border/60 rounded-lg p-[1rem_1.125rem] mb-3">
              <div className="font-heading font-semibold text-[11.5px] text-primary uppercase tracking-[0.9px] mb-3">Stijl</div>
              <div className="flex flex-wrap gap-[6px]">
                {stijlOptions.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStijl(s)}
                    className={`px-[11px] py-1 rounded-[20px] text-[11.5px] font-medium border cursor-pointer transition-all font-inter ${
                      stijl === s ? "bg-primary/10 border-primary text-primary" : "bg-transparent border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Lengte */}
            <div className="bg-muted/40 border border-border/60 rounded-lg p-[1rem_1.125rem] mb-3">
              <div className="font-heading font-semibold text-[11.5px] text-primary uppercase tracking-[0.9px] mb-3">Lengte</div>
              <div className="flex flex-wrap gap-[6px]">
                {lengteOptions.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLengte(l)}
                    className={`px-[11px] py-1 rounded-[20px] text-[11.5px] font-medium border cursor-pointer transition-all font-inter ${
                      lengte === l ? "bg-primary/10 border-primary text-primary" : "bg-transparent border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Tracking */}
            <div className="bg-muted/40 border border-border/60 rounded-lg p-[1rem_1.125rem] mb-3">
              <div className="font-heading font-semibold text-[11.5px] text-primary uppercase tracking-[0.9px] mb-3">Pixel &amp; Tracking</div>
              <div className="grid grid-cols-2 gap-[0.875rem]">
                <div className="flex flex-col gap-[5px]">
                  <label className="text-xs font-medium text-muted-foreground">Meta Pixel ID</label>
                  <input type="text" placeholder="bv. 1234567890123456" value={pixelId} onChange={(e) => setPixelId(e.target.value)} />
                </div>
                <div className="flex flex-col gap-[5px]">
                  <label className="text-xs font-medium text-muted-foreground">Zapier Webhook URL</label>
                  <input type="text" placeholder="https://hooks.zapier.com/..." value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
                </div>
                <div className="flex flex-col gap-[5px] col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">UTM structuur</label>
                  <input type="text" placeholder="utm_source=meta&utm_medium=paid&utm_campaign={{naam}}" value={utmStr} onChange={(e) => setUtmStr(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-[1.125rem] border-t border-border/60 mt-[1.125rem]">
              <div className="text-xs text-muted-foreground">Stap 4 van 6</div>
              <button className="pedro-btn-primary" onClick={() => doLP()}>Genereer Lovable prompt →</button>
            </div>
          </Card>

          {showLpCard && (
            <Card>
              <div className="font-heading font-bold text-sm tracking-tight mb-5">Lovable prompt - landingspagina</div>
              {lpLoading ? (
                <Spinner text="Pedro genereert de LP prompt..." sub="Inclusief pixel, webhook & UTM tracking" />
              ) : lpPrompt ? (
                <>
                  <OutputBlock content={lpPrompt} />
                  <div className="flex items-center justify-between pt-[1.125rem] border-t border-border/60 mt-[1.125rem]">
                    <button className="pedro-btn-ghost text-[11px]" onClick={() => doLP()}>↻ Opnieuw</button>
                    <button
                      className="pedro-btn-primary"
                      onClick={() =>
                        saveStageAndContinue({
                          stage: "lp",
                          data: { stijl, lengte, pixelId, webhookUrl, utmStr, lpPrompt },
                          nextSection: "creatives",
                        })
                      }
                    >
                      Opslaan &amp; naar creatives →
                    </button>
                  </div>
                </>
              ) : null}
            </Card>
          )}
        </>
      )}

      {/* ── STEP 6: Ad copy (last - uses LP context) ── */}
      {step === 6 && (
        <>
        <StageActionBar
          clientId={selectedClientId}
          stage="ad-copy"
          getCurrentData={() => adCopy}
          busy={adCopyLoading}
        />
        <Card active>
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="font-heading font-semibold text-base tracking-tight">Ad copy</div>
              <div className="text-xs text-muted-foreground mt-[3px]">Meta &amp; Instagram advertentieteksten - afgestemd op LP + creatives</div>
            </div>
            <button className="pedro-btn-ghost text-[11px]" onClick={() => goTo(5)}>← Terug</button>
          </div>

          {adCopyLoading ? (
            <Spinner text="Pedro schrijft de copy..." sub="Afgestemd op landingspagina, angles & script" />
          ) : adCopy ? (
            <>
              <div className="flex border-b border-border/60 mb-5">
                {(["primary", "headlines", "desc"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setCopyTab(tab)}
                    className={`px-[0.875rem] py-[0.45rem] text-xs font-medium cursor-pointer border-b-2 -mb-px transition-all bg-transparent font-inter ${
                      copyTab === tab ? "text-primary border-primary" : "text-muted-foreground border-transparent hover:text-foreground"
                    }`}
                  >
                    {tab === "primary" ? "Primaire tekst" : tab === "headlines" ? "Headlines" : "Beschrijving"}
                  </button>
                ))}
              </div>

              {copyTab === "primary" && (
                <>
                  <div className="mb-5">
                    <div className="text-[9.5px] uppercase tracking-[1px] text-muted-foreground/60 font-semibold mb-[5px]">Variant A</div>
                    <OutputBlock content={adCopy.variantA} />
                  </div>
                  <div className="mb-5">
                    <div className="text-[9.5px] uppercase tracking-[1px] text-muted-foreground/60 font-semibold mb-[5px]">Variant B</div>
                    <OutputBlock content={adCopy.variantB} />
                  </div>
                </>
              )}
              {copyTab === "headlines" && <OutputBlock content={adCopy.headlines} />}
              {copyTab === "desc" && <OutputBlock content={adCopy.beschrijving} />}

              <div className="flex items-center justify-between pt-[1.125rem] border-t border-border/60 mt-[1.125rem]">
                <button className="pedro-btn-ghost text-[11px]" onClick={() => doAdCopy()}>↻ Opnieuw</button>
                <div className="flex gap-2 flex-wrap">
                  <button
                    className="pedro-btn-teal text-[11px] disabled:opacity-60"
                    onClick={saveClientDeliverable}
                    disabled={deliverableSaving || !selectedClientId}
                    title="Bundel alle opgeslagen stages tot één client deliverable .md en sla op aan de klant"
                  >
                    {deliverableSaving ? "Opslaan…" : "📄 Sla op als client deliverable"}
                  </button>
                  <button className="pedro-btn-ghost text-[11px]" onClick={generateAndDownloadClientMD}>Client MD download</button>
                  <button className="pedro-btn-ghost text-[11px]" onClick={resetAll}>+ Nieuwe campagne</button>
                </div>
              </div>
            </>
          ) : null}
        </Card>
        </>
      )}

      {/* Toast */}
      <div
        className={`fixed bottom-6 right-6 bg-card border border-primary/30 rounded-[10px] px-4 py-[0.625rem] text-[12.5px] text-foreground flex items-center gap-[7px] z-[100] shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-all ${
          toast ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0 pointer-events-none"
        }`}
      >
        <span className="text-emerald-500">✓</span>
        <span>{toast}</span>
      </div>
    </div>
  );
}
