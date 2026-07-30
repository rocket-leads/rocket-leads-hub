"use client"

import { useMemo } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import type { ClientHealth } from "@/lib/integrations/health"
import type { MondayClient } from "@/lib/integrations/monday"
import { mondayStatusToHub } from "@/lib/clients/status"
import { cn } from "@/lib/utils"

/**
 * At-a-glance connection posture across the top of Settings, modelled on the
 * 187N reference hero ("4/5 channels connected", "1 key expired", "Secrets
 * loaded 18/21"). Replaces the old always-on ApiHealthBar — one place that
 * answers "is everything connected and working?", with each tile deep-linking
 * to the section that fixes it.
 *
 * Instant tiles (services, env) come from the server render. The two live
 * counts (clients needing linking, cron errors) are fetched client-side so the
 * page still paints in ~200ms; they fill in with a spinner.
 */

type ServicesSummary = { connected: number; total: number }
type EnvSummary = { loaded: number; total: number; criticalMissing: number }

type Tone = "ok" | "warn" | "error" | "idle"

export function SettingsPostureHero({
  services,
  env,
}: {
  services: ServicesSummary
  env: EnvSummary
}) {
  // Needs-linking must be scoped to the SAME population the Clients audit uses -
  // Live + Onboarding only (churned clients with blank IDs are by design and
  // would inflate the count, eroding trust in the number). We reuse the exact
  // query keys the Monday & Clients tab uses so the two dedupe + stay in sync.
  const clientsQuery = useQuery<{ clients: MondayClient[] }>({
    queryKey: ["admin-monday-clients"],
    queryFn: async () => {
      const r = await fetch("/api/admin/settings/monday-clients")
      if (!r.ok) throw new Error("Failed to load Monday clients")
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
  })
  const auditIds = useMemo(() => {
    const clients = clientsQuery.data?.clients ?? []
    return clients
      .filter((c) => {
        const hub = mondayStatusToHub(c.campaignStatus, c.boardType)
        return hub === "live" || hub === "onboarding"
      })
      .map((c) => c.mondayItemId)
  }, [clientsQuery.data])

  const auditQuery = useQuery<{ health: Record<string, ClientHealth> }>({
    queryKey: ["clients-connection-health", auditIds],
    queryFn: async () => {
      const res = await fetch("/api/integrations/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mondayItemIds: auditIds }),
      })
      if (!res.ok) throw new Error("audit failed")
      return res.json()
    },
    enabled: auditIds.length > 0,
    staleTime: 60 * 60 * 1000,
  })
  const needsLinking =
    clientsQuery.data && auditIds.length === 0
      ? 0
      : auditQuery.data
        ? auditIds.filter((id) => (auditQuery.data!.health[id]?.brokenCount ?? 0) > 0).length
        : null

  // Cron errors in the last 24h — cheap signal from the same endpoint the
  // System panel uses. Empty = healthy.
  const cronQuery = useQuery<{ errorRows: unknown[] }>({
    queryKey: ["posture-cron-health"],
    queryFn: async () => {
      const res = await fetch("/api/admin/health")
      if (!res.ok) throw new Error("health failed")
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })
  const cronErrors = cronQuery.data ? cronQuery.data.errorRows.length : null

  const servicesTone: Tone =
    services.connected >= services.total ? "ok" : services.total - services.connected > 0 ? "warn" : "idle"
  const envTone: Tone = env.criticalMissing > 0 ? "error" : env.loaded >= env.total ? "ok" : "warn"
  const linkingTone: Tone = needsLinking === null ? "idle" : needsLinking === 0 ? "ok" : "warn"
  const cronTone: Tone = cronErrors === null ? "idle" : cronErrors === 0 ? "ok" : "error"

  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile
        href="/settings?tab=integrations"
        label="Services connected"
        value={`${services.connected}/${services.total}`}
        tone={servicesTone}
      />
      <Tile
        href="/settings?tab=integrations"
        label="Env secrets loaded"
        value={`${env.loaded}/${env.total}`}
        sub={env.criticalMissing > 0 ? `${env.criticalMissing} critical missing` : undefined}
        tone={envTone}
      />
      <Tile
        href="/settings?tab=monday"
        label="Clients need linking"
        value={needsLinking === null ? null : String(needsLinking)}
        tone={linkingTone}
      />
      <Tile
        href="/settings?tab=integrations"
        label="Cron errors (24h)"
        value={cronErrors === null ? null : String(cronErrors)}
        tone={cronTone}
      />
    </div>
  )
}

function Tile({
  href,
  label,
  value,
  sub,
  tone,
}: {
  href: string
  label: string
  value: string | null
  sub?: string
  tone: Tone
}) {
  const dot =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-500"
        : tone === "error"
          ? "bg-destructive"
          : "bg-muted-foreground/30"
  return (
    <Link
      href={href}
      className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <div className="flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dot)} />
        <span className="st-label truncate">{label}</span>
      </div>
      <div className="mt-2 font-mono text-2xl leading-none">
        {value === null ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" /> : value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-destructive">{sub}</div>}
    </Link>
  )
}
