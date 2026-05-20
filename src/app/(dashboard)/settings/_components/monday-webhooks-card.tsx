"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { Loader2, RefreshCw, Webhook } from "lucide-react"

type MondayWebhookEvent =
  | "change_column_value"
  | "change_name"
  | "create_pulse"
  | "item_deleted"
  | "create_update"

type Webhook = {
  id: string
  boardId: string
  event: MondayWebhookEvent
  url: string | null
}

type StatusResponse = {
  boards: { onboarding: string; current: string }
  targetEvents: MondayWebhookEvent[]
  secretConfigured: boolean
  onboarding: Webhook[]
  current: Webhook[]
}

type RegisterResult = {
  webhookUrl: string
  created: number
  failed: number
  results: Array<{
    boardId: string
    event: MondayWebhookEvent
    status: "created" | "exists" | "failed"
    webhookId?: string
    error?: string
  }>
}

/**
 * Admin card for the Monday → Hub real-time sync webhooks.
 *
 * Two responsibilities:
 *   - Show "registered ↔ missing" per board so the admin can see at a
 *     glance whether the receiver is wired up correctly.
 *   - One-click "Register" button that reconciles: any (board, event)
 *     pair we want but Monday doesn't have yet, registered now.
 *
 * Without these webhooks the watch-list + clients table show data that's
 * up to 24h stale (the refresh-cache cron only runs once daily). With
 * them, status / AM / name edits in Monday reach the Hub within seconds.
 */
export function MondayWebhooksCard() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<RegisterResult | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/monday-webhooks")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to load")
      setStatus(data as StatusResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function register() {
    setBusy(true)
    setError(null)
    setLastResult(null)
    try {
      const res = await fetch("/api/admin/monday-webhooks", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Register failed")
      setLastResult(data as RegisterResult)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Register failed")
    } finally {
      setBusy(false)
    }
  }

  // Build a per-board summary: which target events are registered, which
  // are missing, and (when missing) flag the card so the admin notices.
  function summarize(label: string, webhooks: Webhook[]) {
    const target = status?.targetEvents ?? []
    const present = new Set(webhooks.map((w) => w.event))
    const ok = target.filter((e) => present.has(e))
    const missing = target.filter((e) => !present.has(e))
    return { label, ok, missing, all: webhooks }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Webhook className="h-4 w-4" />
          Monday real-time sync (webhooks)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Monday pushes status / column / name / create / delete events to{" "}
          <code className="text-xs">/api/webhooks/monday</code> so the Hub
          cache stays in sync within seconds instead of waiting for the
          daily refresh-cache cron. Click <strong>Register</strong> after
          any board change to (re)wire the events on both boards.
        </p>

        {!status?.secretConfigured && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            <strong>MONDAY_WEBHOOK_SECRET</strong> is not set in env. Set it
            in Vercel + your local <code>.env</code> before registering —
            Monday will reject incoming events without it.
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : status ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[
              summarize("Onboarding board", status.onboarding),
              summarize("Current clients board", status.current),
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-lg border border-border/60 bg-card/50 p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{s.label}</span>
                  {s.missing.length === 0 ? (
                    <StatusPill tone="success">All registered</StatusPill>
                  ) : (
                    <StatusPill tone="warning">
                      {s.ok.length}/{status.targetEvents.length}
                    </StatusPill>
                  )}
                </div>
                <ul className="text-[11px] text-muted-foreground space-y-1">
                  {status.targetEvents.map((event) => {
                    const present = s.all.find((w) => w.event === event)
                    return (
                      <li key={event} className="flex items-center justify-between">
                        <code className="text-foreground/80">{event}</code>
                        {present ? (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            ✓ #{present.id}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">— missing</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : null}

        {lastResult && (
          <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
            <p className="font-medium mb-1">
              Last run: {lastResult.created} created, {lastResult.failed} failed
            </p>
            <p className="text-muted-foreground break-all">
              URL: <code>{lastResult.webhookUrl}</code>
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={register} disabled={busy || !status?.secretConfigured}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Webhook className="h-4 w-4" />}
            Register webhooks
          </Button>
          <Button variant="outline" onClick={load} disabled={busy || loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
