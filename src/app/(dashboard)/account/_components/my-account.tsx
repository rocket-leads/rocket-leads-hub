"use client"

import { useEffect, useState, useTransition } from "react"
import {
  MessageSquare,
  LayoutGrid,
  Hash,
  Inbox,
  Loader2,
  Check,
  X,
  ExternalLink,
  Bell,
  BellOff,
} from "lucide-react"
import {
  connectMyPlatform,
  disconnectMyPlatform,
  saveMyTrengoChannels,
} from "../actions"
import { Button } from "@/components/ui/button"
import type { UserPlatformConnection, Platform } from "@/lib/inbox/user-platform-tokens"

type Props = {
  userName: string
  userEmail: string
  slack: UserPlatformConnection | null
  trengo: UserPlatformConnection | null
  monday: UserPlatformConnection | null
  trengoChannelIds: number[]
  slackError: string | null
}

export function MyAccount({
  userName,
  userEmail,
  slack,
  trengo,
  monday,
  trengoChannelIds,
  slackError,
}: Props) {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="rounded-xl border border-border/60 bg-card px-4 py-3">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">Signed in as</p>
        <p className="text-sm font-medium mt-0.5">{userName}</p>
        <p className="text-[11px] text-muted-foreground/60">{userEmail}</p>
      </div>

      <div>
        <h2 className="text-sm font-medium mb-1">Platform connections</h2>
        <p className="text-xs text-muted-foreground/60 mb-4">
          Tokens are AES-256-GCM encrypted before they touch the database. They&apos;re only used when you reply to a chat from the Hub.
        </p>

        <div className="space-y-3">
          <SlackCard connection={slack} initialError={slackError} />
          <TrengoCard connection={trengo} />
          <MondayCard connection={monday} />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium mb-1">Browser notifications</h2>
        <p className="text-xs text-muted-foreground/60 mb-4">
          Krijg een melding op je desktop of telefoon zodra er een nieuwe taak op je naam komt — ook als de Hub-tab dicht is.
        </p>
        <BrowserNotificationsCard />
      </div>

      <div>
        <h2 className="text-sm font-medium mb-1">Inbox subscriptions</h2>
        <p className="text-xs text-muted-foreground/60 mb-4">
          Pick which Trengo channels surface in your Client Inbox — including conversations from contacts that aren&apos;t linked to a client yet.
        </p>
        <TrengoChannelsCard initialSelected={trengoChannelIds} />
      </div>
    </div>
  )
}

// --- Slack (OAuth — coming in C.4) ---

const SLACK_ERROR_MESSAGES: Record<string, string> = {
  oauth_not_configured:
    "Slack OAuth isn't set up on this deployment yet. An admin needs to create a Slack app and add SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET to the environment.",
  start_failed: "Couldn't start the Slack connect flow. Please try again or contact an admin.",
  missing_code_or_state: "Slack returned without a code. Try connecting again.",
  missing_state_cookie: "Your browser blocked the OAuth state cookie. Try again in a non-incognito window.",
  state_mismatch: "OAuth state mismatch — possible CSRF or expired flow. Try again.",
  exchange_failed: "Slack rejected the OAuth code exchange. Try again.",
  oauth_failed: "Slack reported an OAuth failure. Try again.",
  store_failed: "Couldn't save your Slack token. Try again or contact an admin.",
  access_denied: "You cancelled the Slack authorization.",
}

function SlackCard({
  connection,
  initialError,
}: {
  connection: UserPlatformConnection | null
  initialError: string | null
}) {
  const [pending, setPending] = useState<"disconnecting" | null>(null)
  const [error, setError] = useState<string | null>(
    initialError ? SLACK_ERROR_MESSAGES[initialError] ?? `Slack connect failed (${initialError}).` : null,
  )
  const [, startTransition] = useTransition()

  function disconnect() {
    setPending("disconnecting")
    setError(null)
    startTransition(async () => {
      try {
        await disconnectMyPlatform("slack")
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to disconnect")
      } finally {
        setPending(null)
      }
    })
  }

  return (
    <PlatformCard
      icon={<Hash className="h-4 w-4" />}
      tone="purple"
      name="Slack"
      description="Connect via OAuth so replies post in Slack as you, in the right channel or DM."
      connected={!!connection}
      meta={connection?.meta}
      connectedAt={connection?.connectedAt}
    >
      {connection ? (
        <Button
          variant="outline"
          size="sm"
          onClick={disconnect}
          disabled={pending !== null}
        >
          {pending === "disconnecting" ? <Loader2 className="animate-spin" /> : <X />}
          Disconnect
        </Button>
      ) : (
        // Server-side redirect to Slack OAuth — using a plain <a> (not next/link)
        // so the browser does a full navigation rather than client-side route.
        <Button
          size="sm"
          render={
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a href="/api/auth/slack/start" />
          }
        >
          <ExternalLink />
          Connect Slack
        </Button>
      )}
      {error && <p className="text-[11px] text-destructive mt-2">{error}</p>}
    </PlatformCard>
  )
}

