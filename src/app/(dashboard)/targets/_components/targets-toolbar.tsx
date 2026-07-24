"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useIsFetching, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { RefreshCw, Settings2 } from "lucide-react"
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

  const inFlight = useIsFetching({
    predicate: (q) =>
      Array.isArray(q.queryKey) &&
      typeof q.queryKey[0] === "string" &&
      (TARGETS_QUERY_PREFIXES as readonly string[]).includes(q.queryKey[0]),
  })
  const isFetching = inFlight > 0 || isRefreshing

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
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isFetching}
        title={t("targets.action.refresh", locale)}
        className="icon-btn disabled:opacity-50"
      >
        <RefreshCw className={isFetching ? "animate-spin" : ""} />
      </button>
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
