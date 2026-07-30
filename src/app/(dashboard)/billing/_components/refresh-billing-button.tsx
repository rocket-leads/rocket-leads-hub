"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw, Check } from "lucide-react"
import { t } from "@/lib/i18n/t"
import { useLocale } from "@/lib/i18n/client"
import type { Locale } from "@/lib/i18n/types"

type RefreshResponse = {
  ok?: boolean
  refreshedAt?: string
  monday?: { datesWritten?: number; driftCorrected?: number }
  stripe?: { refreshed?: number; failed?: number }
  error?: string
}

/**
 * Combined Monday + Stripe refresh button for the Billing page. Hits
 * POST /api/billing/refresh, then `router.refresh()` so server components
 * re-render with the new state. Also shows "Last updated X ago" so finance
 * can see how fresh the data is at a glance - payment state ages fast on
 * this page (invoices going out, payments landing) and they shouldn't have
 * to guess whether to click again.
 */
type Props = {
  /** ISO timestamp from the `billing_refreshed_at` cache. Drives the
   *  "Last updated …" hint when the button is idle. */
  lastRefreshedAt: string | null
}

function formatAge(iso: string | null, locale: Locale): string | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return null
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return t("billing.refresh.just_now", locale)
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t("billing.refresh.minutes_ago", locale, { minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t("billing.refresh.hours_ago", locale, { hours })
  const days = Math.round(hours / 24)
  return t("billing.refresh.days_ago", locale, { days })
}

export function RefreshBillingButton({ lastRefreshedAt }: Props) {
  const router = useRouter()
  const locale = useLocale()
  const [state, setState] = useState<"idle" | "running" | "ok" | "err">("idle")
  const [msg, setMsg] = useState<string | null>(null)
  const [age, setAge] = useState<string | null>(formatAge(lastRefreshedAt, locale))

  // Re-render the relative time every 30s so "5m ago" doesn't sit visibly
  // wrong while the user is on the page. Cheap re-render - just one string.
  useEffect(() => {
    const tick = () => setAge(formatAge(lastRefreshedAt, locale))
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [lastRefreshedAt, locale])

  async function run() {
    setState("running")
    setMsg(null)
    try {
      const res = await fetch("/api/billing/refresh", { method: "POST" })
      const data = (await res.json().catch(() => ({}))) as RefreshResponse
      if (!res.ok || !data.ok) {
        setState("err")
        setMsg(data.error ?? t("billing.refresh.failed", locale))
        return
      }
      setState("ok")
      const stripeRefreshed = data.stripe?.refreshed ?? 0
      const drifted = data.monday?.driftCorrected ?? 0
      const parts = [t("billing.refresh.stripe_count", locale, { count: stripeRefreshed })]
      if (drifted > 0)
        parts.push(t("billing.refresh.drift_fixes", locale, { count: drifted, plural: drifted === 1 ? "" : "es" }))
      setMsg(t("billing.refresh.done", locale, { parts: parts.join(" · ") }))
      router.refresh()
      setTimeout(() => {
        setState("idle")
        setMsg(null)
      }, 4000)
    } catch (e) {
      setState("err")
      setMsg(e instanceof Error ? e.message : t("billing.refresh.failed", locale))
    }
  }

  return (
    <div className="flex items-center gap-3">
      {msg ? (
        <span
          className={`font-mono text-[11px] leading-none ${state === "err" ? "text-destructive" : "text-muted-foreground/50"}`}
        >
          {msg}
        </span>
      ) : (
        age && (
          <span className="font-mono text-[11px] text-muted-foreground/50 leading-none">
            {t("billing.refresh.last_updated", locale, { age })}
          </span>
        )
      )}
      <button
        className="icon-btn disabled:opacity-50"
        onClick={run}
        disabled={state === "running"}
        title={t("billing.refresh.title", locale)}
        aria-label={t("billing.refresh.aria", locale)}
      >
        {state === "running" ? (
          <RefreshCw className="animate-spin" />
        ) : state === "ok" ? (
          <Check className="text-emerald-500" />
        ) : (
          <RefreshCw />
        )}
      </button>
    </div>
  )
}
