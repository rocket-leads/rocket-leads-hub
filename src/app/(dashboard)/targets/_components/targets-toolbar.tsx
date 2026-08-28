"use client"

import Link from "next/link"
import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useIsFetching, useQueryClient, type Query } from "@tanstack/react-query"
import { format } from "date-fns"
import { Settings2 } from "lucide-react"
import { RefreshMeta } from "@/components/ui/refresh-meta"
import { getCachedDateRangeSnapshot } from "../_hooks/use-date-range"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"

/** Query key prefixes belonging to the targets dashboards - used to scope
 *  refresh invalidation + the in-flight spinner. */
const TARGETS_QUERY_PREFIXES = [
  "targets-monday",
  "targets-meta",
  "targets-finance",
  "targets-costs",
  "targets-delivery",
  "targets-config",
] as const

/** True for any React Query belonging to the targets dashboards. */
function isTargetsQuery(q: Query): boolean {
  return (
    Array.isArray(q.queryKey) &&
    typeof q.queryKey[0] === "string" &&
    (TARGETS_QUERY_PREFIXES as readonly string[]).includes(q.queryKey[0])
  )
}

/** Data older than this on view/focus triggers a silent background refetch, so
 *  opening or returning to a Targets page always pulls the freshest cache
 *  without the user hitting refresh. Reads hit the warm server cache, so it's
 *  cheap; keepPreviousData keeps the numbers on screen while it revalidates. */
const REVALIDATE_IF_OLDER_THAN_MS = 3 * 60 * 1000

/** "Updated just now / 4m ago / 2h ago" - the freshness stamp text. */
function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 45) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return `${h}h ago`
}

/**
 * Shared header toolbar for the three Growth dashboards (Marketing & Sales /
 * Delivery / Finance). Extracted from the old tab switcher when Targets was
 * split into separate sidebar routes: it keeps the "refresh all target data"
 * button and the admin-only link to the target-settings editor. The active
 * dashboard is now chosen by the sidebar, not by tabs, so no tab bar here.
 */
export function TargetsToolbar({
  isAdmin,
  canSeeFinance,
  showSettingsGear = true,
}: {
  isAdmin: boolean
  canSeeFinance: boolean
  /** Hidden on the settings page itself (the gear would link to the current page). */
  showSettingsGear?: boolean
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const locale = useLocale()
  const [isRefreshing, setIsRefreshing] = useState(false)

  const inFlight = useIsFetching({ predicate: isTargetsQuery })
  const isFetching = inFlight > 0 || isRefreshing

  // Ticks every 30s so the "Updated Xm ago" label stays accurate between fetches.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Freshest fetch timestamp across all mounted targets queries. Recomputed when
  // a fetch settles (inFlight flips) or the 30s tick fires.
  const freshestUpdatedAt = useMemo(() => {
    const queries = queryClient.getQueryCache().findAll({ predicate: isTargetsQuery })
    const stamps = queries.map((q) => q.state.dataUpdatedAt || 0).filter((n) => n > 0)
    return stamps.length ? Math.max(...stamps) : 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, inFlight, nowTick])

  // On mount + whenever the tab regains focus, silently revalidate if the data
  // has gone stale. This is what makes returning to a Targets page show current
  // numbers without a manual refresh - it reads the warm server cache (fast) and
  // keepPreviousData avoids any skeleton flash.
  useEffect(() => {
    function revalidateIfStale() {
      const queries = queryClient.getQueryCache().findAll({ predicate: isTargetsQuery })
      const stamps = queries.map((q) => q.state.dataUpdatedAt || 0).filter((n) => n > 0)
      if (stamps.length === 0) return
      const freshest = Math.max(...stamps)
      if (Date.now() - freshest > REVALIDATE_IF_OLDER_THAN_MS) {
        void queryClient.invalidateQueries({ predicate: isTargetsQuery })
      }
    }
    revalidateIfStale()
    window.addEventListener("focus", revalidateIfStale)
    return () => window.removeEventListener("focus", revalidateIfStale)
  }, [queryClient])

  async function handleRefresh() {
    setIsRefreshing(true)
    try {
      const { startDate, endDate } = getCachedDateRangeSnapshot()
      const s = format(startDate, "yyyy-MM-dd")
      const e = format(endDate, "yyyy-MM-dd")
      const year = startDate.getFullYear()
      const month = startDate.getMonth() + 1
      // Bypass server caches with refresh=1 in parallel; React Query then
      // refetches the normal URLs against the freshly-warm caches.
      await Promise.allSettled([
        fetch(`/api/targets/monday?startDate=${s}&endDate=${e}&refresh=1`, { cache: "no-store" }),
        fetch(`/api/targets/meta?startDate=${s}&endDate=${e}&refresh=1`, { cache: "no-store" }),
        ...(canSeeFinance
          ? [fetch(`/api/targets/finance?startDate=${s}&endDate=${e}&refresh=1`, { cache: "no-store" })]
          : []),
        ...(isAdmin
          ? [fetch(`/api/targets/costs?year=${year}&month=${month}&refresh=1`, { cache: "no-store" })]
          : []),
        fetch(`/api/targets/delivery?startDate=${s}&endDate=${e}&refresh=1`, { cache: "no-store" }),
      ])
      await queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          typeof q.queryKey[0] === "string" &&
          (TARGETS_QUERY_PREFIXES as readonly string[]).includes(q.queryKey[0]),
      })
      router.refresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <>
      {/* Freshness stamp: tells the CM whether the numbers are live or cached, so
          when a figure changes on revalidation it reads as "just synced", not a
          glitch. "Refreshing…" while any targets query is in flight, otherwise
          "Updated Xm ago" from the freshest fetch on screen. */}
      <span
        className="text-[11px] text-muted-foreground/70 tabular-nums whitespace-nowrap mr-1 hidden sm:inline"
        title={
          freshestUpdatedAt
            ? `Targets data last fetched ${format(new Date(freshestUpdatedAt), "HH:mm:ss")}. Auto-revalidates on view/focus and on Monday changes.`
            : undefined
        }
      >
        {isFetching ? (
          <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Refreshing…
          </span>
        ) : freshestUpdatedAt ? (
          `Updated ${formatAge(nowTick - freshestUpdatedAt)}`
        ) : null}
      </span>
      <RefreshMeta
        onRefresh={handleRefresh}
        refreshing={isFetching}
        refreshLabel={t("targets.action.refresh", locale)}
      />
      {isAdmin && showSettingsGear && (
        <Link
          href="/targets/settings"
          title={t("targets.action.settings", locale)}
          className="icon-btn"
        >
          <Settings2 />
        </Link>
      )}
    </>
  )
}
