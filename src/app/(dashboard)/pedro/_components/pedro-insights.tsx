"use client"

import { useQuery } from "@tanstack/react-query"
import { useState, useMemo } from "react"
import { TrendingUp, Layers, Users, Sparkles, Search, Image as ImageIcon, Video, Boxes } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Pedro Insights - agency-level knowledge browser.
 *
 * Reads pedro_vertical_patterns (refreshed nightly by cron) and lets the
 * team explore: "what's actually winning in [branche]?". Anonymised: no
 * client names, no per-client attribution - just patterns, winners,
 * format breakdowns.
 */

type WinnerEntry = {
  adName: string
  sourceClientName: string
  sourceSector: string
  cpl: number
  leads: number
  spend: number
  ctr: number
  body: string
  creativeType: "video" | "image" | "dynamic" | "unknown"
}

type AnglePattern = {
  angle: string
  frequency: number
  examples: string[]
}

type HookPattern = {
  hookType: string
  exampleOpener: string
  frequency: number
}

type VerticalRow = {
  vertical: string
  sector_aliases: string[]
  top_winners: WinnerEntry[]
  common_angles: AnglePattern[]
  common_hooks: HookPattern[]
  format_distribution: Record<string, number>
  sample_size: number
  client_count: number
  refreshed_at: string
  synthesised_at: string | null
}

type Response = {
  verticals: VerticalRow[]
  summary: {
    verticalCount: number
    totalWinners: number
    totalClients: number
    lastRefreshed: string | null
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "-"
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
}

function FormatIcon({ type }: { type: string }) {
  if (type === "video") return <Video className="h-3 w-3" />
  if (type === "image") return <ImageIcon className="h-3 w-3" />
  if (type === "dynamic") return <Boxes className="h-3 w-3" />
  return null
}

function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4 space-y-1">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
        {label}
      </div>
      <div className="text-2xl font-heading font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground/70">{hint}</div>}
    </div>
  )
}

