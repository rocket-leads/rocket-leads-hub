"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { parseScriptText, generateScriptDocx, type ScriptVideo } from "@/lib/pedro/generate-script-docx";
import { clientSlug, buildClientMD, parseClientMD, type ClientData, type ClientCampaign } from "@/lib/pedro/client-database";
import type { PedroClient } from "../page";
import { StageActionBar } from "./stage-action-bar";

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
async function callClaude(
  prompt: string,
  maxTokens = 1000,
  ctx?: { clientId?: string | null; stage?: string },
): Promise<string> {
  const res = await fetch("/api/pedro/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      maxTokens,
      // When clientId+stage are present the server enriches the system
      // prompt with prior Pedro outputs for that stage so Pedro doesn't
      // repeat itself across campaigns.
      clientId: ctx?.clientId ?? undefined,
      stage: ctx?.stage ?? undefined,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.text;
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
      className={`rounded-2xl border bg-card p-6 mb-5 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04),0_1px_3px_-1px_rgb(0_0_0_/_0.04)] dark:shadow-[0_1px_2px_0_rgb(0_0_0_/_0.3)] transition-colors ${
        active ? "border-primary/30 ring-1 ring-primary/20" : "border-border/60"
      }`}
    >
      {children}
    </div>
  );
}

// Shared rules injected into every generation prompt
const GENERATION_RULES = `\n\nALGEMENE REGELS (altijd opvolgen):
- Gebruik NOOIT datums, deadlines, vervaldata, actiedata of tijdelijke aanbiedingen (bv. "nog maar tot vrijdag", "actie geldig t/m", "alleen deze week") TENZIJ de klant expliciet een specifieke datum heeft opgegeven in de briefing.
- Genereer alle output in DEZELFDE TAAL als de input van de klant. Als de briefing in het Nederlands is, schrijf dan in het Nederlands. Als de briefing in het Engels is, schrijf dan in het Engels.`;

