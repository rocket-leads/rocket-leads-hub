"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { StageActionBar } from "./stage-action-bar";
import { saveIfChanged } from "@/lib/pedro/save-if-changed";

interface AdResult {
  title: string;
  body: string;
  hook?: string;
  source: string;
  insight: string;
}

interface ResearchPayload {
  branche: string;
  doelgroep: string;
  propositie: string;
  insights: {
    winningAngles: string[];
    commonHooks: string[];
    visualPatterns: string[];
    cta_styles: string[];
    pricingStrategies: string[];
    socialProofTactics: string[];
  };
  exampleAds: AdResult[];
  recommendations: string[];
}

interface SavedResearch {
  id: string;
  branche: string;
  klantnaam: string;
  label: string;
  doelgroep: string;
  propositie: string;
  extraContext: string;
  research: ResearchPayload;
  savedAt: string;
}

function Spinner({ text, sub }: { text: string; sub: string }) {
  return (
    <div className="flex flex-col items-center py-10 gap-2.5">
      <div className="w-7 h-7 border-2 border-border border-t-primary rounded-full animate-[spin_0.7s_linear_infinite]" />
      <div className="text-sm text-muted-foreground">{text}</div>
      <div className="text-xs text-muted-foreground/60">{sub}</div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className={`inline-flex items-center h-6 px-2 text-[10px] font-medium bg-background border rounded-md cursor-pointer transition-colors whitespace-nowrap ${
        copied
          ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/40"
          : "text-muted-foreground hover:text-foreground hover:bg-accent border-border"
      }`}
    >
      {copied ? "Gekopieerd" : "Kopieer"}
    </button>
  );
}

type ResearchProps = {
  /** Active client from the global Pedro picker. When set, all research
   *  saved in this session is bound to that client. When null, research
   *  saves to the agency-wide library (legacy behaviour). */
  clientId: string | null
  /** Display name of the active client — used to default the klantnaam
   *  field and label saved entries. */
  clientName: string
  /** Active Pedro campaign number — research saves are scoped per
   *  campaign so different campaigns for the same client can hold
   *  different research snapshots. Defaults to 1 for back-compat. */
  campaignNumber?: number
  /** Optional sector pre-fill when the user arrives from Brief — saves
   *  re-typing what's already in the brief. */
  defaultBranche?: string
  /** Continue to the next stage (Angles) — wired by PedroApp. */
  onContinue?: () => void
}

