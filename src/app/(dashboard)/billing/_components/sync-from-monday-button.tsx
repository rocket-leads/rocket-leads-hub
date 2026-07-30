"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n/t"
import { useLocale } from "@/lib/i18n/client"

/**
 * Admin-only "Sync from Monday" button. Hits POST /api/admin/sync-next-invoice-dates
 * which pulls `date3` from every Monday client and writes it into Supabase
 * `clients.next_invoice_date`. Then `router.refresh()` re-renders the page
 * with the fresh data without forcing a hard reload.
 */
export function SyncFromMondayButton() {
  const router = useRouter()
  const locale = useLocale()
  const [state, setState] = useState<"idle" | "running" | "ok" | "err">("idle")
  const [msg, setMsg] = useState<string | null>(null)

  async function run() {
    setState("running")
    setMsg(null)
    try {
      const res = await fetch("/api/admin/sync-next-invoice-dates", { method: "POST" })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        written?: number
        failed?: number
        error?: string
      }
      if (!res.ok || !data.ok) {
        setState("err")
        setMsg(data.error ?? t("billing.sync.failed", locale))
        return
      }
      setState("ok")
      setMsg(
        t("billing.sync.done", locale, {
          count: data.written ?? 0,
          failed: data.failed ? t("billing.sync.failed_suffix", locale, { count: data.failed }) : "",
        }),
      )
      router.refresh()
      setTimeout(() => {
        setState("idle")
        setMsg(null)
      }, 4000)
    } catch (e) {
      setState("err")
      setMsg(e instanceof Error ? e.message : t("billing.sync.failed", locale))
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span
          className={
            state === "err"
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {msg}
        </span>
      )}
      <Button variant="outline" size="sm" onClick={run} disabled={state === "running"}>
        {state === "running" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : state === "ok" ? (
          <Check className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {t("billing.sync.button", locale)}
      </Button>
    </div>
  )
}
