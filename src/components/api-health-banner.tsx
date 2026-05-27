"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { AlertTriangle, ArrowRight } from "lucide-react"
import { DismissButton } from "@/components/ui/dismiss-button"
import { useState } from "react"
import type { ApiHealthStatusResponse } from "@/app/api/settings/health/status/route"

/**
 * Global banner that surfaces invalid API tokens.
 *
 * Roy 2026-05-27: Meta token expired and nobody noticed for days because
 * the only signal lived inside the Settings → Health tab. This banner
 * lives at the top of every dashboard page so an invalid token is
 * impossible to miss.
 *
 * Data source: `/api/settings/health/status` reads `api_tokens.is_valid`
 * from the DB (cheap), updated hourly by the refresh-api-health cron and
 * whenever someone visits the full Settings → Health page. The banner
 * polls every 5 minutes which is plenty given the cron cadence.
 *
 * Behaviour: renders nothing when every service is valid. When one or
 * more services are invalid, shows a yellow strip with a "Fix it"
 * link straight to Settings → API tokens. Per-session dismiss only
 * (resets on full page reload) — Roy explicitly didn't want this
 * persistently dismissable, because then he'd never see it again.
 */
export function ApiHealthBanner() {
  const [dismissed, setDismissed] = useState(false)

  const { data } = useQuery<ApiHealthStatusResponse>({
    queryKey: ["api-health-status"],
    queryFn: async () => {
      const res = await fetch("/api/settings/health/status")
      if (!res.ok) throw new Error("Failed to fetch API health status")
      return res.json()
    },
    refetchInterval: 5 * 60 * 1000, // 5 min
    staleTime: 60 * 1000,
    retry: 1,
  })

  if (!data || data.invalid.length === 0 || dismissed) return null

  const services = data.invalid.map((s) => s.label).join(", ")
  const isPlural = data.invalid.length > 1

  return (
    <div className="bg-amber-500/15 border-b border-amber-500/40 text-amber-900 dark:text-amber-100">
      <div className="px-8 py-2.5 flex items-center gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <div className="flex-1 text-sm font-medium leading-tight">
          {isPlural ? "API tokens verlopen" : "API token verlopen"}
          <span className="font-normal text-amber-900/70 dark:text-amber-100/70 ml-2">
            · {services} — reconnect via Settings om data te blijven verversen.
          </span>
        </div>
        <Link
          href="/settings?tab=tokens"
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-100 text-xs font-semibold transition-colors"
        >
          Fix it
          <ArrowRight className="h-3 w-3" />
        </Link>
        <DismissButton
          size="xs"
          onClick={() => setDismissed(true)}
          label="Verberg tot volgende refresh"
          stopPropagation={false}
          className="text-amber-900/60 hover:text-amber-900 dark:text-amber-100/60 dark:hover:text-amber-100"
        />
      </div>
    </div>
  )
}