export function Research({ clientId, clientName, campaignNumber = 1, defaultBranche, onContinue }: ResearchProps) {
  const [branche, setBranche] = useState(defaultBranche ?? "");
  const [klantnaam, setKlantnaam] = useState(clientName);

  // Sync branche from the active client's brief when arriving from Brief.
  // Only updates while the field is empty so we don't overwrite user input.
  useEffect(() => {
    if (defaultBranche && !branche.trim()) setBranche(defaultBranche);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultBranche]);

  // Auto-pre-fill branche from the active client's saved brief sector,
  // so arriving from Brief feels seamless. Only fires while the field
  // is empty — never overwrites what the user typed.
  useEffect(() => {
    if (!clientId) return;
    if (branche.trim()) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/pedro/client-state?clientId=${encodeURIComponent(clientId)}`);
        if (!res.ok) return;
        const data = await res.json();
        const sector = data?.state?.brief?.sector ?? "";
        if (!cancelled && sector && !branche.trim()) setBranche(sector);
        // Also pull doelgroep + propositie if Research's fields are empty
        const doel = data?.state?.brief?.doel ?? "";
        if (!cancelled && doel && !doelgroep.trim()) setDoelgroep(doel);
        const aanbod = data?.state?.brief?.aanbod ?? "";
        if (!cancelled && aanbod && !propositie.trim()) setPropositie(aanbod);
      } catch {
        /* silent */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  const [doelgroep, setDoelgroep] = useState("");
  const [propositie, setPropositie] = useState("");
  const [extraContext, setExtraContext] = useState("");

  // Sync klantnaam to the global picker when the active client changes.
  useEffect(() => {
    setKlantnaam(clientName);
  }, [clientName]);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<ResearchPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Library
  const [library, setLibrary] = useState<SavedResearch[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterBranche, setFilterBranche] = useState("");

  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  // Load library on mount
  useEffect(() => {
    loadLibrary();
  }, []);

  async function loadLibrary() {
    setLibraryLoading(true);
    try {
      // When a client is active, scope the library list to that client
      // first — Roy's directive: per-client environment. Empty fallback
      // to agency-wide is documented in the API.
      const url = clientId
        ? `/api/pedro/research/library?clientId=${encodeURIComponent(clientId)}`
        : "/api/pedro/research/library";
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok) setLibrary(data.items || []);
    } catch { /* silent */ }
    setLibraryLoading(false);
  }

  // Re-load library when active client changes — keeps the visible
  // saved-research list in sync with the current client.
  useEffect(() => {
    loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function runResearch() {
    if (!branche.trim()) {
      showToast("Vul minimaal de branche in");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setSavedId(null);
    setProgress("Bezig met onderzoek...");

    try {
      const res = await fetch("/api/pedro/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branche, doelgroep, propositie, extraContext }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || "Onderzoek mislukt");
        return;
      }
      setResult(data.research);
      showToast("Research afgerond -- vergeet niet op te slaan");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "onbekende fout";
      setError(msg);
    } finally {
      setLoading(false);
      setProgress("");
    }
  }

  async function saveResearch() {
    if (!result || !branche) return;
    setSaving(true);
    try {
      const res = await fetch("/api/pedro/research/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branche,
          klantnaam,
          label: klantnaam || branche,
          doelgroep,
          propositie,
          extraContext,
          research: result,
          // When a client is active, bind the saved entry to them so the
          // research lives in that client's environment alongside brief
          // / angles / scripts / etc.
          clientId: clientId ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        showToast(data.error || "Opslaan mislukt");
      } else {
        setSavedId(data.id);
        showToast(
          clientId
            ? `Opgeslagen bij ${clientName || "klant"}`
            : "Opgeslagen in bibliotheek",
        );
        loadLibrary();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "fout";
      showToast(`Opslaan mislukt: ${msg}`);
    }
    setSaving(false);
  }

  function loadFromLibrary(item: SavedResearch) {
    setBranche(item.branche);
    setKlantnaam(item.klantnaam || "");
    setDoelgroep(item.doelgroep || "");
    setPropositie(item.propositie || "");
    setExtraContext(item.extraContext || "");
    setResult(item.research);
    setSavedId(item.id);
    setError(null);
    setLibraryOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast(`Geladen: ${item.klantnaam || item.branche}`);
  }

  async function deleteFromLibrary(id: string, name: string) {
    if (!confirm(`Verwijder "${name}" uit de bibliotheek?`)) return;
    try {
      const res = await fetch(`/api/pedro/research/library?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Verwijderd");
        loadLibrary();
        if (savedId === id) setSavedId(null);
      } else {
        showToast("Verwijderen mislukt");
      }
    } catch {
      showToast("Verwijderen mislukt");
    }
  }

  function downloadResearchMD() {
    if (!result) return;
    const md = buildResearchMD(result, { branche, klantnaam, doelgroep, propositie });
    const slug = (klantnaam || branche || "research").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-research.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Research MD gedownload");
  }

  // Group library by branche
  const libraryGrouped = library.reduce<Record<string, SavedResearch[]>>((acc, item) => {
    const key = item.branche || "Overig";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
  const filtered = filterBranche
    ? Object.fromEntries(Object.entries(libraryGrouped).filter(([k]) => k.toLowerCase().includes(filterBranche.toLowerCase())))
    : libraryGrouped;

  return (
    <div className="flex-1 p-7 max-w-[1060px]">
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-4 py-2 bg-card border border-primary/30 rounded-lg text-[12px] text-foreground shadow-lg">
          {toast}
        </div>
      )}

      {/* Save bar — same pattern as Brief / Angles / Script / etc. so the
          version-tracking story is consistent across stages. Hidden when
          no client is selected (the agency-wide research library still
          works via the legacy "Opslaan in bibliotheek" button below). */}
      <StageActionBar
        clientId={clientId}
        stage="research"
        campaignNumber={campaignNumber}
        getCurrentData={() => ({
          branche,
          klantnaam,
          doelgroep,
          propositie,
          extraContext,
          research: result,
        })}
        busy={loading || saving}
      />

      {/* Library card */}
      <div className="bg-card border border-border/60 rounded-xl mb-5 overflow-hidden">
        <div
          className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-[rgba(255,255,255,0.02)] transition-all"
          onClick={() => setLibraryOpen(!libraryOpen)}
        >
          <div className="flex items-center gap-3">
            <div className="font-heading font-semibold text-base tracking-tight">Research bibliotheek</div>
            <span className="text-[10px] uppercase tracking-[0.5px] text-primary bg-primary/10 border border-primary/30 px-2 py-0.5 rounded-full">
              {library.length} {library.length === 1 ? "item" : "items"}
            </span>
          </div>
          <span className="text-muted-foreground/60 text-sm">{libraryOpen ? "▲" : "▼"}</span>
        </div>

        {libraryOpen && (
          <div className="px-6 pb-5 border-t border-border/60">
            <div className="flex items-center gap-2 mt-3 mb-3">
              <input
                type="text"
                placeholder="Filter op branche..."
                value={filterBranche}
                onChange={(e) => setFilterBranche(e.target.value)}
                className="!text-[12px]"
                style={{ maxWidth: 280 }}
              />
              <Button variant="outline" size="sm" onClick={loadLibrary} disabled={libraryLoading}>
                {libraryLoading ? "..." : "↻ Herlaad"}
              </Button>
            </div>

            {library.length === 0 ? (
              <div className="text-[11.5px] text-muted-foreground/60 py-3 text-center">
                Nog geen opgeslagen research. Doe een research en klik &quot;Opslaan&quot; om deze hier op te slaan.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {Object.entries(filtered).map(([branche, items]) => (
                  <div key={branche}>
                    <div className="text-[10px] uppercase tracking-[0.9px] text-primary font-semibold mb-1.5">
                      {branche} <span className="text-muted-foreground/60 ml-1 normal-case tracking-normal">({items.length})</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className={`bg-muted/40 border rounded-lg px-3 py-2 flex items-center justify-between gap-3 transition-all ${
                            savedId === item.id ? "border-emerald-500/40" : "border-border/60"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-[12.5px] font-medium text-foreground truncate">
                              {item.klantnaam || item.label || "Naamloos"}
                            </div>
                            <div className="text-[10.5px] text-muted-foreground/60 truncate">
                              {item.propositie || item.doelgroep || "geen extra info"}
                              <span className="ml-2 text-muted-foreground/60">
                                · {new Date(item.savedAt).toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "numeric" })}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => loadFromLibrary(item)}
                              className="text-[10px] px-2 py-1 bg-card border border-border/60 rounded text-muted-foreground hover:text-primary hover:border-primary/40 cursor-pointer transition-all"
                            >
                              Laden
                            </button>
                            <button
                              onClick={() => deleteFromLibrary(item.id, item.klantnaam || item.label || item.branche)}
                              className="text-[10px] px-2 py-1 bg-transparent border border-border/60 rounded text-muted-foreground/60 hover:text-[#ff8080] hover:border-[rgba(255,80,80,0.25)] cursor-pointer transition-all"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input card */}
      <div className="bg-card border border-primary/30 rounded-2xl p-6 mb-5 ring-1 ring-primary/20">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="font-heading font-semibold text-base tracking-tight">Research</div>
            <div className="text-xs text-muted-foreground mt-[3px]">
              Onderzoek winnende campagnes in deze branche of voor deze propositie
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-[0.875rem]">
          <div className="flex flex-col gap-[5px]">
            <label className="text-xs font-medium text-muted-foreground">Branche / sector *</label>
            <input
              type="text"
              placeholder="bv. Loodgieters, Vloerlegging"
              value={branche}
              onChange={(e) => setBranche(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-[5px]">
            <label className="text-xs font-medium text-muted-foreground">Klantnaam (optioneel)</label>
            <input
              type="text"
              placeholder="bv. Solution Afbouw Group"
              value={klantnaam}
              onChange={(e) => setKlantnaam(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-[5px]">
            <label className="text-xs font-medium text-muted-foreground">Doelgroep</label>
            <input
              type="text"
              placeholder="bv. Huiseigenaren 30-65, B2C NL"
              value={doelgroep}
              onChange={(e) => setDoelgroep(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-[5px]">
            <label className="text-xs font-medium text-muted-foreground">Propositie</label>
            <input
              type="text"
              placeholder="bv. Snel & betaalbaar, Premium maatwerk"
              value={propositie}
              onChange={(e) => setPropositie(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-[5px] col-span-2">
            <label className="text-xs font-medium text-muted-foreground">Extra context (optioneel)</label>
            <textarea
              style={{ minHeight: 60 }}
              placeholder="Specifieke USPs, concurrenten, prijsklasse, regio..."
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-[1.125rem] border-t border-border/60 mt-[1.125rem]">
          <div className="text-[11px] text-muted-foreground/60">
            Pedro analyseert winnende ad-patronen in deze branche
          </div>
          <Button onClick={runResearch} disabled={loading}>
            {loading ? "Onderzoeken..." : "Start research →"}
          </Button>
        </div>
      </div>

      {loading && (
        <div className="bg-card border border-border/60 rounded-2xl p-6 mb-5">
          <Spinner text={progress || "Pedro doet onderzoek..."} sub="Dit duurt 20-40 seconden" />
        </div>
      )}

      {error && (
        <div className="bg-[rgba(255,80,80,0.06)] border border-[rgba(255,80,80,0.25)] rounded-xl p-4 mb-5 text-[12px] text-[#ff8080]">
          {error}
        </div>
      )}

      {result && (
        <>
          {/* Save bar */}
          <div className="bg-card border border-border/60 rounded-xl p-4 mb-5 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[12px] text-muted-foreground">
              {savedId ? (
                <span className="text-emerald-500">✓ Opgeslagen in bibliotheek</span>
              ) : (
                <>Wil je deze research bewaren voor later? Geef eventueel een klantnaam op.</>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!savedId && (
                <Button size="sm" onClick={saveResearch} disabled={saving}>
                  {saving ? "Opslaan..." : "💾 Opslaan in bibliotheek"}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={downloadResearchMD}>↓ Download .md</Button>
            </div>
          </div>

          {/* Insights */}
          <div className="bg-card border border-border/60 rounded-2xl p-6 mb-5">
            <div className="font-heading font-semibold text-base tracking-tight mb-4">Insights & patronen</div>

            <InsightSection title="Winnende angles" items={result.insights.winningAngles} accent="purple" />
            <InsightSection title="Veelgebruikte hooks" items={result.insights.commonHooks} accent="teal" />
            <InsightSection title="Visuele patronen" items={result.insights.visualPatterns} accent="purple" />
            <InsightSection title="CTA stijlen" items={result.insights.cta_styles} accent="teal" />
            <InsightSection title="Prijsstrategieën" items={result.insights.pricingStrategies} accent="purple" />
            <InsightSection title="Social proof tactieken" items={result.insights.socialProofTactics} accent="teal" />
          </div>

          {/* Example ads */}
          {result.exampleAds.length > 0 && (
            <div className="bg-card border border-border/60 rounded-2xl p-6 mb-5">
              <div className="font-heading font-semibold text-base tracking-tight mb-4">Voorbeeld ads</div>
              <div className="flex flex-col gap-3">
                {result.exampleAds.map((ad, i) => (
                  <div key={i} className="bg-muted/40 border border-border/60 rounded-lg p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="font-heading font-bold text-[13.5px] flex-1">{ad.title}</div>
                      <CopyButton text={`${ad.title}\n\n${ad.body}\n\nCTA: ${ad.hook || ""}`} />
                    </div>
                    <div className="text-[12px] text-muted-foreground leading-[1.6] mb-2 whitespace-pre-wrap">{ad.body}</div>
                    {ad.hook && (
                      <div className="text-[11px] text-primary mb-2">Hook: &quot;{ad.hook}&quot;</div>
                    )}
                    <div className="text-[10px] text-muted-foreground/60 border-t border-border/60 pt-2 mt-2 leading-[1.5]">
                      <span className="text-emerald-500 font-semibold uppercase tracking-[0.5px]">Insight:</span> {ad.insight}
                    </div>
                    <div className="text-[9.5px] text-muted-foreground/60 mt-1">Bron: {ad.source}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {result.recommendations.length > 0 && (
            <div className="bg-gradient-to-br from-primary/10 to-emerald-500/5 border border-primary/30 rounded-2xl p-6 mb-5">
              <div className="font-heading font-semibold text-base tracking-tight mb-3">Pedro&apos;s aanbevelingen</div>
              <ol className="flex flex-col gap-2 pl-5 list-decimal text-[12.5px] text-foreground leading-[1.6]">
                {result.recommendations.map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ol>
            </div>
          )}

          {/* Save & continue to Angles — wired by PedroApp. Single click
              commits this research as a new version on the active client
              AND navigates. Tab-nav bovenin slaat niet op (escape hatch
              for "just go" without commit). */}
          {onContinue && (
            <div className="flex items-center justify-between pt-4 border-t border-border/60 mt-2">
              <p className="text-xs text-muted-foreground/60 italic max-w-md">
                Tab-nav bovenin slaat niet op
              </p>
              <Button
                onClick={async () => {
                  if (clientId && result) {
                    const r = await saveIfChanged({
                      clientId,
                      stage: "research",
                      campaignNumber,
                      data: { branche, klantnaam, doelgroep, propositie, extraContext, research: result },
                    });
                    if (r.saved) showToast(`✓ Opgeslagen als v${r.versionNumber}`);
                    else if (r.reason === "unchanged") showToast(`v${r.versionNumber} ongewijzigd — geen nieuwe versie`);
                  }
                  onContinue();
                }}
                disabled={!result}
                title={!result ? "Genereer eerst research" : undefined}
              >
                {clientId && result ? "Opslaan & naar angles →" : "Naar angles →"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InsightSection({ title, items, accent }: { title: string; items: string[]; accent: "purple" | "teal" }) {
  if (!items || items.length === 0) return null;
  const color = accent === "purple" ? "text-primary" : "text-emerald-500";
  return (
    <div className="mb-4 last:mb-0">
      <div className={`text-xs font-semibold mb-2 ${color}`}>{title}</div>
      <ul className="flex flex-col gap-1.5 pl-4 list-disc text-xs text-muted-foreground leading-relaxed">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function buildResearchMD(r: ResearchPayload, ctx: { branche: string; klantnaam: string; doelgroep: string; propositie: string }): string {
  const lines: string[] = [];
  lines.push(`# Research -- ${ctx.klantnaam || ctx.branche}`);
  lines.push("");
  lines.push(`**Branche:** ${ctx.branche}`);
  if (ctx.klantnaam) lines.push(`**Klant:** ${ctx.klantnaam}`);
  if (ctx.doelgroep) lines.push(`**Doelgroep:** ${ctx.doelgroep}`);
  if (ctx.propositie) lines.push(`**Propositie:** ${ctx.propositie}`);
  lines.push(`**Datum:** ${new Date().toISOString().split("T")[0]}`);
  lines.push("");
  lines.push("## Insights");
  const sec = (label: string, items: string[]) => {
    if (!items?.length) return;
    lines.push(`### ${label}`);
    items.forEach((i) => lines.push(`- ${i}`));
    lines.push("");
  };
  sec("Winnende angles", r.insights.winningAngles);
  sec("Veelgebruikte hooks", r.insights.commonHooks);
  sec("Visuele patronen", r.insights.visualPatterns);
  sec("CTA stijlen", r.insights.cta_styles);
  sec("Prijsstrategieën", r.insights.pricingStrategies);
  sec("Social proof tactieken", r.insights.socialProofTactics);

  if (r.exampleAds?.length) {
    lines.push("## Voorbeeld ads");
    r.exampleAds.forEach((ad, i) => {
      lines.push(`### ${i + 1}. ${ad.title}`);
      if (ad.hook) lines.push(`**Hook:** "${ad.hook}"`);
      lines.push(`**Body:** ${ad.body}`);
      lines.push(`**Bron:** ${ad.source}`);
      lines.push(`**Insight:** ${ad.insight}`);
      lines.push("");
    });
  }

  if (r.recommendations?.length) {
    lines.push("## Aanbevelingen");
    r.recommendations.forEach((rec, i) => lines.push(`${i + 1}. ${rec}`));
  }
  return lines.join("\n");
}