// ── Main Component ──
// Sections map to steps internally for backwards compatibility
type SectionName = "brief" | "angles" | "script" | "creatives" | "lp" | "ad-copy";
const SECTION_TO_STEP: Record<SectionName, number> = {
  brief: 1, angles: 2, script: 3, creatives: 4, lp: 5, "ad-copy": 6,
};
const STEP_TO_SECTION: Record<number, SectionName> = {
  1: "brief", 2: "angles", 3: "script", 4: "creatives", 5: "lp", 6: "ad-copy",
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
  };

  // Helper: build angles string for prompts
  const anglesStr = () => selectedAngles.map((a) => `- "${a.titel}": ${a.beschrijving}`).join("\n");

  // Helper: build script context for prompts (empty if skipped)
  const scriptContext = () => scriptSkipped || !script ? "" : `\nVideo script context:\n${script.substring(0, 800)}`;

  // Helper: build style reference from Meta ads (silent, background)
  const styleRef = () => metaStyleRef ? `\n\nAltijd baseer nieuwe creatives op de stijl en structuur van deze bestaande Rocket Leads campagnes (toon, hook-formaat, visuele compositie):\n${metaStyleRef}\n\nVoeg creatieve variatie en frisse ideeën toe bovenop deze basis.` : "";

  // Helper: build huisstijl context for prompts
  const huisstijlContext = () => {
    if (huisstijlOverride && huisstijl) {
      return `\nHuisstijl klant: ${huisstijl}`;
    }
    if (!brandStyle) return huisstijl ? `\nHuisstijl klant: ${huisstijl}` : "";
    return `\nClient brand style (geëxtraheerd van hun website):
- Primaire kleur: ${brandStyle.primaryColor}
- Secundaire kleur: ${brandStyle.secondaryColor}
- Toon: ${brandStyle.tone}
- Visuele stijl: ${brandStyle.visualStyle}
- Brand keywords: ${brandStyle.brandKeywords}`;
  };

  // Helper: structured huisstijl for Manus prompt
  const huisstijlForManus = () => {
    if (huisstijlOverride && huisstijl) {
      return `\nHuisstijl klant: ${huisstijl}\nGebruik dit als visuele basis voor de creatives.`;
    }
    if (!brandStyle) return huisstijl ? `\nHuisstijl klant: ${huisstijl}\nGebruik dit als visuele basis voor de creatives.` : "";
    return `\nClient brand style (geëxtraheerd van hun website):
- Primaire kleur: ${brandStyle.primaryColor}
- Toon: ${brandStyle.tone}
- Visuele stijl: ${brandStyle.visualStyle}
- Brand keywords: ${brandStyle.brandKeywords}
Gebruik dit als visuele basis voor de creatives.`;
  };

  // Helper: structured huisstijl for Lovable prompt
  const huisstijlForLP = () => {
    if (huisstijlOverride && huisstijl) {
      return `\nHuisstijl klant: ${huisstijl}`;
    }
    if (!brandStyle) return huisstijl ? `\nHuisstijl klant: ${huisstijl}` : "";
    return `\nMatch de bestaande merkidentiteit van de klant:
- Primaire kleur: ${brandStyle.primaryColor}, secundair: ${brandStyle.secondaryColor}
- Toon: ${brandStyle.tone}
- Visuele stijl: ${brandStyle.visualStyle}`;
  };

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
  // the next section. Combines the two-layer-storage commit (POST to
  // /api/pedro/saved-versions) with section navigation in a single click.
  // Tab navigation up top stays as the "navigate without saving" escape
  // hatch — Roy's directive 2026-05-09.
  async function saveStageAndContinue(args: {
    stage: "brief" | "angles" | "script" | "creatives" | "lp" | "ad-copy";
    data: unknown;
    nextSection: SectionName | "research";
  }) {
    if (selectedClientId) {
      try {
        const res = await fetch("/api/pedro/saved-versions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: selectedClientId,
            stage: args.stage,
            data: args.data,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          showToast(`✓ Opgeslagen als v${json.version?.version_number ?? "?"}`);
        }
      } catch {
        // silent — navigation still happens so the user isn't blocked
      }
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
    const extra = brief.hooksExtra ? `\nExtra hooks campaign manager (prioriteit): ${brief.hooksExtra}` : "";

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
      const res = sanitizeOutput(await callClaude(
        `Jij bent Pedro, senior campaign manager bij Rocket Leads NL. B2C lead gen campagnes voor Meta.\n\nClient:\n- Bedrijf: ${brief.bedrijf} (${brief.sector})\n- Doelgroep: ${brief.doel}\n- Pijnpunt: ${brief.pijn}\n- Aanbod: ${brief.aanbod}\n- USP's: ${brief.usps}\n- Hooks kick-off: ${brief.hooksAM}${extra}${researchContext}\n\nGenereer precies 5 marketing angles. Varieer in psychologische trigger (urgentie, angst, autoriteit, social proof, nieuwsgierigheid, etc.).\nALLEEN JSON:\n[{"nummer":1,"titel":"naam","beschrijving":"2 zinnen uitleg"},{"nummer":2,"titel":"...","beschrijving":"..."},{"nummer":3,"titel":"...","beschrijving":"..."},{"nummer":4,"titel":"...","beschrijving":"..."},{"nummer":5,"titel":"...","beschrijving":"..."}]${GENERATION_RULES}${styleRef()}${huisstijlContext()}`,
        1500,
        { clientId: selectedClientId, stage: "angles" }
      ));
      try {
        setAngles(parseJSON<Angle[]>(res));
      } catch (parseErr) {
        console.error("JSON parse error. Raw response:", res);
        showToast(`Kon antwoord niet parsen -- check console (${parseErr instanceof Error ? parseErr.message : "parse fout"})`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "onbekende fout";
      console.error("doAngles error:", e);
      showToast(`Fout bij genereren angles: ${msg}`);
    }
    setAnglesLoading(false);
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

  async function doScript() {
    goTo(3);
    setScriptLoading(true);
    setScript("");
    setScriptSkipped(false);
    try {
      const res = sanitizeOutput(await callClaude(
        `Jij bent Pedro, senior campaign manager bij Rocket Leads. Schrijf 2 UGC-stijl video ad scripts.

Client: ${brief.bedrijf} (${brief.sector})
Doelgroep: ${brief.doel}
Aanbod: ${brief.aanbod}
USP's: ${brief.usps}
Geselecteerde angles:
${anglesStr()}
Extra hooks CM: ${brief.hooksExtra || "geen"}

REGELS:
- Video 1 en Video 2 moeten STERK VERSCHILLENDE psychologische triggers gebruiken (bv. urgentie vs. social proof, pijn vs. ambitie, angst vs. nieuwsgierigheid)
- Hooks moeten provocerend, confronterend of verrassend zijn - NIET generiek
- Body max 5 zinnen - geen informatiedump, net genoeg om te klikken
- Social proof in body moet specifiek en realistisch voelen, gebruik sectorspecifieke cijfers
- Schrijf in dezelfde taal als de input van de klant

OUTPUT EXACT DIT FORMAAT (geen markdown, geen extra uitleg):

---
VIDEO 1 - [Angle naam]

Hook 1: "..."
Hook 2: "..."
Hook 3: "..."
Hook 4: "..."
Hook 5: "..."

Body:
[Gesproken tekst van de video, 3-5 zinnen. Pakkend, geen informatiedump. Doel is klikken, niet informeren. Eindig met social proof: "Terwijl [concurrent] nog [probleem], haalt [klant X] al [resultaat] binnen. Elke maand. Automatisch."]

CTA:
[1 zin. Laagdrempelig.]

---
VIDEO 2 - [Andere angle, andere invalshoek]

Hook 1: "..."
Hook 2: "..."
Hook 3: "..."
Hook 4: "..."
Hook 5: "..."

Body:
[Zelfde structuur, andere invalshoek]

CTA:
[Passend bij video 2]

---${GENERATION_RULES}${styleRef()}${huisstijlContext()}`,
        1500,
        { clientId: selectedClientId, stage: "script" }
      ));
      setScript(res);
      setScriptVideos(parseScriptText(res));
    } catch {
      showToast("Fout bij genereren script");
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
  const FORMAT_DIMS: Record<string, string> = {
    "Static 1:1 (1080×1080)": "1080 x 1080 px",
    "Static 4:5 (1080×1350)": "1080 x 1350 px",
    "Story 9:16 (1080×1920)": "1080 x 1920 px",
    "Carousel eerste slide": "1080 x 1080 px (carousel)",
  };

  function buildFilledMasterPrompt(): string {
    const fmtList = formats.length > 0 ? formats : ["Static 1:1 (1080x1080)"];
    const fmtStr = fmtList.map((f) => `${f} (${FORMAT_DIMS[f] || "1080x1080"})`).join(", ");
    const drive = driveLink || "geen";
    const bs = brandStyle;
    const brandColors = bs
      ? `${bs.primaryColor}, ${bs.secondaryColor}`
      : huisstijl || "niet opgegeven";
    const toneValue = bs?.tone || "urgentie";

    const primaryHex = bs?.primaryColor || "#8967F3";
    const secondaryHex = bs?.secondaryColor || "#1A1A2E";

    return `# MANUS MASTER PROMPT -- ROCKET LEADS AD CREATIVES

Je bent een senior Meta advertising creative director. Je maakt high-converting Nederlandstalige statische ad creatives voor B2C en B2B lead generation campagnes. Je creatives stoppen de scroll, communiceren één duidelijke boodschap en zorgen voor een klik.

---

## CLIENT CONTEXT
Klant: ${brief.bedrijf}
Sector: ${brief.sector}
Doelgroep: ${brief.doel}
Angle:
${anglesStr()}
Hooks: ${brief.hooksExtra || brief.hooksAM || "niet opgegeven"}
USPs: ${brief.usps || "niet opgegeven"}
Brand kleuren: ${brandColors} (primary: ${primaryHex}, secondary: ${secondaryHex})
Content (Drive): ${drive}
Aantal creatives: ${qty}
Formaten: ${fmtStr}
Toon: ${toneValue}

---

## BEELDMATERIAAL

- Gebruik client-afbeeldingen als die beschikbaar zijn (max 1 per creative)
- Voor de rest: gebruik de Manus AI image generator
- Geen stockfoto's
- Achtergrondafbeeldingen mogen GEEN tekst, letters of cijfers bevatten -- dit clasht met de overlay-tekst
- Eindig elke AI image prompt met: "no text, no letters, no words, no numbers, no signs"

---

## BASISREGELS

- Alle tekst in het Nederlands
- Valuta altijd in € (euro)
- Geen datums of seizoensverwijzingen tenzij in de brief
- Geen overlappende tekstelementen
- Logo alleen als het bestand beschikbaar is

---

## DESIGN SYSTEEM

### Layout
- Formaat: ${fmtStr} (1:1=1080x1080 / 4:5=1080x1350 / 9:16=1080x1920)
- Full-bleed achtergrondafbeelding
- Donker gradient overlay onderste 40% voor leesbaarheid
- 48px veilige marge aan alle kanten
- Links uitgelijnd standaard, gecentreerd bij aspirational

### Headline
- Font: bold geometric sans-serif (Clash Display, Neue Haas Grotesk of vergelijkbaar)
- Groot en dominant -- vult 40-60% van de breedte
- Wit (#FFFFFF) met 1-2 kernwoorden in ${primaryHex}
- Max 8 woorden per regel, max 3 regels

### Subheadline
- Zelfde font, regular weight, 35-40% van headline grootte
- Wit of #E0E0E0

### USP checkmarks (optioneel, max 3)
- Checkmark in ${primaryHex} of wit
- Max 5 woorden per USP

### CTA button
- Pill shape (border-radius 50px), 60-75% breedte, gecentreerd
- Achtergrond: ${primaryHex}, wit bold tekst
- Positie: onderste 15-20%
- Max 5 woorden, nooit "Klik hier" of "Lees meer"

### Social proof (optioneel)
- Alleen met echte data -- nooit verzinnen
- Klein badge, rechtsboven

---

## CREATIVE VARIATIES

Genereer ${qty} creatives met VERSCHILLENDE aanpakken.

### A -- Statement (tekst-dominant)
Bold headline vult het meeste van het frame. Minimale of verdonkerde achtergrond.

### B -- Product Hero
Full-bleed product/dienst foto met gradient. Headline overlay. CTA prominent.

### C -- Social Proof
Echt resultaat of geloofwaardigheidselement als headline anker.

### D -- Problem/Solution
Directe confronterende vraag of pijnpunt. Checkmark USPs eronder.

### E -- Aspirational
Mooie lifestyle of eindresultaat beelden. Zachtere headline, droom-toon.

### F -- Pattern Interrupt (altijd min. 1 per batch)
Breekt bewust met sectornormen. Provocerend of verrassend.

---

## CREATIEVE RICHTING

Wees een echte creative director. Vraag bij elke batch: "Wat zou MIJN scroll stoppen?"

Varieer automatisch de toon per batch:
- 1x urgentie (FOMO-gevoel zonder datum)
- 1x aspiratie (droom, verlangen, status)
- 1x logica (cijfers, ROI, rationeel)
- 1x pattern interrupt (onverwacht, scroll-stoppend)

---

## OUTPUT FORMAT

Per creative:

### CREATIVE [N] -- Variatie [Letter] ([Naam])
**Headline:** "[Nederlandse tekst]"
**Subheadline:** "[tekst of GEEN]"
**USPs:** [max 3 of GEEN]
**CTA:** "[Nederlandse tekst]"
**Background:** [client afbeelding OF gedetailleerde AI image prompt eindigend met "no text, no letters, no words, no numbers, no signs"]
**Highlight kleur:** ${primaryHex} op [welke woorden]
**CTA achtergrond:** ${primaryHex}
**Logo:** [LINKSBOVEN / GEEN]
**Social proof:** [exacte tekst of GEEN]
**Sfeer:** [1 zin]
**Waarom dit werkt:** [1 zin strategische keuze]${previousManusRef()}`;
  }

  async function doCreative() {
    setManusLoading(true);
    setManusPrompt("");
    try {
      // Section 1: The filled master prompt (static, no AI needed)
      const masterPrompt = buildFilledMasterPrompt();

      // Section 2: Ask Claude to generate only the creative descriptions
      const bs = brandStyle;
      const pHex = bs?.primaryColor || "#8967F3";
      const sHex = bs?.secondaryColor || "#1A1A2E";

      const creativeDescriptions = sanitizeOutput(await callClaude(
        `Genereer ${qty} creative specs voor Manus. ALLE tekst in het Nederlands. Valuta in €.

Klant: ${brief.bedrijf} (${brief.sector})
Doelgroep: ${brief.doel}
Angles:
${anglesStr()}
Hooks: ${brief.hooksExtra || brief.hooksAM || "niet opgegeven"}
USPs: ${brief.usps || "niet opgegeven"}
Primary kleur: ${pHex} / Secondary: ${sHex}
Drive: ${driveLink || "geen"}
Formaten: ${(formats.length > 0 ? formats : ["Static 1:1 (1080x1080)"]).join(", ")}
${scriptContext() ? `Script context:\n${scriptContext()}` : ""}

Kies ${qty} variaties (A-F), min. 1x F "Pattern Interrupt". Varieer toon: urgentie, aspiratie, logica, pattern interrupt.

Per creative EXACT dit format:

### CREATIVE [N] -- Variatie [Letter] ([Naam])
**Headline:** "[Nederlands, max 3 regels x 8 woorden]"
**Subheadline:** "[tekst of GEEN]"
**USPs:** [max 3 of GEEN]
**CTA:** "[Nederlands, max 5 woorden]"
**Background:** [gedetailleerde AI image prompt: onderwerp, compositie, belichting, perspectief, kleurenpalet, sfeer. Eindig met "no text, no letters, no words, no numbers, no signs". OF "gebruik [bestandsnaam]" bij client content]
**Highlight kleur:** ${pHex} op [welke woorden]
**CTA achtergrond:** ${pHex}
**Logo:** [LINKSBOVEN / GEEN]
**Social proof:** [tekst of GEEN -- nooit verzinnen]
**Sfeer:** [1 zin]

Start direct met ### CREATIVE 1. Geen intro, geen samenvatting.${previousManusRef()}${GENERATION_RULES}`,
        2500,
        { clientId: selectedClientId, stage: "creatives" }
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
    } catch {
      showToast("Fout bij genereren creative prompt");
    }
    setManusLoading(false);
  }

  // ── Step 5: LP (uses brief + angle + script if not skipped) ──
  async function doLP() {
    const pixel = pixelId || "niet opgegeven";
    const webhook = webhookUrl || "niet opgegeven";
    const utm = utmStr || "utm_source=meta&utm_medium=paid";
    setShowLpCard(true);
    setLpLoading(true);
    setLpPrompt("");
    try {
      const scriptPart = scriptContext();
      const res = sanitizeOutput(await callClaude(
        `Jij bent Pedro bij Rocket Leads. Genereer een volledige Lovable prompt.${styleRef()}
${huisstijlForLP()}

Client: ${brief.bedrijf} (${brief.sector})
Doelgroep: ${brief.doel}
Aanbod: ${brief.aanbod}
USP's: ${brief.usps}
Geselecteerde angles:
${anglesStr()}
Hooks: ${brief.hooksExtra || brief.hooksAM}${scriptPart}

LP config:
- Stijl: ${stijl}
- Lengte: ${lengte}
- Meta Pixel ID: ${pixel}
- Zapier Webhook: ${webhook}
- UTM: ${utm}

BELANGRIJK: De landingspagina moet een ALGEMENE, overkoepelende benadering hebben die aansluit op ALLE geselecteerde angles. Niet focussen op één angle maar de kernboodschap zo formuleren dat bezoekers vanuit elke invalshoek (${selectedAngles.map((a) => a.titel).join(", ")}) zich herkennen in de pagina.

Specificeer hero sectie (breed ingestoken), pijnpunten, aanbod+USP's${lengte !== "Short - hero + CTA" ? ", social proof, leadformulier" : ""}${lengte === "Long - + FAQ + bezwaren" ? ", FAQ, bezwaren" : ""}.
Technisch: Pixel fbq('init') + fbq('track','PageView') + fbq('track','Lead') on submit. Form POST naar ${webhook} met velden + UTM params uit URL.${GENERATION_RULES}`,
        1200,
        { clientId: selectedClientId, stage: "lp" }
      ));
      setLpPrompt(res);
    } catch {
      showToast("Fout bij genereren LP prompt");
    }
    setLpLoading(false);
  }

  // ── Step 6: Ad copy (uses brief + angle + script + LP headline/CTA) ──
  async function doAdCopy() {
    // Save the LP draft as a new version on the way to ad-copy. Same
    // pattern as the other stage transitions — primary CTA does both
    // commit + navigate. Tab-nav up top remains the no-save escape.
    if (selectedClientId && lpPrompt) {
      try {
        const saveRes = await fetch("/api/pedro/saved-versions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: selectedClientId,
            stage: "lp",
            data: { stijl, lengte, pixelId, webhookUrl, utmStr, lpPrompt },
          }),
        });
        if (saveRes.ok) {
          const json = await saveRes.json();
          showToast(`✓ LP opgeslagen als v${json.version?.version_number ?? "?"}`);
        }
      } catch {
        /* silent — ad-copy generation continues regardless */
      }
    }

    goTo(6);
    setAdCopyLoading(true);
    setAdCopy(null);
    setCopyTab("primary");
    const scriptPart = scriptContext();
    const lpContext = lpPrompt ? `\nLandingspagina context (match hierop!):\n${lpPrompt.substring(0, 600)}` : "";
    try {
      const res = sanitizeOutput(await callClaude(
        `Jij bent Pedro, senior campaign manager bij Rocket Leads. Schrijf Meta advertentieteksten.\n\nClient: ${brief.bedrijf} (${brief.sector})\nDoelgroep: ${brief.doel}\nAanbod: ${brief.aanbod}\nUSP's: ${brief.usps}\nGeselecteerde angles:\n${anglesStr()}\nExtra hooks CM: ${brief.hooksExtra || "geen"}${scriptPart}${lpContext}\n\nBELANGRIJK: De ad copy moet EXACT aansluiten op de landingspagina. Gebruik dezelfde kernboodschap, voordelen en CTA zodat de bezoeker na het klikken op de ad precies vindt wat beloofd werd.\n\nSchrijf copy die alle geselecteerde angles dekt - wissel per variant van invalshoek:\n1. Primaire tekst variant A (120-150 woorden, angle 1 als leidraad, conversational, CTA)\n2. Primaire tekst variant B (100-130 woorden, andere angle als leidraad, andere toon)\n3. 5 headlines max 40 tekens - mix de verschillende angles\n4. 2 beschrijvingen max 25 woorden\n\nALLEEN JSON: {"variantA":"...","variantB":"...","headlines":"h1\\nh2\\nh3\\nh4\\nh5","beschrijving":"v1\\nv2"}${GENERATION_RULES}${styleRef()}${huisstijlContext()}`,
        1200,
        { clientId: selectedClientId, stage: "ad-copy" }
      ));
      setAdCopy(parseJSON<AdCopy>(res));
    } catch {
      showToast("Fout bij genereren ad copy");
    }
    setAdCopyLoading(false);
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

  // ── Get previous manus prompt from client DB for style reference ──
  function previousManusRef(): string {
    if (!clientDB || clientDB.campaigns.length === 0) return "";
    const lastPrompt = [...clientDB.campaigns].reverse().find((c) => c.manusPrompt && c.manusPrompt !== "-")?.manusPrompt;
    if (!lastPrompt) return "";
    // Truncate to last 1500 chars to avoid token overflow
    const truncated = lastPrompt.length > 1500 ? lastPrompt.substring(lastPrompt.length - 1500) : lastPrompt;
    return `\n\nPrevious creative direction for this client (maintain visual consistency):\n${truncated}`;
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
              <div className="font-heading font-semibold text-[15px] tracking-tight">Client brief</div>
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
            <div className="bg-muted/40 border border-emerald-500/20 rounded-lg p-[0.75rem_1rem] mb-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-500">Brand kleuren -- klik om te wijzigen</div>
              </div>

              {/* Active brand colors (editable) */}
              <div className="flex gap-4 mb-3">
                {(["primaryColor", "secondaryColor", "accentColor"] as const).map((field) => {
                  const color = brandStyle[field];
                  if (!color) return null;
                  const label = field === "primaryColor" ? "Primary (CTA)" : field === "secondaryColor" ? "Secondary" : "Accent";
                  return (
                    <div key={field} className="flex flex-col items-center gap-1">
                      <label className="relative cursor-pointer group">
                        <div
                          className="w-10 h-10 rounded-lg border-2 border-border/60 group-hover:border-primary transition-all shadow-md"
                          style={{ background: color }}
                        />
                        <input
                          type="color"
                          value={color}
                          onChange={(e) => overrideBrandColor(field, e.target.value)}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                      </label>
                      <span className="text-[9px] text-muted-foreground/60 uppercase tracking-[0.5px]">{label}</span>
                      <input
                        type="text"
                        value={color}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (/^#[0-9a-fA-F]{6}$/.test(v)) overrideBrandColor(field, v);
                        }}
                        className="!w-[72px] !text-[10px] !p-[2px_4px] text-center !bg-card !border-border/60"
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
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Bedrijfsnaam</label>
              <input type="text" placeholder="bv. GJJ Riooltechniek BV" value={brief.bedrijf} onChange={(e) => updateBrief("bedrijf", e.target.value)} />
            </div>
            <div className="flex flex-col gap-[5px]">
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sector</label>
              <input type="text" placeholder="bv. Loodgieter / riool" value={brief.sector} onChange={(e) => updateBrief("sector", e.target.value)} />
            </div>
            <div className="flex flex-col gap-[5px]">
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Doelgroep</label>
              <textarea style={{ minHeight: 80 }} placeholder="bv. B2C huiseigenaren NL, 30+, spaargeld" value={brief.doel} onChange={(e) => updateBrief("doel", e.target.value)} />
            </div>
            <div className="flex flex-col gap-[5px]">
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Pijnpunt</label>
              <textarea style={{ minHeight: 80 }} placeholder="bv. Verstopte afvoer, dure loodgieter" value={brief.pijn} onChange={(e) => updateBrief("pijn", e.target.value)} />
            </div>
            <div className="flex flex-col gap-[5px] col-span-2">
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Aanbod / dienst</label>
              <textarea placeholder="Beschrijf het aanbod, tarieven en werkwijze..." value={brief.aanbod} onChange={(e) => updateBrief("aanbod", e.target.value)} />
            </div>
            <div className="flex flex-col gap-[5px]">
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">USP&apos;s</label>
              <textarea style={{ minHeight: 100 }} placeholder={"- Binnen 60 min op locatie\n- 24/7 bereikbaar\n- Vaste prijzen"} value={brief.usps} onChange={(e) => updateBrief("usps", e.target.value)} />
            </div>
            <div className="flex flex-col gap-[5px]">
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Marketing hooks (account manager)</label>
              <textarea style={{ minHeight: 100 }} placeholder="Hooks vanuit kick-off update..." value={brief.hooksAM} onChange={(e) => updateBrief("hooksAM", e.target.value)} />
            </div>
            <div className="flex flex-col gap-[5px] col-span-2">
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Extra hooks - campaign manager</label>
              <textarea style={{ minHeight: 100 }} placeholder="Jouw eigen invalshoeken en aanvullingen op de kick-off..." value={brief.hooksExtra} onChange={(e) => updateBrief("hooksExtra", e.target.value)} />
              <div className="text-[10.5px] text-primary mt-[3px] opacity-85">
                → Pedro prioriteert deze hooks als extra laag bovenop de kick-off
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-[1.125rem] border-t border-border/60 mt-[1.125rem]">
            <div className="text-[11px] text-muted-foreground/60">
              Stap 1 van 6{" "}
              <span className="text-muted-foreground/40">· tab-nav bovenin slaat niet op</span>
            </div>
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
              <div className="font-heading font-semibold text-[15px] tracking-tight">Marketing angles</div>
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
                Klik om te selecteren/deselecteren - ideaal 3-5 angles
              </div>
              <div className="flex flex-col gap-[0.7rem]">
                {angles.map((a) => {
                  const isSelected = selectedAngles.some((s) => s.nummer === a.nummer);
                  const idx = selectedAngles.findIndex((s) => s.nummer === a.nummer);
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
                      }`}
                    >
                      <div
                        className={`absolute top-[0.875rem] right-[0.875rem] w-[18px] h-[18px] rounded-[4px] border-[1.5px] flex items-center justify-center text-[9px] font-bold transition-all ${
                          isSelected ? "bg-primary border-primary text-white" : "border-border/60"
                        }`}
                      >
                        {isSelected ? idx + 1 : ""}
                      </div>
                      <div className="text-[9.5px] uppercase tracking-[1px] text-primary font-semibold mb-1">Angle {a.nummer}</div>
                      <div className="font-heading font-bold text-sm tracking-tight mb-1 pr-8">{a.titel}</div>
                      <div className="text-xs text-muted-foreground leading-[1.55]">{a.beschrijving}</div>
                    </div>
                  );
                })}
              </div>

              {angles.length > 0 && (
                <div className="flex items-center justify-between pt-[1.125rem] border-t border-border/60 mt-[1.125rem]">
                  <div className="flex items-center gap-3">
                    <button className="pedro-btn-ghost text-[11px]" onClick={doAngles}>↻ Nieuwe angles</button>
                    <span className="text-[11px] text-muted-foreground/60">{selectedAngles.length}/5 geselecteerd</span>
                  </div>
                  <button
                    className="pedro-btn-primary"
                    disabled={selectedAngles.length < 1}
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
              <div className="font-heading font-semibold text-[15px] tracking-tight">
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
                  <button className="pedro-btn-ghost text-[11px]" onClick={doScript}>↻ Opnieuw</button>
                  <button className="pedro-btn-ghost text-[11px]" onClick={downloadScriptDocx}>↓ Download .docx</button>
                </div>
                <button
                  className="pedro-btn-primary"
                  onClick={() =>
                    saveStageAndContinue({
                      stage: "script",
                      data: { script_text: script, script_videos: scriptVideos },
                      nextSection: "creatives",
                    })
                  }
                >
                  Opslaan &amp; naar creatives →
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
                <button className="pedro-btn-primary" onClick={doScript}>
                  Genereer scripts
                </button>
              </div>
            </div>
          )}
        </Card>
        </>
      )}

      {/* ── STEP 4: Creatives ── */}
      {step === 4 && (
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
                <div className="font-heading font-semibold text-[15px] tracking-tight">Creatives configuratie</div>
                <div className="text-xs text-muted-foreground mt-[3px]">Aantal, formaat en client content</div>
              </div>
              <button className="pedro-btn-ghost text-[11px]" onClick={() => goTo(3)}>← Terug</button>
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
                  <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
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
                  <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Afbeeldingen uit Drive</label>
                  <input type="text" placeholder="https://drive.google.com/drive/folders/..." value={driveLink} onChange={(e) => setDriveLink(e.target.value)} />
                </div>

                {/* Image upload */}
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Upload afbeeldingen handmatig</label>
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
                  <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Brandbook uploaden (PDF)</label>
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

            <div className="flex items-center justify-between pt-[1.125rem] border-t border-border/60 mt-[1.125rem]">
              <div className="text-[11px] text-muted-foreground/60">Stap 4 van 6</div>
              <button className="pedro-btn-primary" onClick={doCreative} disabled={manusLoading}>
                {manusLoading ? "Genereren..." : "Genereer Manus prompt"}
              </button>
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
                      <button className="pedro-btn-ghost text-[11px]" onClick={doCreative}>Opnieuw genereren</button>
                      <button className="pedro-btn-ghost text-[11px]" onClick={downloadBrandMD}>Brand MD</button>
                    </div>
                    <button
                      className="pedro-btn-primary"
                      onClick={() =>
                        saveStageAndContinue({
                          stage: "creatives",
                          data: { qty, formats, driveLink, brandbookName, huisstijl, manusPrompt },
                          nextSection: "lp",
                        })
                      }
                    >
                      Opslaan &amp; naar landingspagina →
                    </button>
                  </div>
                </>
              ) : null}
            </Card>
          )}
        </>
      )}

      {/* ── STEP 5: LP ── */}
      {step === 5 && (
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
                <div className="font-heading font-semibold text-[15px] tracking-tight">Landingspagina configuratie</div>
                <div className="text-xs text-muted-foreground mt-[3px]">Stijl, lengte, tracking &amp; technisch</div>
              </div>
              <button className="pedro-btn-ghost text-[11px]" onClick={() => goTo(4)}>← Terug</button>
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
                  <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Meta Pixel ID</label>
                  <input type="text" placeholder="bv. 1234567890123456" value={pixelId} onChange={(e) => setPixelId(e.target.value)} />
                </div>
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Zapier Webhook URL</label>
                  <input type="text" placeholder="https://hooks.zapier.com/..." value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
                </div>
                <div className="flex flex-col gap-[5px] col-span-2">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">UTM structuur</label>
                  <input type="text" placeholder="utm_source=meta&utm_medium=paid&utm_campaign={{naam}}" value={utmStr} onChange={(e) => setUtmStr(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-[1.125rem] border-t border-border/60 mt-[1.125rem]">
              <div className="text-[11px] text-muted-foreground/60">Stap 5 van 6</div>
              <button className="pedro-btn-primary" onClick={doLP}>Genereer Lovable prompt →</button>
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
                    <button className="pedro-btn-ghost text-[11px]" onClick={doLP}>↻ Opnieuw</button>
                    <button className="pedro-btn-primary" onClick={doAdCopy}>Opslaan &amp; naar ad copy →</button>
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
              <div className="font-heading font-semibold text-[15px] tracking-tight">Ad copy</div>
              <div className="text-xs text-muted-foreground mt-[3px]">Meta &amp; Instagram advertentieteksten - afgestemd op de LP</div>
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
                <button className="pedro-btn-ghost text-[11px]" onClick={doAdCopy}>↻ Opnieuw</button>
                <div className="flex gap-2">
                  <button className="pedro-btn-ghost text-[11px]" onClick={generateAndDownloadClientMD}>Client MD</button>
                  <button className="pedro-btn-ghost text-[11px]" onClick={resetAll}>+ Nieuwe campagne</button>
                  <button className="pedro-btn-teal" onClick={() => { generateAndDownloadClientMD(); showToast("Campagne opgeslagen ✓"); }}>Opslaan & download MD</button>
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
