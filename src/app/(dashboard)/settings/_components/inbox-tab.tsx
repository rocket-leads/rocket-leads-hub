"use client"

import { useState, useTransition } from "react"
import {
  CalendarClock,
  CreditCard,
  Zap,
  Loader2,
  TrendingDown,
  Play,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { setInboxAutomationRule, triggerInboxAutomationsNow } from "../actions"
import type { InboxAutomationRules } from "../types"
import type { AutomationRunResult, CreatedItem } from "@/lib/inbox/automations"

type RuleConfig = {
  key: keyof InboxAutomationRules
  title: string
  description: string
  trigger: string
  effect: string
  icon: typeof CreditCard
}

const RULES: RuleConfig[] = [
  {
    key: "payment_overdue_task",
    title: "Payment overdue → high-priority task",
    description:
      "When a Stripe invoice goes overdue for a client, the daily cron creates a high-priority task assigned to that client's Account Manager. The task asks the AM to contact the client about the overdue payment. Idempotent — one task per overdue invoice.",
    trigger: "Stripe invoice status becomes overdue",
    effect: "Task created · assigned to AM · priority high · due today",
    icon: CreditCard,
  },
  {
    key: "positive_client_signal_cpl_drop",
    title: "Positive client signal → AM share-the-win task",
    description:
      "When a client's CPL drops 50% or more compared to the previous period (last 7d or last 30d), the cron drafts a short, informal Dutch update message — using recent Trengo conversations to match tone-of-voice — and creates a task for the AM with the message ready to copy-paste to the client. Idempotent: one signal per client per period in any 14-day window.",
    trigger: "CPL drops ≥50% vs previous period (7d or 30d)",
    effect: "Task created · AI-drafted Dutch update in body · assigned to AM",
    icon: TrendingDown,
  },
  {
    key: "next_invoice_due_task",
    title: "Next invoice date arrived → finance task",
    description:
      "When a client's next-invoice date is today (or in the past and not yet handled), the cron creates a task assigned to the user with the Finance flag. Body includes client name, MRR from the Hub agreement, and Stripe customer ID so finance can act without context-switching. Idempotent per client + date.",
    trigger: "clients.next_invoice_date ≤ today",
    effect: "Task created · assigned to Finance user · priority high · due today",
    icon: CalendarClock,
  },
]

type Props = {
  rules: InboxAutomationRules
}

export function InboxAutomationTab({ rules }: Props) {
  const [local, setLocal] = useState<InboxAutomationRules>(rules)
  const [pending, setPending] = useState<keyof InboxAutomationRules | null>(null)
  const [, startTransition] = useTransition()

  function toggle(rule: keyof InboxAutomationRules) {
    const next = !local[rule]
    setLocal((s) => ({ ...s, [rule]: next }))
    setPending(rule)
    startTransition(async () => {
      try {
        await setInboxAutomationRule(rule, next)
      } catch (e) {
        // Revert on error.
        setLocal((s) => ({ ...s, [rule]: !next }))
        console.error("Failed to update rule", e)
      } finally {
        setPending(null)
      }
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1 inline-flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-amber-500" />
          Inbox Automations
        </h3>
        <p className="text-xs text-muted-foreground/60 mb-4">
          Rules that automatically create inbox tasks or updates based on data signals across the Hub. Each rule runs once daily via cron and is fully idempotent — re-running won&apos;t create duplicates.
        </p>
      </div>

      <RunNowPanel />

      <div className="space-y-3">
        {RULES.map((r) => {
          const enabled = local[r.key]
          const isPending = pending === r.key
          const Icon = r.icon
          return (
            <div
              key={r.key}
              className={`rounded-xl border ${enabled ? "border-border bg-card" : "border-border/40 bg-muted/20"} px-4 py-4 transition-colors`}
            >
              <div className="flex items-start gap-4">
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${enabled ? "bg-amber-500/10 text-amber-500" : "bg-muted text-muted-foreground"}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <p className="text-sm font-semibold">{r.title}</p>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      onClick={() => toggle(r.key)}
                      disabled={isPending}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${enabled ? "bg-emerald-500" : "bg-muted-foreground/30"} ${isPending ? "opacity-60" : ""}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`}
                      />
                      {isPending && (
                        <Loader2 className="absolute inset-0 m-auto h-3 w-3 animate-spin text-muted-foreground" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground/80 leading-relaxed mb-3">
                    {r.description}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-muted-foreground/40 uppercase tracking-wider">Trigger</span>
                      <p className="text-foreground/80 mt-0.5">{r.trigger}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground/40 uppercase tracking-wider">Effect</span>
                      <p className="text-foreground/80 mt-0.5">{r.effect}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="text-[11px] text-muted-foreground/50 italic">
        More rules will land here as we wire signals from Monday updates, Trengo conversations and Watch List events into automated tasks.
      </div>
    </div>
  )
}

// --- Test trigger -------------------------------------------------------

function RunNowPanel() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<AutomationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCreated, setShowCreated] = useState(true)
  const [showSkipped, setShowSkipped] = useState(false)

  async function run() {
    setRunning(true)
    setError(null)
    try {
      const r = await triggerInboxAutomationsNow()
      setResult(r)
      setShowCreated(true)
      setShowSkipped(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed")
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold inline-flex items-center gap-2">
            <Play className="h-3.5 w-3.5 text-foreground/70" />
            Run as test (assigned to you)
          </p>
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            Same code path as the daily cron, but tasks are assigned to <span className="font-medium text-foreground/80">you</span> with a <span className="font-mono">[TEST]</span> prefix — so you can validate AI output and rule logic without spamming the team. Idempotency check is skipped, so re-running always produces fresh items.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted/60 transition-colors disabled:opacity-60 shrink-0"
        >
          {running ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" />
              Run test
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2 pt-1 border-t border-border/40">
          <div className="text-[11px] text-muted-foreground/80 flex items-center gap-2 flex-wrap">
            <span>
              Last run · <span className="tabular-nums">{result.duration}</span>
            </span>
            <span>·</span>
            <span>
              <span className="text-emerald-500 font-medium">{result.created.length}</span> created
            </span>
            <span>·</span>
            <span>
              <span className="text-amber-500 font-medium">{result.skippedTotal}</span> skipped
            </span>
            {result.reason && <span className="italic">— {result.reason}</span>}
          </div>

          {result.created.length > 0 && (
            <ResultSection
              title={`Created (${result.created.length})`}
              open={showCreated}
              onToggle={() => setShowCreated((s) => !s)}
            >
              {result.created.map((item, i) => (
                <CreatedRow key={i} item={item} />
              ))}
            </ResultSection>
          )}

          {result.skippedTotal > 0 && (
            <ResultSection
              title={`Skipped (${result.skippedTotal})`}
              open={showSkipped}
              onToggle={() => setShowSkipped((s) => !s)}
            >
              {result.skipped.map((s, i) => (
                <p key={i} className="text-[11px] py-0.5">
                  <span className="font-mono text-muted-foreground/60">{s.reason}</span>
                  {s.client && <span className="ml-2">{s.client}</span>}
                  {s.detail && (
                    <span className="ml-2 text-muted-foreground/50">— {s.detail}</span>
                  )}
                </p>
              ))}
              {result.skippedTotal > result.skipped.length && (
                <p className="text-[10px] text-muted-foreground/40 italic mt-1">
                  +{result.skippedTotal - result.skipped.length} more (truncated)
                </p>
              )}
            </ResultSection>
          )}

          {result.created.length === 0 && result.skippedTotal === 0 && !result.reason && (
            <p className="text-[11px] text-muted-foreground italic">
              No actions taken — nothing matched any rule today.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ResultSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-medium text-muted-foreground/70 hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open && <div className="mt-1.5 ml-4 space-y-1">{children}</div>}
    </div>
  )
}

function CreatedRow({ item }: { item: CreatedItem }) {
  if (item.rule === "payment_overdue_task") {
    return (
      <div className="text-[11px] py-0.5 flex items-baseline gap-2">
        <span className="text-amber-500 font-medium">Payment overdue</span>
        <span className="text-foreground/80">{item.clientName}</span>
        <span className="text-muted-foreground/60">→ {item.assigneeName}</span>
        <span className="text-muted-foreground/60 tabular-nums">
          €{item.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
    )
  }
  if (item.rule === "next_invoice_due_task") {
    return (
      <div className="text-[11px] py-0.5 flex items-baseline gap-2">
        <span className="text-sky-500 font-medium">Next invoice due</span>
        <span className="text-foreground/80">{item.clientName}</span>
        <span className="text-muted-foreground/60">→ {item.assigneeName}</span>
        <span className="text-muted-foreground/60 tabular-nums">
          {item.invoiceDate}
          {item.mrr > 0 && ` · €${item.mrr.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`}
        </span>
      </div>
    )
  }
  return (
    <div className="text-[11px] py-0.5 flex items-baseline gap-2">
      <span className="text-emerald-500 font-medium">CPL drop {item.period}</span>
      <span className="text-foreground/80">{item.clientName}</span>
      <span className="text-muted-foreground/60">→ {item.assigneeName}</span>
      <span className="text-muted-foreground/60 tabular-nums">
        −{item.dropPct}% (€{item.currCpl.toFixed(2)} vs €{item.prevCpl.toFixed(2)})
      </span>
    </div>
  )
}
