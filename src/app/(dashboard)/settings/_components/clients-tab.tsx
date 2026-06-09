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
 *  here — Live is the default because that's what 95% of edits target.
 *  "broken" is a synthetic filter — not a Hub status, just an audit lens
 *  that surfaces clients with ≥1 broken/missing required integration. */
type ListFilter = ClientStatus | "broken"
const STATUS_TABS: ClientStatus[] = ["live", "on_hold", "churned"]

export function ClientsTab({ clients: clientsProp }: Props) {
  const locale = useLocale()
  const [listFilter, setListFilter] = useState<ListFilter>("live")
  const [search, setSearch] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)

  // Tab-local fetch — only fires when no pre-warmed list was passed. Shared
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
  // share the same classification — no chance of a count saying "5 churned"
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

  // Connection-health audit. Backs the broken-count badges, the per-row
  // 5-dot statusbar, and the "Broken connections (N)" filter tab.
  //
  // Only audits LIVE clients — churned clients having broken integrations
  // is by design (the AM offboarded them), and on_hold clients aren't
  // running active campaigns, so a stale Meta link there isn't
  // immediately actionable. This keeps the audit roll-up signal-only.
  const liveIds = useMemo(
    () =>
      withStatus
        .filter(({ hubStatus }) => hubStatus === "live")
        .map(({ client }) => client.mondayItemId),
    [withStatus],
  )
  const healthQuery = useQuery<{ health: Record<string, ClientHealth> }>({
    queryKey: ["clients-connection-health", liveIds],
    queryFn: async () => {
      const r = await fetch("/api/integrations/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mondayItemIds: liveIds }),
      })
      if (!r.ok) throw new Error("Failed to load connection health")
      return r.json()
    },
    enabled: liveIds.length > 0,
    // Long staleTime — the underlying lib already caches per-client for
    // 1h. The UI just needs to re-render when the user navigates back.
    staleTime: 60 * 60 * 1000,
  })
  // useMemo'd so the empty-fallback `{}` keeps a stable reference between
  // renders — the downstream useMemos that depend on this are eager about
  // re-running on any input change. Without this wrapper they'd recompute
  // on every render, which lint correctly flags.
  const healthByClient = useMemo(
    () => healthQuery.data?.health ?? {},
    [healthQuery.data],
  )

  const brokenCount = useMemo(
    () =>
      liveIds.filter((id) => (healthByClient[id]?.brokenCount ?? 0) > 0).length,
    [liveIds, healthByClient],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return withStatus
      .filter(({ client, hubStatus }) => {
        if (listFilter === "broken") {
          // Only live clients with ≥1 broken/missing required service.
          // Health may still be loading for some entries — skip them
          // until data arrives, the broken-count badge will trigger a
          // re-render when it does.
          return hubStatus === "live" && (healthByClient[client.mondayItemId]?.brokenCount ?? 0) > 0
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
        // Inside the broken filter, surface the worst offenders first —
        // brokenCount desc, then alpha. Other filters keep the existing
        // alpha-only sort so admins can scan predictably.
        if (listFilter === "broken") {
          const aBroken = healthByClient[a.client.mondayItemId]?.brokenCount ?? 0
          const bBroken = healthByClient[b.client.mondayItemId]?.brokenCount ?? 0
          if (aBroken !== bBroken) return bBroken - aBroken
        }
        return a.client.name.localeCompare(b.client.name)
      })
  }, [withStatus, listFilter, search, healthByClient])

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-1">{t("settings.clients.title", locale)}</h3>
        <p className="text-xs text-muted-foreground/60 mb-4">
          {t("settings.clients.subtitle", locale)}
        </p>
      </div>

      {/* Status tabs — default Live so the rolodex of churned clients
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
                ? "No broken connections"
                : `${brokenCount} live client${brokenCount === 1 ? "" : "s"} with broken or missing required integrations`
          }
        >
          <AlertTriangle className="h-3 w-3" />
          Broken connections
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
          // Only show the statusbar for clients we audited (live only).
          // For on_hold/churned the dots would all be "loading skeleton"
          // forever, which is more visual noise than signal.
          const showHealth = hubStatus === "live"
          const health = healthByClient[client.mondayItemId]

          return (
            <div
              key={client.mondayItemId}
              className="rounded-lg border border-border/60 overflow-hidden"
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
                : "All connections healthy — no broken or missing required links."
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
