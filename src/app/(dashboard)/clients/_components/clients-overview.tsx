"use client"

import { useState, useMemo, useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { RefreshCw } from "lucide-react"
import { Panel } from "@/components/ui/panel"
import { ClientsTable } from "./clients-table"
import { ClientSlideOver } from "./client-slide-over"
import type { MondayClient } from "@/lib/integrations/monday"
import type { BillingSummary } from "@/lib/integrations/stripe"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { AgreementSummary } from "@/app/api/clients/agreements-summary/route"
import type { LastClientUpdatesResponse } from "@/app/api/clients/last-client-updates/route"
import { mondayStatusToHub, type ClientStatus } from "@/lib/clients/status"
import type { CurrentUser } from "@/app/(dashboard)/inbox/_components/shell/types"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"

const ACTIVE_HUB_STATUSES: ClientStatus[] = ["live", "on_hold"]

type Props = {
  onboarding: MondayClient[]
  current: MondayClient[]
  currentUser: CurrentUser | null
}

export function ClientsOverview({ onboarding, current, currentUser }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedClientId = searchParams.get("client")
  const locale = useLocale()

  // Lookup table from Monday item id → full client object. Lets us
  // hand the slide-over a placeholder so it can render without
  // waiting for the Monday fetch round-trip (typically 500-2000ms).
  const clientById = useMemo(() => {
    const map = new Map<string, MondayClient>()
    for (const c of onboarding) map.set(c.mondayItemId, c)
    for (const c of current) map.set(c.mondayItemId, c)
    return map
  }, [onboarding, current])
  const selectedClientPreview = selectedClientId ? clientById.get(selectedClientId) ?? null : null

  const handleSelectClient = useCallback(
    (mondayItemId: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("client", mondayItemId)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  const handleClosePanel = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("client")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, searchParams])

  // Body scroll lock is handled by Base UI's Dialog inside ClientSlideOver -
  // the previous manual lock here raced with Base UI's and could capture
  // `original = "hidden"`, leaving the page unscrollable on close. Removed
  // 2026-06-07.

  const [showAll, setShowAll] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  // The All Clients overview is the "is everyone OK?" surface - same
  // intent as the Watch List. KPI columns lock to the canonical 7d
  // window so they match Watch List + Home page + Pedro numbers
  // always. The date picker was removed 2026-05 because a stale
  // localStorage choice (e.g. user once picked MTD on /targets) made
  // the table show 18-day numbers under a label that read like a 7d
  // snapshot. Deeper-window analysis lives in the slide-over's
  // Campaigns tab where the picker still exists.

  const visibleCurrent = useMemo(
    () =>
      showAll
        ? current
        : current.filter((c) => {
            const status = mondayStatusToHub(c.campaignStatus, "current")
            return status !== null && ACTIVE_HUB_STATUSES.includes(status)
          }),
    [current, showAll],
  )
  const hiddenCount = current.length - visibleCurrent.length

  const activeClients = useMemo(() => [...onboarding, ...visibleCurrent], [onboarding, visibleCurrent])

  const customerIds = useMemo(
    () => activeClients.map((c) => c.stripeCustomerId).filter(Boolean) as string[],
    [activeClients]
  )

  const kpiClients = useMemo(
    () =>
      activeClients
        .filter((c) => c.metaAdAccountId || c.clientBoardId)
        .map((c) => ({
          mondayItemId: c.mondayItemId,
          metaAdAccountId: c.metaAdAccountId || null,
          clientBoardId: c.clientBoardId || null,
        })),
    [activeClients]
  )

  const summariesQuery = useQuery<Record<string, BillingSummary>>({
    queryKey: ["billing-summaries", customerIds],
    queryFn: () => {
      const params = new URLSearchParams({ customerIds: customerIds.join(",") })
      return fetch(`/api/billing-summaries?${params}`).then((r) => r.json())
    },
    enabled: customerIds.length > 0,
    staleTime: 60 * 60 * 1000,
  })

  const mondayActiveQuery = useQuery<Record<string, boolean>>({
    queryKey: ["monday-active-map"],
    queryFn: () => fetch("/api/monday-active").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  const agreementsQuery = useQuery<Record<string, AgreementSummary>>({
    queryKey: ["agreements-summary"],
    queryFn: () => fetch("/api/clients/agreements-summary").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  // Last "Client update" send timestamp per Monday item - backs the
  // green "Geüpdatet vandaag" state + grey caption on the Client update column.
  // 30s stale time so a fresh send by the same user reflects in the table
  // almost immediately when the dialog calls invalidateQueries below.
  const lastClientUpdatesQuery = useQuery<LastClientUpdatesResponse>({
    queryKey: ["last-client-updates"],
    queryFn: () => fetch("/api/clients/last-client-updates").then((r) => r.json()),
    staleTime: 30 * 1000,
  })

  // No startDate/endDate in the POST body - the endpoint falls back to
  // the cron's canonical last-7d window. Same window the Watch List +
  // Home page + Pedro narrative use, so the columns on this table are
  // guaranteed to match every other surface in the app.
  const kpiQuery = useQuery<Record<string, KpiSummary>>({
    queryKey: ["kpi-summaries", kpiClients.map((c) => c.mondayItemId)],
    queryFn: () =>
      fetch("/api/kpi-summaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clients: kpiClients }),
      }).then((r) => r.json()),
    enabled: kpiClients.length > 0,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const isFetching = summariesQuery.isFetching || kpiQuery.isFetching || isRefreshing

  async function handleRefresh() {
    setIsRefreshing(true)
    // Live-fetch Monday and rewrite the `monday_boards` cache BEFORE re-rendering
    // the server component - otherwise router.refresh() just re-reads the same
    // stale cache the cron last wrote, and recent Monday edits (renamed status
    // options, new clients, etc.) stay invisible until the next cron tick.
    try {
      await fetch("/api/clients/refresh", { method: "POST" })
    } catch (e) {
      console.error("clients refresh failed:", e)
    }
    router.refresh()
    await Promise.all([summariesQuery.refetch(), kpiQuery.refetch(), agreementsQuery.refetch(), mondayActiveQuery.refetch()])
    setIsRefreshing(false)
  }

  const lastUpdated = Math.max(summariesQuery.dataUpdatedAt || 0, kpiQuery.dataUpdatedAt || 0)
  const lastUpdatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString(locale === "nl" ? "nl-NL" : "en-GB", { hour: "2-digit", minute: "2-digit" })
    : null

  // Onboarding tab dropped 2026-06-11 (Roy: "onboarding hebben we nu
  // in een aparte tab bij onboarding") - /clients is now current-
  // clients-only. Refresh + last-updated stamp render inline above
  // the table instead of inside a tab strip.
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2 -mb-2">
        {lastUpdatedLabel && (
          <span className="text-[11px] text-muted-foreground/40">{t("clients.updated", locale, { time: lastUpdatedLabel })}</span>
        )}
        <button
          className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 transition-all"
          onClick={handleRefresh}
          disabled={isFetching}
          aria-label={t("clients.refresh", locale)}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      <Panel className="p-5">
        <ClientsTable
          clients={visibleCurrent}
          boardType="current"
          billingSummaries={summariesQuery.data}
          kpiSummaries={kpiQuery.data}
          agreementSummaries={agreementsQuery.data}
          mondayActiveMap={mondayActiveQuery.data}
          lastClientUpdates={lastClientUpdatesQuery.data?.lastUpdates}
          onSelectClient={handleSelectClient}
          showAllToggle={{
            showAll,
            setShowAll,
            totalCount: current.length,
          }}
        />
      </Panel>

      {currentUser && (
        <ClientSlideOver
          clientId={selectedClientId}
          onClose={handleClosePanel}
          currentUser={currentUser}
          clientPreview={selectedClientPreview}
          allClients={activeClients}
          onSelectClient={handleSelectClient}
        />
      )}
    </div>
  )
}
