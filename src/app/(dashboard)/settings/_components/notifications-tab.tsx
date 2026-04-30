"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Bell, MessageSquare, Send, Users } from "lucide-react"

type Recipient = {
  name: string | null
  email: string
  hasSlack: boolean
}

type Props = {
  slackConnected: boolean
  recipients: Recipient[]
  teamChannelId: string | null
}

type NotificationDef = {
  id: string
  title: string
  destination: "dm" | "channel"
  channelLabel: string
  schedule: string
  previewEndpoint: string
  description: string
  examplePreview: string
}

export function NotificationsTab({ slackConnected, recipients, teamChannelId }: Props) {
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})

  async function runPreview(id: string, endpoint: string) {
    setBusy((b) => ({ ...b, [id]: true }))
    setResults((r) => ({ ...r, [id]: { ok: false, message: "" } }))
    try {
      const res = await fetch(endpoint, { method: "POST" })
      const data = await res.json()
      setResults((r) => ({ ...r, [id]: data }))
    } catch {
      setResults((r) => ({ ...r, [id]: { ok: false, message: "Request failed" } }))
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
      channelLabel: teamChannelId ? `Slack channel ${teamChannelId}` : "Channel — env var SLACK_TEAM_CHANNEL_ID required",
      schedule: "Daily · 06:00 Europe/Amsterdam",
      previewEndpoint: "/api/slack/preview-team-watchlist",
      description:
        "Team-wide overview posted to a shared Slack channel. No per-client details (those go to individual CMs already) — just team health, CM leaderboard, and a few overall observations.",
      examplePreview: `Happy Tuesday! ☕

*Health score: 50% · ↑ 7pt vs gisteren · 7d avg building…*
🟢 20 healthy · 🟡 6 watch · 🔴 14 action

*🏆 Campaign Manager ranking*
🥇 Mike Sauer — *75%* · 🟢 12 · 🟡 2 · 🔴 2
🥈 Stefan vd Wijdeven — *56%* · 🟢 9 · 🟡 3 · 🔴 4
🥉 Danny Palmeri — *45%* · 🟢 5 · 🟡 2 · 🔴 4

*Team pulse*
• 1 van 4 CMs op of boven het 75% target
• Mike leidt 21pt boven team-gemiddelde

Open Watchlist`,
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
          Manage automated notifications sent from the Hub. Each notification has a preview button
          that posts to your own Slack DM — safe to test without spamming the team.
        </p>
      </div>

      {/* ─── Slack section ─── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-border/40">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Slack</h3>
        </div>

        {!slackConnected && (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm">
            <p className="text-yellow-500 font-medium">Slack token not connected</p>
            <p className="text-muted-foreground text-xs mt-1">
              Connect a Slack Bot Token in <span className="font-medium">API Tokens</span> first,
              then map Hub users to Slack user IDs in <span className="font-medium">Column Mapping</span>.
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
              {busy[testDmNotification.id] ? "Sending..." : "Send test DM to me"}
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
        {notifications.map((n) => (
          <NotificationCard
            key={n.id}
            def={n}
            slackConnected={slackConnected}
            busy={!!busy[n.id]}
            result={results[n.id]}
            onPreview={() => runPreview(n.id, n.previewEndpoint)}
            recipientsWithSlack={recipientsWithSlack}
            recipientsMissing={recipientsMissing}
          />
        ))}
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
  recipientsWithSlack,
  recipientsMissing,
}: {
  def: NotificationDef
  slackConnected: boolean
  busy: boolean
  result?: { ok: boolean; message: string }
  onPreview: () => void
  recipientsWithSlack: Recipient[]
  recipientsMissing: Recipient[]
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
              Schedule
            </div>
            <div className="font-medium text-foreground">{def.schedule}</div>
          </div>
          <div className="rounded-md bg-muted/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">
              Destination
            </div>
            <div className="font-medium text-foreground font-mono text-xs">{def.channelLabel}</div>
          </div>
        </div>

        {/* Recipients (only relevant for DM-type) */}
        {def.destination === "dm" && (
          <div className="rounded-md bg-muted/30 px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1.5">
              <Users className="h-3 w-3" />
              Recipients
            </div>
            {recipientsWithSlack.length === 0 ? (
              <p className="text-muted-foreground italic">
                No users have a Slack ID configured yet — add one in Column Mapping.
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
                    title="No Slack ID set — won't receive notifications"
                  >
                    {r.name ?? r.email} (no Slack ID)
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
            {showExample ? "Hide example" : "Show example format"}
          </button>
          {showExample && (
            <pre className="mt-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-xs whitespace-pre-wrap font-mono leading-relaxed text-foreground/90">
              {def.examplePreview}
            </pre>
          )}
        </div>

        {/* Preview action */}
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={onPreview} disabled={busy || !slackConnected}>
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {busy ? "Building summary..." : `Preview to me`}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {def.destination === "channel"
              ? "Sends to your DM (not the channel) for safe testing."
              : "Sends to your Slack with live data."}
          </span>
        </div>
        {result?.message && (
          <p className={`text-sm ${result.ok ? "text-green-500" : "text-red-500"}`}>{result.message}</p>
        )}
      </CardContent>
    </Card>
  )
}
