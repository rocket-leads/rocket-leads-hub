"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, ChevronDown, Loader2, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ClientInformationPanel } from "@/components/client-information-panel"
import { ConnectionStatusBar } from "@/components/connection-status-bar"
import { mondayStatusToHub, statusLabelI18n, statusTone, type ClientStatus } from "@/lib/clients/status"
import type { MondayClient } from "@/lib/integrations/monday"
import type { ClientHealth } from "@/lib/integrations/health"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"

type Props = {
  /** Optional pre-warmed clients list. When omitted, the tab fetches its
   *  own snapshot via `/api/admin/settings/monday-clients` so the parent
   *  page doesn't have to block on Monday's GraphQL pagination. */
  clients?: MondayClient[]
}

/** Tabs shown above the clients list. Onboarding lives on the dedicated
 *  Onboarding view, so we only surface the three "operational" statuses
 *  here - Live is the default because that's what 95% of edits target.
 *  "broken" is a synthetic filter - not a Hub status, just an audit lens
 *  that surfaces clients with ≥1 broken/missing required integration. */
type ListFilter = ClientStatus | "broken"
const STATUS_TABS: ClientStatus[] = ["live", "on_hold", "churned"]

/** How many of the 5 services actually resolve to a real entity (ok/warning).
 *  Zero linked + something missing = "nothing is connected yet", the signature
 *  of a freshly-duplicated Monday row that arrived with every ID blank. */
function linkedCount(h?: ClientHealth): number {
  if (!h) return 0
  return [h.stripe, h.meta, h.monday, h.trengo, h.drive].filter(
    (s) => s.state === "ok" || s.state === "warning",
  ).length
}