export function PedroInsights() {
  const { data, isLoading, error } = useQuery<Response>({
    queryKey: ["pedro-insights"],
    queryFn: async () => {
      const r = await fetch("/api/pedro/insights")
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json?.error || `Request failed (${r.status})`)
      return json
    },
    staleTime: 5 * 60 * 1000,
  })

  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!data?.verticals) return []
    const q = query.trim().toLowerCase()
    if (!q) return data.verticals
    return data.verticals.filter(
      (v) =>
        v.vertical.toLowerCase().includes(q) ||
        v.sector_aliases.some((s) => s.toLowerCase().includes(q)),
    )
  }, [data, query])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Insights niet beschikbaar - {error instanceof Error ? error.message : "onbekende fout"}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="max-w-[1060px] space-y-5">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Pedro Insights - agency-level knowledge
          </CardTitle>
          <CardDescription>
            Wat werkt agency-breed in elke branche? Pattern library wordt nachtelijk gerefreshed (04:00) op basis van laagste CPL t.o.v. account-gemiddelde, last 30d. Geanonimiseerd - geen klantnamen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="Verticals" value={data.summary.verticalCount} />
            <StatTile label="Total winners" value={data.summary.totalWinners} />
            <StatTile label="Contributing clients" value={data.summary.totalClients} />
            <StatTile
              label="Last refresh"
              value={fmtDate(data.summary.lastRefreshed)}
              hint="cron 04:00 daily"
            />
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      {data.verticals.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Zoek branche..."
            className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground"
            style={{ height: "2.25rem", border: "1px solid var(--input)" }}
          />
        </div>
      )}

      {/* Empty state */}
      {data.verticals.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <Layers className="h-8 w-8 text-muted-foreground/30 mx-auto" />
            <div className="text-sm text-muted-foreground">
              Nog geen vertical patterns gevuld.
            </div>
            <div className="text-xs text-muted-foreground/70">
              Wacht op de eerstvolgende cron (04:00) of trigger handmatig via{" "}
              <code className="text-[11px] px-1 py-0.5 bg-muted rounded">
                /api/cron/refresh-pedro-patterns
              </code>{" "}
              (admin).
            </div>
          </CardContent>
        </Card>
      )}

      {/* Verticals */}
      {filtered.map((v) => {
        const isOpen = expanded === v.vertical
        return (
          <Card key={v.vertical}>
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : v.vertical)}
              className="w-full text-left"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base capitalize flex items-center gap-2">
                      {v.vertical}
                      <span className="text-xs font-normal text-muted-foreground">
                        ({v.client_count} klanten · {v.sample_size} winners)
                      </span>
                    </CardTitle>
                    {v.sector_aliases.length > 0 && (
                      <CardDescription className="mt-1">
                        {v.sector_aliases.slice(0, 4).join(" · ")}
                      </CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {Object.entries(v.format_distribution).map(([f, pct]) => (
                      <span
                        key={f}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-md"
                      >
                        <FormatIcon type={f} />
                        {(pct * 100).toFixed(0)}%
                      </span>
                    ))}
                  </div>
                </div>
              </CardHeader>
            </button>

            {isOpen && (
              <CardContent className="space-y-5 pt-0">
                {/* Angles */}
                {v.common_angles.length > 0 && (
                  <div>
                    <h4 className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-2 flex items-center gap-1.5">
                      <TrendingUp className="h-3 w-3" />
                      Winnende angles
                    </h4>
                    <div className="space-y-2">
                      {v.common_angles.map((a, i) => (
                        <div key={i} className="rounded-lg border border-border/60 bg-background p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm">{a.angle}</span>
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {a.frequency}× winner
                            </span>
                          </div>
                          {a.examples.length > 0 && (
                            <ul className="mt-2 space-y-1 text-xs text-muted-foreground italic">
                              {a.examples.slice(0, 2).map((ex, j) => (
                                <li key={j}>&ldquo;{ex}&rdquo;</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Hooks */}
                {v.common_hooks.length > 0 && (
                  <div>
                    <h4 className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-2">
                      Hook-patronen
                    </h4>
                    <div className="space-y-2">
                      {v.common_hooks.map((h, i) => (
                        <div key={i} className="rounded-lg border border-border/60 bg-background p-3">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-medium text-sm">{h.hookType}</span>
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {h.frequency}× winner
                            </span>
                          </div>
                          <p className="text-sm text-foreground/90 italic">
                            &ldquo;{h.exampleOpener}&rdquo;
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top winners (anonymised) */}
                {v.top_winners.length > 0 && (
                  <div>
                    <h4 className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-2">
                      Top winners (anoniem)
                    </h4>
                    <div className="space-y-2">
                      {v.top_winners.slice(0, 5).map((w, i) => (
                        <div key={i} className="rounded-lg border border-border/60 bg-background p-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground/80 italic">
                              {w.sourceSector}
                            </span>
                            <div className="flex items-center gap-3 tabular-nums">
                              <span className="text-foreground font-medium">€{w.cpl.toFixed(2)} CPL</span>
                              <span className="text-muted-foreground">{w.leads} leads</span>
                              <span className="text-muted-foreground">{w.ctr.toFixed(2)}% CTR</span>
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <FormatIcon type={w.creativeType} />
                                {w.creativeType}
                              </span>
                            </div>
                          </div>
                          <p className="text-sm text-foreground/90 line-clamp-3">{w.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {v.common_angles.length === 0 && v.common_hooks.length === 0 && (
                  <div className="text-xs text-muted-foreground/70 italic">
                    Synthesis nog niet uitgevoerd (te weinig winners of Claude faalde) - winners zijn er wel.
                  </div>
                )}

                <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground/60">
                  <span>Refreshed {fmtDate(v.refreshed_at)}</span>
                  {v.synthesised_at && <span>Synthesised {fmtDate(v.synthesised_at)}</span>}
                </div>
              </CardContent>
            )}
          </Card>
        )
      })}

      {filtered.length === 0 && data.verticals.length > 0 && (
        <div className="text-sm text-muted-foreground text-center py-8">
          Geen verticals matchen &ldquo;{query}&rdquo;.
        </div>
      )}

      <div className="text-[11px] text-muted-foreground/60 text-center pt-2 italic">
        CPL-driven · lead-quality validation komt zodra Monday lead-board normalisatie klaar is.
        <br />
        Zie <code>knowledge/campaigns.md</code> voor de volledige status note.
      </div>
    </div>
  )
}
