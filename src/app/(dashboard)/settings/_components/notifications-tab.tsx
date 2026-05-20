"use client"

import { useState, useTransition } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Bell, MessageSquare, Send, Users, Check, Loader2, Zap } from "lucide-react"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import { saveSlackChannelId, updateCloserSlackId } from "../actions"

type Recipient = {
  name: string | null
  email: string
  hasSlack: boolean
}

type Closer = {
  name: string
  slackId: string | null
}

type Props = {
  slackConnected: boolean
  recipients: Recipient[]
  teamChannelId: string | null
  salesChannelId: string | null
  closers: Closer[]
}

type AudienceKind = "hub-users" | "closers"
type ChannelKey = "team_watchlist" | "sales"

type NotificationDef = {
  id: string
  title: string
  destination: "dm" | "channel"
  /** Static label fallback for cards without an editable channel ID. */
  channelLabel: string
  /** When set, the card renders an editable input for the channel ID. */
  channelKey?: ChannelKey
  channelId?: string | null
  schedule: string
  previewEndpoint: string
  /** Cron URL — invoked with GET as admin to send the real notification to recipients now. */
  cronEndpoint: string
  description: string
  examplePreview: string
  audience: AudienceKind
}

export function NotificationsTab({
  slackConnected,
  recipients,
  teamChannelId,
  salesChannelId,
  closers: initialClosers,
}: Props) {
  const locale = useLocale()
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})

  // Closers list moved out of SSR to keep /settings fast — see the comment
  // in /api/admin/settings/closer-names/route.ts for context. Server passes
  // an empty `initialClosers` now; we hydrate via this query as soon as the
  // Notifications tab mounts. 30-min staleTime so flipping between tabs
  // doesn't re-pay the cost.
  const closersQuery = useQuery<{ closers: Closer[] }>({
    queryKey: ["settings-closers"],
    queryFn: () => fetch("/api/admin/settings/closer-names").then((r) => r.json()),
    staleTime: 30 * 60 * 1000,
    // Fall through to whatever the parent passed in (usually empty post-fix,
    // non-empty before this change) until the network call returns. Keeps
    // the dropdown populated immediately if we ever re-add SSR data.
    initialData: initialClosers.length > 0 ? { closers: initialClosers } : undefined,
  })
  const closers = closersQuery.data?.closers ?? initialClosers

  async function runPreview(id: string, endpoint: string) {
    setBusy((b) => ({ ...b, [id]: true }))
    setResults((r) => ({ ...r, [id]: { ok: false, message: "" } }))
    try {
      const res = await fetch(endpoint, { method: "POST" })
      const data = await res.json()
      setResults((r) => ({ ...r, [id]: data }))
    } catch {
      setResults((r) => ({ ...r, [id]: { ok: false, message: t("settings.notifications.request_failed", locale) } }))
    } finally {
      setBusy((b) => ({ ...b, [id]: false }))
    }
  }

  async function runSendNow(id: string, def: NotificationDef) {
    const audienceLabel =
      def.destination === "dm"
        ? def.audience === "closers"
          ? "alle closers/setters met een Slack ID"
          : "alle Hub users met een Slack ID"
        : `het Slack channel (${def.channelLabel.toLowerCase()})`
    const confirmed = window.confirm(
      `Verstuur "${def.title}" nu naar ${audienceLabel}?\n\nDit is geen test — de echte ontvangers krijgen het bericht.`,
    )
    if (!confirmed) return

    setBusy((b) => ({ ...b, [id]: true }))
    setResults((r) => ({ ...r, [id]: { ok: false, message: "" } }))
    try {
      const res = await fetch(`${def.cronEndpoint}?force=1`, { method: "GET" })
      const data = await res.json().catch(() => ({}))
      const ok = res.ok && data?.ok !== false
      const message = ok
        ? data?.skipped
          ? `Skipped: ${data.skipped}`
          : t("settings.notifications.sent_to_recipients", locale)
        : data?.error || `Failed (HTTP ${res.status})`
      setResults((r) => ({ ...r, [id]: { ok, message } }))
    } catch {
      setResults((r) => ({ ...r, [id]: { ok: false, message: t("settings.notifications.request_failed", locale) } }))
    } finally {
      setBusy((b) => ({ ...b, [id]: false }))
    }
  }

  const recipientsWithSlack = recipients.filter((r) => r.hasSlack)
  const recipientsMissing = recipients.filter((r) => !r.hasSlack)

  const notifications: NotificationDef[] = [
    {
      id: "personal_watchlist",
      title: "Personal Watchlist Summary",
      destination: "dm",
      channelLabel: "Direct Message — per Hub user",
      schedule: "Daily · 06:00 Europe/Amsterdam",
      previewEndpoint: "/api/slack/preview-daily-watchlist",
      cronEndpoint: "/api/cron/slack-daily-watchlist",
      audience: "hub-users",
      description:
        "Every Hub user with a Slack ID gets a personal morning DM about their own clients (filtered by column mapping). Focuses on changes since yesterday — new concerns, wins, persistent issues — not a copy of the watchlist.",
      examplePreview: `🌅 Goedemorgen. Een paar bewegingen overnight.

*Health score: 50% · ↑ 7pt vs gisteren · 7d avg building…*
🟢 20 healthy · 🟡 6 watch · 🔴 14 action

*⚠️ 7 nieuwe concerns vandaag*
• ProSteel → Action (was Healthy) — CPL up 43%
• Diamondflame → Watch (was Healthy) — CPL rising 8%
…en 5 meer

*✅ 10 wins vandaag*
• AltaDent → Watch (was Action) — CPL rising 18%
…en 9 meer

Open Watchlist`,
    },
    {
      id: "team_watchlist",
      title: "Team Watchlist Summary",
      destination: "channel",
      channelLabel: "Slack channel",
      channelKey: "team_watchlist",
      channelId: teamChannelId,
      schedule: "Daily · 06:00 Europe/Amsterdam",
      previewEndpoint: "/api/slack/preview-team-watchlist",
      cronEndpoint: "/api/cron/slack-team-watchlist",
      audience: "hub-users",
      description:
        "Team-wide overview posted to a shared Slack channel. No per-client details (those go to individual CMs already) — just team health, CM leaderboard, and a few overall observations.",
      examplePreview: `Happy Tuesday! ☕

*Health score: 50% · ↑ 7pt vs gisteren · 7d avg building…*
🟢 20 healthy · 🟡 6 watch · 🔴 14 action

*Campaign Manager ranking*
🥇 Roel & Mike — *68%* · 🟢 13 · 🟡 3 · 🔴 3
🥈 Danny & Stefan — *54%* · 🟢 7 · 🟡 3 · 🔴 3

*Revenue ranking — deze maand*
🥇 Roel & Mike — *€32.4k* (MRR €27.3k · new biz €5.1k)
🥈 Danny & Stefan — *€30.1k* (MRR €18.9k · new biz €11.3k)

Open Watchlist`,
    },
    {
      id: "personal_sales",
      title: "Personal Sales Summary",
      destination: "dm",
      channelLabel: "Direct Message — per closer/setter",
      schedule: "Daily · 06:00 Europe/Amsterdam",
      previewEndpoint: "/api/slack/preview-daily-sales",
      cronEndpoint: "/api/cron/slack-personal-sales",
      audience: "closers",
      description:
        "Every closer/setter mapped to a Slack ID gets a personal morning DM with yesterday's calls + status breakdown, today's planned calls, MTD progress vs targets, and any past appointments still in pre-call status.",
      examplePreview: `Goedemorgen Anel.

*Gisteren*
• 4 calls totaal
• 2× DEAL · 1× No deal/FU · 1× No show

*Vandaag*
• 3 calls ingepland

*Deze maand (mei)*
• 38 taken calls
• 12/30 deals
• €27.4k / €60.0k revenue
• Conversion: 32% (target 30%)

*Empty call outcomes — 2*
• Acme BV — 3 dagen terug, status nog "Qualified"
• Beta NV — 5 dagen terug, status nog "Gepland"

Open Targets`,
    },
    {
      id: "team_sales",
      title: "Team Sales Summary",
      destination: "channel",
      channelLabel: "Slack channel",
      channelKey: "sales",
      channelId: salesChannelId,
      schedule: "Daily · 06:00 Europe/Amsterdam",
      previewEndpoint: "/api/slack/preview-team-sales",
      cronEndpoint: "/api/cron/slack-team-sales",
      audience: "closers",
      description:
        "Team-wide sales overview posted to the sales channel. Aggregated yesterday/today/MTD numbers across all closers, plus a leaderboard sorted by deals.",
      examplePreview: `Goedemorgen sales team! ☕

*Gisteren*
• Sebastiaan: 2 calls — 1× DEAL · 1× No deal/FU
• Anel: 4 calls — 3× DEAL · 1× No show

*Vandaag*
• 4 calls ingepland bij Anel, 2 bij Sebastiaan en 1 bij Jill

:rotating_light: *Empty call outcomes*
2 bij Sebastiaan en 1 bij Anel — checken in Monday

*Deze maand (mei)*
• 96 booked calls
• 79 taken calls
• Show-up: 82% (target 80%)
• 28/60 deals · 🔴 87% pace
• €62.1k / €120.0k revenue · 🟢 102% pace
• Conversion: 29% (target 30%)

*Leaderboard — deze maand*
🥇 Anel — *12 deals* · €27.4k · 32%
🥈 Jill — *9 deals* · €19.8k · 28%
🥉 Sebastiaan — *7 deals* · €14.9k · 26%

Open Targets`,
    },
  ]

  const testDmNotification = {
    id: "test_dm",
    title: "Connection Test",
    description: "Send a 'hello' DM to your own Slack to verify the integration works end-to-end.",
    endpoint: "/api/slack/test-dm",
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          {t("settings.notifications.intro", locale)}
        </p>
      </div>

      {/* ─── Slack section ─── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-border/40">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("settings.notifications.slack_section", locale)}</h3>
        </div>

        {!slackConnected && (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm">
            <p className="text-yellow-500 font-medium">{t("settings.notifications.slack_not_connected.title", locale)}</p>
            <p className="text-muted-foreground text-xs mt-1">
              {t("settings.notifications.slack_not_connected.body_before", locale)}
              <span className="font-medium">{t("settings.notifications.slack_not_connected.tokens_tab", locale)}</span>
              {t("settings.notifications.slack_not_connected.body_middle", locale)}
              <span className="font-medium">{t("settings.notifications.slack_not_connected.mapping_tab", locale)}</span>
              {t("settings.notifications.slack_not_connected.body_after", locale)}
            </p>
          </div>
        )}

        {/* Test DM card — small utility */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">{testDmNotification.title}</CardTitle>
            </div>
            <CardDescription>{testDmNotification.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runPreview(testDmNotification.id, testDmNotification.endpoint)}
              disabled={busy[testDmNotification.id] || !slackConnected}
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              {busy[testDmNotification.id] ? t("settings.notifications.action.sending", locale) : t("settings.notifications.action.send_test_dm", locale)}
            </Button>
            {results[testDmNotification.id]?.message && (
              <p
                className={`text-sm mt-2 ${
                  results[testDmNotification.id].ok ? "text-green-500" : "text-red-500"
                }`}
              >
                {results[testDmNotification.id].message}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Real notifications */}
        {notifications.map((n) => {
          const audienceWith =
            n.audience === "closers"
              ? closers
                  .filter((c) => c.slackId)
                  .map((c) => ({ name: c.name, email: c.name, hasSlack: true }))
              : recipientsWithSlack
          const audienceMissing =
            n.audience === "closers"
              ? closers
                  .filter((c) => !c.slackId)
                  .map((c) => ({ name: c.name, email: c.name, hasSlack: false }))
              : recipientsMissing
          return (
            <NotificationCard
              key={n.id}
              def={n}
              slackConnected={slackConnected}
              busy={!!busy[n.id]}
              result={results[n.id]}
              onPreview={() => runPreview(n.id, n.previewEndpoint)}
              onSendNow={() => runSendNow(n.id, n)}
              recipientsWithSlack={audienceWith}
              recipientsMissing={audienceMissing}
              locale={locale}
            />
          )
        })}

        <CloserSlackMappingCard closers={closers} />
      </div>
    </div>
  )
}

function NotificationCard({
  def,
  slackConnected,
  busy,
  result,
  onPreview,
  onSendNow,
  recipientsWithSlack,
  recipientsMissing,
  locale,
}: {
  def: NotificationDef
  slackConnected: boolean
  busy: boolean
  result?: { ok: boolean; message: string }
  onPreview: () => void
  onSendNow: () => void
  recipientsWithSlack: Recipient[]
  recipientsMissing: Recipient[]
  locale: Locale
}) {
  const [showExample, setShowExample] = useState(false)
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <Bell className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
            <div className="min-w-0">
              <CardTitle className="text-base">{def.title}</CardTitle>
              <CardDescription className="mt-1">{def.description}</CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Metadata grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="rounded-md bg-muted/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">
              {t("settings.notifications.metadata.schedule", locale)}
            </div>
            <div className="font-medium text-foreground">{def.schedule}</div>
          </div>
          <div className="rounded-md bg-muted/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">
              {t("settings.notifications.metadata.destination", locale)}
            </div>
            {def.channelKey ? (
              <ChannelIdEditor channelKey={def.channelKey} initial={def.channelId ?? ""} />
            ) : (
              <div className="font-medium text-foreground font-mono text-xs">{def.channelLabel}</div>
            )}
          </div>
        </div>

        {/* Recipients (only relevant for DM-type) */}
        {def.destination === "dm" && (
          <div className="rounded-md bg-muted/30 px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1.5">
              <Users className="h-3 w-3" />
              {t("settings.notifications.metadata.recipients", locale)}
            </div>
            {recipientsWithSlack.length === 0 ? (
              <p className="text-muted-foreground italic">
                {t("settings.notifications.recipients.empty", locale)}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {recipientsWithSlack.map((r) => (
                  <span
                    key={r.email}
                    className="inline-block px-2 py-0.5 rounded bg-green-500/15 text-green-500 text-[11px]"
                  >
                    {r.name ?? r.email}
                  </span>
                ))}
                {recipientsMissing.map((r) => (
                  <span
                    key={r.email}
                    className="inline-block px-2 py-0.5 rounded bg-muted text-muted-foreground/60 text-[11px]"
                    title={t("settings.notifications.recipients.no_slack_title", locale)}
                  >
                    {r.name ?? r.email} {t("settings.notifications.recipients.no_slack", locale)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Example preview toggle */}
        <div>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground underline"
            onClick={() => setShowExample((s) => !s)}
          >
            {showExample ? t("settings.notifications.example.hide", locale) : t("settings.notifications.example.show", locale)}
          </button>
          {showExample && (
            <pre className="mt-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-xs whitespace-pre-wrap font-mono leading-relaxed text-foreground/90">
              {def.examplePreview}
            </pre>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={onPreview} disabled={busy || !slackConnected}>
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {busy ? t("settings.notifications.action.working", locale) : t("settings.notifications.action.preview_to_me", locale)}
          </Button>
          <Button size="sm" onClick={onSendNow} disabled={busy || !slackConnected}>
            <Zap className="h-3.5 w-3.5 mr-1.5" />
            {busy ? t("settings.notifications.action.sending", locale) : t("settings.notifications.action.send_now", locale)}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium">{t("settings.notifications.footer.preview_label", locale)}</span>:{" "}
          {def.destination === "channel"
            ? t("settings.notifications.footer.preview_channel", locale)
            : t("settings.notifications.footer.preview_dm", locale)}{" "}
          ·{" "}
          <span className="font-medium">{t("settings.notifications.footer.send_label", locale)}</span>:{" "}
          {def.destination === "channel"
            ? t("settings.notifications.footer.send_channel", locale)
            : def.audience === "closers"
              ? t("settings.notifications.footer.send_dm_closers", locale)
              : t("settings.notifications.footer.send_dm_users", locale)}
        </p>
        {result?.message && (
          <p className={`text-sm ${result.ok ? "text-green-500" : "text-red-500"}`}>{result.message}</p>
        )}
      </CardContent>
    </Card>
  )
}

function ChannelIdEditor({
  channelKey,
  initial,
}: {
  channelKey: ChannelKey
  initial: string
}) {
  const locale = useLocale()
  const [value, setValue] = useState(initial)
  const [savedValue, setSavedValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function commit() {
    if (value.trim() === savedValue) return
    startTransition(async () => {
      try {
        await saveSlackChannelId(channelKey, value)
        setSavedValue(value.trim())
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : t("settings.notifications.save_failed", locale))
      }
    })
  }

  const dirty = value.trim() !== savedValue
  const status = pending ? "saving" : error ? "error" : dirty ? "dirty" : value ? "saved" : "empty"

  return (
    <div className="flex items-center gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur()
        }}
        placeholder="C0B02NG6V39"
        className="h-7 font-mono text-xs"
      />
      <div className="w-4 shrink-0 flex items-center justify-center">
        {status === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {status === "saved" && <Check className="h-3.5 w-3.5 text-green-500" />}
        {status === "dirty" && <span className="h-2 w-2 rounded-full bg-yellow-500" title="Unsaved" />}
        {status === "error" && (
          <span className="h-2 w-2 rounded-full bg-red-500" title={error ?? "Save failed"} />
        )}
      </div>
    </div>
  )
}

function CloserSlackMappingCard({ closers }: { closers: Closer[] }) {
  const locale = useLocale()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [savedMap, setSavedMap] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const c of closers) if (c.slackId) m[c.name] = c.slackId
    return m
  })

  async function commit(name: string) {
    const draft = drafts[name]
    if (draft === undefined) return
    const trimmed = draft.trim()
    if ((savedMap[name] ?? "") === trimmed) return
    setSaving((s) => ({ ...s, [name]: true }))
    try {
      await updateCloserSlackId(name, trimmed)
      setSavedMap((m) => {
        const next = { ...m }
        if (trimmed) next[name] = trimmed
        else delete next[name]
        return next
      })
      setDrafts((d) => {
        const { [name]: _drop, ...rest } = d
        return rest
      })
    } catch (e) {
      console.error(e)
    } finally {
      setSaving((s) => ({ ...s, [name]: false }))
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-2">
          <Bell className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
          <div>
            <CardTitle className="text-base">{t("settings.notifications.closers.title", locale)}</CardTitle>
            <CardDescription className="mt-1">
              Map each closer/setter (from the targets board <code className="font-mono text-xs">wie_</code> column,
              filtered to anyone with leads in the last 60 days) to a Slack user ID so they receive
              their personal sales DM at 06:00. Closers don&apos;t need to be Hub users.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("settings.notifications.closers.col_name", locale)}</TableHead>
                <TableHead className="w-[260px]">{t("settings.notifications.closers.col_slack", locale)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {closers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-sm text-muted-foreground italic py-4">
                    {t("settings.notifications.closers.empty", locale)}
                  </TableCell>
                </TableRow>
              ) : (
                closers.map((c) => {
                  const draft = drafts[c.name] ?? savedMap[c.name] ?? ""
                  const trimmed = draft.trim()
                  const isSaving = !!saving[c.name]
                  const savedValue = savedMap[c.name] ?? ""
                  const isDirty = trimmed !== savedValue
                  const isSaved = !isDirty && trimmed.length > 0
                  return (
                    <TableRow key={c.name}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Input
                            placeholder="U01ABC234XY"
                            className="h-8 font-mono text-xs"
                            value={draft}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [c.name]: e.target.value }))
                            }
                            onBlur={() => commit(c.name)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault()
                                ;(e.target as HTMLInputElement).blur()
                              }
                            }}
                          />
                          <div className="w-4 shrink-0 flex items-center justify-center">
                            {isSaving && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            )}
                            {!isSaving && isDirty && trimmed.length > 0 && (
                              <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" title={t("settings.notifications.closers.row.unsaved", locale)} />
                            )}
                            {!isSaving && isSaved && (
                              <Check className="h-3.5 w-3.5 text-green-500" aria-label={t("settings.notifications.closers.row.saved", locale)} />
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
