"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { CheckCircle2, AlertCircle, Sparkles, Clock, ExternalLink, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Settings → Pedro tab. Admin-only observability for the kick-off
 * auto-trigger pipeline. Reads /api/pedro/health (admin-only too) and
 * surfaces:
 *   - 7d kick-offs ingested vs Pedro fires (the funnel)
 *   - List of recent fires with assignee + status
 *   - List of "missed" — linked kick-offs without a corresponding Pedro
 *     fire (could be legit skips or bugs; surfaced for inspection)
 */

type HealthResponse = {
  window: { since: string; days: number }
  summary: {
    kickoffsIngested: number
    kickoffsLinked: number
    kickoffsUnlinked: number
    pedroFires: number
    kickoffsWithoutFire: number
    evalsIngested: number
    evalsLinked: number
    evalDigestsFired: number
    evalDigestsHigh: number
    evalDigestsMedium: number
    evalDigestsLow: number
  }
  fires: Array<{
    id: string
    clientId: string | null
    clientName: string
    title: string | null
    assignee: string | null
    status: string | null
    meetingId: string | null
    fathomRecordingId: string | null
    createdAt: string
  }>
  evalDigests: Array<{
    id: string
    clientId: string | null
    clientName: string
    title: string | null
    severity: "high" | "medium" | "low"
    suggestedAction: string
    assignee: string | null
    status: string | null
    meetingId: string | null
    createdAt: string
  }>
  missed: Array<{
    meetingId: string
    clientId: string | null
    clientName: string
    scheduledAt: string | null
    title: string | null
  }>
  error?: string
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function StatTile({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: number | string
  tone?: "default" | "good" | "warn" | "bad"
  hint?: string
}) {
  const colors =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "bad"
          ? "text-red-600 dark:text-red-400"
          : "text-foreground"
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4 space-y-1">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
        {label}
      </div>
      <div className={`text-2xl font-heading font-semibold tabular-nums ${colors}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground/70">{hint}</div>}
    </div>
  )
}

export function PedroSettingsTab() {
  const { data, isLoading, error } = useQuery<HealthResponse>({
    queryKey: ["pedro-health"],
    queryFn: () => fetch("/api/pedro/health").then((r) => r.json()),
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  if (error || !data || data.error) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4" />
          Pedro health niet beschikbaar — {data?.error || (error instanceof Error ? error.message : "onbekende fout")}
        </CardContent>
      </Card>
    )
  }

  const s = data.summary
  // Health verdict: linked kick-offs that all converted to fires = healthy
  // (or no kick-offs at all = neutral). Linked kick-offs without fires
  // could be legit (CM already started Pedro pre-kick-off) but worth
  // flagging when the gap is meaningful.
  const isHealthy = s.kickoffsLinked === 0 || s.pedroFires >= s.kickoffsLinked
  const isDegraded = s.kickoffsLinked > 0 && s.pedroFires === 0
  const conversionPct =
    s.kickoffsLinked > 0 ? Math.round((s.pedroFires / s.kickoffsLinked) * 100) : null

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Pedro pipeline (last 7d)
          </CardTitle>
          <CardDescription>
            Kick-off auto-trigger health. Admin-only. Polled every 60s.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile
              label="Kick-offs ingested"
              value={s.kickoffsIngested}
              hint={s.kickoffsUnlinked > 0 ? `${s.kickoffsUnlinked} unlinked` : "all linked"}
            />
            <StatTile
              label="Linked to client"
              value={s.kickoffsLinked}
              hint="trigger-eligible"
            />
            <StatTile
              label="Pedro auto-fires"
              value={s.pedroFires}
              tone={isHealthy ? "good" : isDegraded ? "bad" : "default"}
              hint={
                conversionPct != null
                  ? `${conversionPct}% conversion${s.kickoffsWithoutFire > 0 ? ` · ${s.kickoffsWithoutFire} not fired` : ""}`
                  : "no kick-offs in window"
              }
            />
            <StatTile
              label="Status"
              value={isHealthy ? "Healthy" : isDegraded ? "Degraded" : "OK"}
              tone={isHealthy ? "good" : isDegraded ? "bad" : "warn"}
            />
          </div>

          {isDegraded && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium text-red-600 dark:text-red-400">
                  Pedro fired niet voor de afgelopen 7 dagen aan kick-offs
                </div>
                <div className="text-muted-foreground mt-0.5">
                  Mogelijk hebben de klanten al een eerdere `pedro_client_state` row (geen rerun-rule),
                  of er is een bug. Check de server logs of inspecteer de "missed" lijst hieronder.
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Eval digest funnel — separate card so it's clear that low conversion is normal */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Eval digest pipeline (last 7d)
          </CardTitle>
          <CardDescription>
            Pedro leest elke evaluatie en flagt alleen wanneer Claude iets actionable detecteert.
            Lage conversion is normaal — routine evals produceren geen task.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="Evals ingested" value={s.evalsIngested} hint={`${s.evalsLinked} linked`} />
            <StatTile
              label="Digests fired"
              value={s.evalDigestsFired}
              hint={
                s.evalsLinked > 0
                  ? `${Math.round((s.evalDigestsFired / s.evalsLinked) * 100)}% actionable`
                  : "no evals in window"
              }
            />
            <StatTile
              label="High severity"
              value={s.evalDigestsHigh}
              tone={s.evalDigestsHigh > 0 ? "bad" : "default"}
              hint="needs CM attention"
            />
            <StatTile
              label="Medium / low"
              value={`${s.evalDigestsMedium} / ${s.evalDigestsLow}`}
            />
          </div>

          {data.evalDigests.length > 0 && (
            <div className="mt-4 divide-y divide-border/60">
              {data.evalDigests.map((d) => {
                const sevColor =
                  d.severity === "high"
                    ? "text-red-600 dark:text-red-400"
                    : d.severity === "medium"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground"
                return (
                  <div key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[10px] uppercase tracking-[0.1em] font-semibold ${sevColor}`}>
                          {d.severity}
                        </span>
                        <span className="font-medium text-sm truncate">{d.clientName}</span>
                        <span className="text-[10px] text-muted-foreground/60">
                          → {d.suggestedAction.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{d.title}</div>
                    </div>
                    <div className="text-xs text-muted-foreground/70 shrink-0">{fmtDateTime(d.createdAt)}</div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent fires */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent kick-off fires ({data.fires.length})</CardTitle>
          <CardDescription>Pedro auto-trigger taken die naar de CM zijn gestuurd.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.fires.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
              Geen Pedro auto-fires in dit window.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {data.fires.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <span className="font-medium text-sm truncate">{f.clientName}</span>
                      <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/50">
                        {f.status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                      <Clock className="h-3 w-3" />
                      {fmtDateTime(f.createdAt)}
                      {f.assignee && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <span>→ {f.assignee}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {f.clientId && (
                    <Link
                      href={`/pedro?tab=brief&clientId=${f.clientId}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                    >
                      Open <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Missed */}
      {data.missed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              Kick-offs zonder Pedro fire ({data.missed.length})
            </CardTitle>
            <CardDescription>
              Gekoppelde kick-offs uit de afgelopen 7d die geen auto-fire hebben getriggerd. Vaak legit (CM had Pedro al gestart vóór de kick-off), maar inspecteer als de aantallen hoog zijn.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border/60">
              {data.missed.map((m) => (
                <div key={m.meetingId} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-sm truncate">{m.clientName}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {fmtDateTime(m.scheduledAt)} · {m.title ?? "—"}
                    </div>
                  </div>
                  {m.clientId && (
                    <Link
                      href={`/clients/${m.clientId}`}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
                    >
                      Klant <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