// --- Trengo (personal API token) ---

function TrengoCard({ connection }: { connection: UserPlatformConnection | null }) {
  return (
    <TokenInputCard
      platform="trengo"
      icon={<MessageSquare className="h-4 w-4" />}
      tone="cyan"
      name="Trengo"
      description="Paste your personal Trengo API token. Find it in Trengo → Settings → API tokens."
      helpUrl="https://app.trengo.com/admin/api-tokens"
      placeholder="Trengo personal access token"
      connection={connection}
    />
  )
}

// --- Monday (personal API token) ---

function MondayCard({ connection }: { connection: UserPlatformConnection | null }) {
  return (
    <TokenInputCard
      platform="monday"
      icon={<LayoutGrid className="h-4 w-4" />}
      tone="orange"
      name="Monday"
      description="Paste your personal Monday API token. Find it in Monday → avatar (top-right) → Developers → Personal API token."
      helpUrl="https://rocketleads-team.monday.com/apps/manage/tokens"
      placeholder="Monday personal API token"
      connection={connection}
    />
  )
}

// --- Reusable token-input card ---

function TokenInputCard({
  platform,
  icon,
  tone,
  name,
  description,
  helpUrl,
  placeholder,
  connection,
}: {
  platform: Platform
  icon: React.ReactNode
  tone: "purple" | "cyan" | "orange"
  name: string
  description: string
  helpUrl: string
  placeholder: string
  connection: UserPlatformConnection | null
}) {
  const [token, setToken] = useState("")
  const [pending, setPending] = useState<"connecting" | "disconnecting" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function connect() {
    if (!token.trim()) return
    setPending("connecting")
    setError(null)
    startTransition(async () => {
      try {
        await connectMyPlatform(platform, token.trim())
        setToken("")
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to connect")
      } finally {
        setPending(null)
      }
    })
  }

  function disconnect() {
    setPending("disconnecting")
    setError(null)
    startTransition(async () => {
      try {
        await disconnectMyPlatform(platform)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to disconnect")
      } finally {
        setPending(null)
      }
    })
  }

  return (
    <PlatformCard
      icon={icon}
      tone={tone}
      name={name}
      description={description}
      connected={!!connection}
      meta={connection?.meta}
      connectedAt={connection?.connectedAt}
    >
      {connection ? (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={disconnect}
            disabled={pending !== null}
          >
            {pending === "disconnecting" ? <Loader2 className="animate-spin" /> : <X />}
            Disconnect
          </Button>
          <a
            href={helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Where to find your token
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={placeholder}
              disabled={pending !== null}
              className="flex-1 h-8 px-3 rounded-md border border-border bg-background text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              onKeyDown={(e) => {
                if (e.key === "Enter" && token.trim() && !pending) connect()
              }}
            />
            <button
              type="button"
              onClick={connect}
              disabled={!token.trim() || pending !== null}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {pending === "connecting" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Connect
            </button>
          </div>
          <a
            href={helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Where to find your token
          </a>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-destructive mt-2">{error}</p>
      )}
    </PlatformCard>
  )
}

// --- Trengo channel subscriptions ---

type TrengoChannelOption = { id: number; name: string; type: string }

function TrengoChannelsCard({ initialSelected }: { initialSelected: number[] }) {
  const [channels, setChannels] = useState<TrengoChannelOption[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set(initialSelected))
  const [pending, startTransition] = useTransition()
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/integrations/trengo/channels")
      .then(async (r) => {
        const json = await r.json()
        if (!r.ok) throw new Error(json.error ?? "Failed to load channels")
        return json
      })
      .then((data: { channels: TrengoChannelOption[] }) => {
        if (cancelled) return
        setChannels(data.channels)
      })
      .catch((e) => {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : "Failed to load channels")
      })
    return () => {
      cancelled = true
    }
  }, [])

  function persist(next: Set<number>) {
    setSaveError(null)
    startTransition(async () => {
      try {
        await saveMyTrengoChannels(Array.from(next))
        setSavedAt(Date.now())
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Failed to save")
      }
    })
  }

  function toggle(id: number) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
    persist(next)
  }

  function selectAll() {
    if (!channels) return
    const next = new Set(channels.map((c) => c.id))
    setSelected(next)
    persist(next)
  }

  function clearAll() {
    const next = new Set<number>()
    setSelected(next)
    persist(next)
  }

  // Group by type so users see "Email", "WhatsApp", "Voice" sections.
  const grouped: Record<string, TrengoChannelOption[]> = {}
  if (channels) {
    for (const c of channels) {
      const key = c.type || "other"
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(c)
    }
  }
  const groupOrder = Object.keys(grouped).sort()

  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-4">
      <div className="flex items-start gap-4">
        <div className="h-9 w-9 rounded-lg bg-cyan-500/10 text-cyan-500 flex items-center justify-center shrink-0">
          <Inbox className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <p className="text-sm font-semibold">Trengo channels</p>
            <div className="flex items-center gap-3 text-[11px]">
              {pending && (
                <span className="inline-flex items-center gap-1 text-muted-foreground/60">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving…
                </span>
              )}
              {!pending && savedAt && (
                <span className="text-emerald-500">Saved</span>
              )}
              <span className="text-muted-foreground/60 tabular-nums">
                {selected.size} selected
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground/80 leading-relaxed mb-3">
            Tickets from selected channels appear in your Client Inbox even when the contact isn&apos;t linked to a client.
          </p>

          {loadError && (
            <div className="text-[11px] text-destructive mb-3">{loadError}</div>
          )}

          {!channels && !loadError && (
            <div className="text-[11px] text-muted-foreground/60 inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading channels…
            </div>
          )}

          {channels && (
            <>
              <div className="flex items-center gap-2 mb-3">
                <button
                  type="button"
                  onClick={selectAll}
                  disabled={pending || channels.length === 0}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  Select all
                </button>
                <span className="text-muted-foreground/30">·</span>
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={pending || selected.size === 0}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
              {channels.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/60">
                  No channels found in this Trengo workspace.
                </p>
              ) : (
                <div className="space-y-3">
                  {groupOrder.map((group) => (
                    <div key={group}>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-1.5">
                        {group}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {grouped[group].map((c) => {
                          const isSelected = selected.has(c.id)
                          return (
                            <label
                              key={c.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 cursor-pointer transition-colors"
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggle(c.id)}
                                disabled={pending}
                                className="h-3.5 w-3.5 rounded border-border accent-foreground"
                              />
                              <span className="text-xs truncate">{c.name}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {saveError && (
            <p className="text-[11px] text-destructive mt-2">{saveError}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Shared card shell ---

const TONE_CLASSES = {
  purple: { bg: "bg-purple-500/10", text: "text-purple-500" },
  cyan: { bg: "bg-cyan-500/10", text: "text-cyan-500" },
  orange: { bg: "bg-orange-500/10", text: "text-orange-500" },
} as const

function PlatformCard({
  icon,
  tone,
  name,
  description,
  connected,
  meta,
  connectedAt,
  children,
}: {
  icon: React.ReactNode
  tone: keyof typeof TONE_CLASSES
  name: string
  description: string
  connected: boolean
  meta: Record<string, unknown> | null | undefined
  connectedAt: string | undefined
  children: React.ReactNode
}) {
  const t = TONE_CLASSES[tone]
  return (
    <div className={`rounded-xl border ${connected ? "border-border" : "border-border/40"} bg-card px-4 py-4`}>
      <div className="flex items-start gap-4">
        <div className={`h-9 w-9 rounded-lg ${t.bg} ${t.text} flex items-center justify-center shrink-0`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <p className="text-sm font-semibold">{name}</p>
            {connected ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Connected
                {connectedAt && (
                  <span className="text-muted-foreground/50 font-normal ml-1">
                    · {new Date(connectedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground/60">Not connected</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground/80 leading-relaxed mb-3">{description}</p>
          {connected && meta && Object.keys(meta).length > 0 && (
            <div className="text-[10px] text-muted-foreground/50 mb-3 font-mono truncate">
              {Object.entries(meta)
                .slice(0, 3)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(" · ")}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}

// --- Browser notifications (Phase F) -------------------------------------

/** Convert the URL-safe base64 VAPID key to a Uint8Array, which the
 *  browser PushManager.subscribe API needs as the application server key. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const decoded = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(decoded)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function BrowserNotificationsCard() {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [permission, setPermission] = useState<NotificationPermission>("default")
  const [subscribed, setSubscribed] = useState<boolean>(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

  // Detect Service Worker + Notification support and check current state.
  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    setSupported(ok)
    if (!ok) return
    setPermission(Notification.permission)
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => setSubscribed(false))
  }, [])

  async function enable() {
    if (!supported) return
    if (!vapidKey) {
      setError("Server-side push is nog niet geconfigureerd (VAPID keys ontbreken).")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const reg = await navigator.serviceWorker.register("/sw.js")
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== "granted") {
        setBusy(false)
        return
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // PushManager's TS types want a BufferSource — Uint8Array on a
        // SharedArrayBuffer is too narrow. Cast through unknown to keep TS
        // happy without leaking SharedArrayBuffer constraints into our code.
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as BufferSource,
      })
      const res = await fetch("/api/notifications/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          userAgent: navigator.userAgent,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? "Server kon de subscription niet opslaan.")
      }
      setSubscribed(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kon notificaties niet inschakelen.")
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    if (!supported) return
    setBusy(true)
    setError(null)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch(
          `/api/notifications/push-subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`,
          { method: "DELETE" },
        )
        await sub.unsubscribe()
      }
      setSubscribed(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kon notificaties niet uitschakelen.")
    } finally {
      setBusy(false)
    }
  }

  const [testInfo, setTestInfo] = useState<string | null>(null)
  async function sendTestPush() {
    setError(null)
    setTestInfo(null)
    try {
      const res = await fetch("/api/notifications/test-push", { method: "POST" })
      const data = (await res.json().catch(() => ({}))) as {
        delivered?: number
        cleanedUp?: number
        error?: string
        userId?: string
        vapidConfigured?: boolean
        subscriptionsBeforeSend?: Array<{
          id: string
          endpointHost: string
          userAgent: string | null
          createdAt: string
        }>
      }
      if (!res.ok) {
        setError(data.error ?? "Test failed")
        return
      }
      // Surface enough state to debug end-to-end without DevTools spelunking.
      const subs = data.subscriptionsBeforeSend ?? []
      const lines: string[] = []
      lines.push(`User: ${data.userId?.slice(0, 8)}…`)
      lines.push(`VAPID configured: ${data.vapidConfigured ? "yes" : "NO — server side env missing"}`)
      lines.push(`Subscriptions in DB: ${subs.length}`)
      for (const s of subs) {
        lines.push(`  • ${s.endpointHost} (since ${s.createdAt.slice(0, 10)})`)
      }
      lines.push(`Delivered this run: ${data.delivered ?? 0}`)
      if (data.cleanedUp) lines.push(`Cleaned up dead: ${data.cleanedUp}`)
      setTestInfo(lines.join("\n"))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed")
    }
  }

  if (supported === null) {
    return (
      <div className="rounded-xl border border-border/60 bg-card px-4 py-4">
        <div className="text-xs text-muted-foreground/60">Loading…</div>
      </div>
    )
  }

  if (!supported) {
    return (
      <div className="rounded-xl border border-border/40 bg-muted/20 px-4 py-4 text-xs text-muted-foreground">
        Deze browser ondersteunt geen push notificaties (Safari op iOS pas vanaf 16.4).
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-4">
      <div className="flex items-start gap-4">
        <div
          className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
            subscribed ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
          }`}
        >
          {subscribed ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-1">
            <p className="text-sm font-semibold">
              {subscribed ? "Notificaties staan aan" : "Notificaties zijn uit"}
            </p>
            {subscribed ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Actief
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground/60">
                {permission === "denied" ? "Geblokkeerd door browser" : "Uit"}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground/80 leading-relaxed mb-3">
            {subscribed
              ? "Je krijgt nu desktop/mobiele meldingen voor nieuwe taken. Werkt op deze browser; herhaal op andere apparaten als je daar ook gepingd wilt worden."
              : permission === "denied"
                ? "Je hebt eerder de toestemming geweigerd. Open je browser-instellingen en sta meldingen toe voor deze site om opnieuw te proberen."
                : "Eén klik om aan te zetten — je browser vraagt toestemming."}
          </p>
          {error && <p className="text-[11px] text-destructive mb-2">{error}</p>}
          {testInfo && (
            <pre className="text-[11px] text-muted-foreground mb-2 whitespace-pre-wrap font-mono leading-relaxed">
              {testInfo}
            </pre>
          )}
          <div className="flex items-center gap-2">
            {subscribed ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={disable}
                  disabled={busy}
                >
                  {busy ? <Loader2 className="animate-spin" /> : <X />}
                  Uitschakelen
                </Button>
                <Button variant="outline" size="sm" onClick={sendTestPush}>
                  <Bell />
                  Stuur test
                </Button>
              </>
            ) : (
              <button
                type="button"
                onClick={enable}
                disabled={busy || permission === "denied"}
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                Inschakelen
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