export function ClientsTab({ clients: clientsProp }: Props) {
  const locale = useLocale()
  const [listFilter, setListFilter] = useState<ListFilter>("live")
  const [search, setSearch] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)

  // Tab-local fetch - only fires when no pre-warmed list was passed. Shared
  // queryKey with UsersTab's mondayPeople query so the two tabs dedupe.
  const clientsQuery = useQuery<{ clients: MondayClient[]; mondayPeople: string[] }>({
    queryKey: ["admin-monday-clients"],
    queryFn: async () => {
      const r = await fetch("/api/admin/settings/monday-clients")
      if (!r.ok) throw new Error("Failed to load Monday clients")
      return r.json()
    },
    enabled: !clientsProp,
    staleTime: 5 * 60 * 1000,
  })
  const clients = clientsProp ?? clientsQuery.data?.clients ?? []
  const isLoadingClients = !clientsProp && clientsQuery.isLoading

  // Pre-compute Hub status per client once so the tab counts and the list
  // share the same classification - no chance of a count saying "5 churned"
  // while the list shows 6 due to a re-classification mismatch.
  const withStatus = useMemo(
    () => clients.map((c) => ({ client: c, hubStatus: mondayStatusToHub(c.campaignStatus, c.boardType) })),
    [clients],
  )

  const counts = useMemo(() => {
    const out: Record<ClientStatus, number> = { onboarding: 0, live: 0, on_hold: 0, churned: 0 }
    for (const { hubStatus } of withStatus) {
      if (hubStatus) out[hubStatus]++
    }
    return out
  }, [withStatus])

  // Connection-health audit. Backs the needs-linking badges, the per-row
  // 5-dot statusbar, and the "Needs linking (N)" filter tab.
  //
  // Audits LIVE + ONBOARDING clients. Onboarding is where the missing-codes
  // pain is worst (AM forgets to paste an ID during setup; a duplicated Monday
  // row arrives with every ID blank), so it must be in the audit even though it
  // has its own view. Churned clients are excluded (offboarded by design), and
  // on_hold aren't running campaigns so a stale link there isn't actionable.
  const auditIds = useMemo(
    () =>
      withStatus
        .filter(({ hubStatus }) => hubStatus === "live" || hubStatus === "onboarding")
        .map(({ client }) => client.mondayItemId),
    [withStatus],
  )
  const healthQuery = useQuery<{ health: Record<string, ClientHealth> }>({
    queryKey: ["clients-connection-health", auditIds],
    queryFn: async () => {
      const r = await fetch("/api/integrations/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mondayItemIds: auditIds }),
      })
      if (!r.ok) throw new Error("Failed to load connection health")
      return r.json()
    },
    enabled: auditIds.length > 0,
    // Long staleTime - the underlying lib already caches per-client for
    // 1h. The UI just needs to re-render when the user navigates back.
    staleTime: 60 * 60 * 1000,
  })
  // useMemo'd so the empty-fallback `{}` keeps a stable reference between
  // renders - the downstream useMemos that depend on this are eager about
  // re-running on any input change. Without this wrapper they'd recompute
  // on every render, which lint correctly flags.
  const healthByClient = useMemo(
    () => healthQuery.data?.health ?? {},
    [healthQuery.data],
  )

  const brokenCount = useMemo(
    () =>
      auditIds.filter((id) => (healthByClient[id]?.brokenCount ?? 0) > 0).length,
    [auditIds, healthByClient],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return withStatus
      .filter(({ client, hubStatus }) => {
        if (listFilter === "broken") {
          // Cross-status "needs linking" lens: live + onboarding clients with
          // ≥1 broken or missing (empty + not N/A) required service. Health may
          // still be loading for some entries - skip them until data arrives;
          // the count badge re-renders when it does.
          if (hubStatus !== "live" && hubStatus !== "onboarding") return false
          return (healthByClient[client.mondayItemId]?.brokenCount ?? 0) > 0
        }
        return hubStatus === listFilter
      })
      .filter(({ client }) => {
        if (!q) return true
        return (
          client.name.toLowerCase().includes(q) ||
          client.firstName.toLowerCase().includes(q) ||
          client.companyName.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        // Needs-linking first everywhere: a client with broken/missing links
        // floats to the top of whatever list you're in, so nothing rots
        // unnoticed. Then brokenCount desc (worst first), then alpha.
        const aBroken = healthByClient[a.client.mondayItemId]?.brokenCount ?? 0
        const bBroken = healthByClient[b.client.mondayItemId]?.brokenCount ?? 0
        if (aBroken > 0 !== bBroken > 0) return aBroken > 0 ? -1 : 1
        if (aBroken !== bBroken) return bBroken - aBroken
        return a.client.name.localeCompare(b.client.name)
      })
  }, [withStatus, listFilter, search, healthByClient])

  return (
    <div className="space-y-4">
      <h2 className="section-title mb-4">{t("settings.clients.title", locale)}</h2>

      {/* Status tabs - default Live so the rolodex of churned clients
          isn't the first thing the admin sees. The Broken filter sits to
          the right and is destructive-tinted when N>0, so it pulls the
          eye whenever there's something to fix. */}
      <div className="flex items-center gap-1 border-b border-border/40">
        {STATUS_TABS.map((status) => {
          const active = listFilter === status
          const tone = statusTone(status)
          return (
            <button
              key={status}
              type="button"
              onClick={() => {
                setListFilter(status)
                setOpenId(null)
              }}
              className={cn(
                "relative inline-flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground/70 hover:text-foreground",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
              {statusLabelI18n(status, locale)}
              <span className="text-[10px] tabular-nums text-muted-foreground/60">
                {counts[status]}
              </span>
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => {
            setListFilter("broken")
            setOpenId(null)
          }}
          className={cn(
            "relative ml-auto inline-flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors",
            listFilter === "broken"
              ? "text-destructive"
              : brokenCount > 0
                ? "text-destructive/70 hover:text-destructive"
                : "text-muted-foreground/70 hover:text-foreground",
          )}
          title={
            healthQuery.isLoading
              ? "Auditing connections…"
              : brokenCount === 0
                ? "Every live & onboarding client is linked or marked N/A"
                : `${brokenCount} live/onboarding client${brokenCount === 1 ? "" : "s"} with a missing or broken connection`
          }
        >
          <AlertTriangle className="h-3 w-3" />
          Needs linking
          {healthQuery.isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : (
            <span className="text-[10px] tabular-nums text-muted-foreground/60">
              {brokenCount}
            </span>
          )}
          {listFilter === "broken" && (
            <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-destructive" />
          )}
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
        <Input
          placeholder={t("settings.clients.search", locale)}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>

      {isLoadingClients && (
        <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5 px-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading clients…
        </div>
      )}

      <div className="space-y-2">
        {filtered.map(({ client, hubStatus }) => {
          const isOpen = openId === client.mondayItemId
          const tone = statusTone(hubStatus)
          // Show the statusbar for clients we audited (live + onboarding).
          // For on_hold/churned the dots would be "loading skeleton" forever,
          // which is more visual noise than signal.
          const showHealth = hubStatus === "live" || hubStatus === "onboarding"
          const health = healthByClient[client.mondayItemId]
          // Nothing linked yet + something missing = likely a freshly-
          // duplicated row that arrived blank. Flag it so the AM links it
          // instead of it silently rotting.
          const isUnlinked = showHealth && !!health && health.brokenCount > 0 && linkedCount(health) === 0

          return (
            <div
              key={client.mondayItemId}
              className="rounded-md border border-border/60 bg-card overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : client.mondayItemId)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-medium text-sm truncate">{client.name}</span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium shrink-0 ${tone.pill}`}
                  >
                    <span className={`h-1 w-1 rounded-full ${tone.dot}`} />
                    {statusLabelI18n(hubStatus, locale)}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 shrink-0">
                    {client.boardType}
                  </span>
                  {showHealth && (
                    <ConnectionStatusBar
                      health={health}
                      loading={!health && healthQuery.isLoading}
                    />
                  )}
                  {isUnlinked && (
                    <span
                      className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive shrink-0"
                      title="No services linked yet - if this row was duplicated from another client, link its IDs (or mark N/A)."
                    >
                      <AlertTriangle className="h-2.5 w-2.5" />
                      Unlinked · possible duplicate
                    </span>
                  )}
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
              {isOpen && (
                <div className="border-t border-border/50 px-4 py-4 bg-muted/10">
                  <ClientInformationPanel client={client} />
                </div>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {listFilter === "broken"
              ? healthQuery.isLoading
                ? "Auditing connections…"
                : "Everything is linked or marked N/A - nothing needs attention."
              : t("settings.clients.empty", locale, {
                  status: statusLabelI18n(listFilter, locale).toLowerCase(),
                  searchSuffix: search ? t("settings.clients.empty_search_suffix", locale) : "",
                })}
          </p>
        )}
      </div>
    </div>
  )
}
