"use client"

import { useEffect, useRef, useState, useTransition } from "react"
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
  Calendar as CalendarIcon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { Camera, Trash2 } from "lucide-react"
import {
  connectMyPlatform,
  disconnectMyPlatform,
  saveMyTrengoChannels,
  updateMyAvatar,
  removeMyAvatar,
} from "../actions"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/ui/user-avatar"
import { resizeImageToSquareJpeg } from "@/lib/image-resize"
import type { UserPlatformConnection, Platform } from "@/lib/inbox/user-platform-tokens"
import type { GoogleCalendarConnection } from "@/app/(dashboard)/settings/_components/me-tab"

type Props = {
  userId: string
  userName: string
  userEmail: string
  avatarUrl: string | null
  slack: UserPlatformConnection | null
  trengo: UserPlatformConnection | null
  monday: UserPlatformConnection | null
  trengoChannelIds: number[]
  slackError: string | null
  googleCalendar: GoogleCalendarConnection
}

export function MyAccount({
  userName,
  userEmail,
  avatarUrl,
  slack,
  trengo,
  monday,
  trengoChannelIds,
  slackError,
  googleCalendar,
}: Props) {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="rounded-xl border border-border/60 bg-card px-4 py-3">
        <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/60 font-medium">Signed in as</p>
        <div className="mt-2 flex items-center gap-4">
          <AvatarEditor userName={userName} avatarUrl={avatarUrl} />
          <div className="min-w-0">
            <p className="text-sm font-medium">{userName}</p>
            <p className="text-[11px] text-muted-foreground/60">{userEmail}</p>
          </div>
        </div>
      </div>

      <div>
        <h2 className="section-title mb-4">Platform connections</h2>
        <div className="space-y-3">
          <GoogleCalendarCard
            connection={googleCalendar}
            signInEmail={userEmail}
          />
          <SlackCard connection={slack} initialError={slackError} />
          <TrengoCard connection={trengo} />
          <MondayCard connection={monday} />
        </div>
      </div>

      <div>
        <h2 className="section-title mb-4">Browser notifications</h2>
        <BrowserNotificationsCard />
      </div>

      <div>
        <h2 className="section-title mb-4">Inbox subscriptions</h2>
        <TrengoChannelsCard initialSelected={trengoChannelIds} />
      </div>
    </div>
  )
}

// --- Profile photo ---

function AvatarEditor({
  userName,
  avatarUrl,
}: {
  userName: string
  avatarUrl: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Optimistic preview so the new photo shows instantly after picking one.
  const [preview, setPreview] = useState<string | null>(avatarUrl)
  const inputRef = useRef<HTMLInputElement | null>(null)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-picking the same file
    if (!file) return
    setError(null)
    try {
      // Downscale/crop to a 256px square JPEG in the browser - keeps the
      // stored file tiny and square without any server image library.
      const blob = await resizeImageToSquareJpeg(file, 256)
      const localUrl = URL.createObjectURL(blob)
      setPreview(localUrl)
      const formData = new FormData()
      formData.append("avatar", blob, "avatar.jpg")
      startTransition(async () => {
        try {
          await updateMyAvatar(formData)
          router.refresh()
        } catch (err) {
          setPreview(avatarUrl)
          setError(err instanceof Error ? err.message : "Upload failed")
        }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that image")
    }
  }

  function onRemove() {
    setError(null)
    setPreview(null)
    startTransition(async () => {
      try {
        await removeMyAvatar()
        router.refresh()
      } catch (err) {
        setPreview(avatarUrl)
        setError(err instanceof Error ? err.message : "Remove failed")
      }
    })
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <UserAvatar name={userName} avatarUrl={preview} className="size-14" />
        {pending && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={onPick}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
          >
            <Camera className="size-3.5" />
            {preview ? "Change photo" : "Upload photo"}
          </Button>
          {preview && (
            <Button variant="ghost" size="sm" onClick={onRemove} disabled={pending}>
              <Trash2 className="size-3.5" />
              Remove
            </Button>
          )}
        </div>
        {error ? (
          <p className="text-[11px] text-destructive">{error}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground/60">
            PNG, JPEG or WebP. Shown next to your updates, tasks and messages.
          </p>
        )}
      </div>
    </div>
  )
}

// --- Google Calendar (custom OAuth, separate from sign-in) ---

const GOOGLE_CAL_ERROR_MESSAGES: Record<string, string> = {
  oauth_not_configured: "Google OAuth isn't configured for this deployment yet.",
  access_denied: "You cancelled the Google authorization.",
  missing_code_or_state: "Google returned without a code. Try connecting again.",
  missing_state_cookie:
    "Your browser blocked the OAuth state cookie. Try again in a non-incognito window.",
  state_mismatch: "OAuth state mismatch — possible CSRF or expired flow. Try again.",
  session_mismatch:
    "Your sign-in session changed during the OAuth flow. Sign in again, then retry.",
  exchange_failed: "Google rejected the OAuth code exchange. Try again.",
  no_refresh_token:
    "Google didn't return a refresh token. Sign out of the account at google.com first and try again.",
  userinfo_failed: "Connected but Google didn't return the picked email — try again.",
  store_failed: "Couldn't save the calendar tokens. Try again or contact an admin.",
  oauth_failed: "Google reported an OAuth failure. Try again.",
}

function GoogleCalendarCard({
  connection,
  signInEmail,
}: {
  connection: GoogleCalendarConnection
  signInEmail: string
}) {
  const [pending, setPending] = useState<"disconnecting" | null>(null)
  const [error, setError] = useState<string | null>(
    connection.error
      ? GOOGLE_CAL_ERROR_MESSAGES[connection.error] ??
          `Google Calendar connect failed (${connection.error}).`
      : null,
  )
  const [, startTransition] = useTransition()

  function disconnect() {
    setPending("disconnecting")
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/google-calendar/disconnect", {
          method: "POST",
          credentials: "include",
        })
        if (!res.ok) throw new Error("Failed to disconnect")
        // Soft refresh so the server-rendered card re-reads from the DB.
        window.location.reload()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to disconnect")
        setPending(null)
      }
    })
  }

  const connected = !!connection.connectedEmail
  const usingSignIn = connection.isSignInAccount
  const accountLabel = connection.connectedEmail ?? signInEmail
  // The card is *always* connected (sign-in seeds calendar by default),
  // so the meaningful question for the user is "which Google account?",
  // not "is it connected?". Description + button copy are written
  // around that distinction.
  const description = usingSignIn
    ? "Your Calendar page reads from the same Google account you signed in with. Use a different Google account if your work calendar lives elsewhere (e.g. a shared team account)."
    : "Your Calendar page reads from this account instead of the one you signed in with. Switch back any time."

  return (
    <PlatformCard
      icon={<CalendarIcon className="h-4 w-4" />}
      tone="cyan"
      name="Connect different Google Calendar"
      description={description}
      connected={connected}
      meta={null}
      connectedAt={undefined}
    >
      {/* Current-account chip — the load-bearing piece of information.
          Sits above the action so the user reads "which account first,
          then "switch / reset". */}
      {connected && (
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 mb-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium">
            Currently using
          </p>
          <div className="mt-0.5 flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{accountLabel}</span>
            <span
              className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${
                usingSignIn
                  ? "bg-muted text-muted-foreground"
                  : "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
              }`}
            >
              {usingSignIn ? "Sign-in account" : "Different account"}
            </span>
          </div>
        </div>
      )}

      {connection.justConnected && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 mb-3 text-xs">
          Switched to <span className="font-medium">{connection.justConnected}</span>
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 mb-3 text-xs text-foreground">
          {error}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/api/auth/google-calendar/start"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted/40 transition-colors"
        >
          {connected
            ? "Switch to a different Google Calendar account"
            : "Connect a Google Calendar account"}
        </a>
        {connected && !usingSignIn && (
          <Button
            variant="ghost"
            size="sm"
            onClick={disconnect}
            disabled={pending === "disconnecting"}
          >
            {pending === "disconnecting" && (
              <Loader2 className="size-3.5 animate-spin" />
            )}
            Use my sign-in account instead
          </Button>
        )}
      </div>
    </PlatformCard>
  )
}

// --- Slack (OAuth - coming in C.4) ---

const SLACK_ERROR_MESSAGES: Record<string, string> = {
  oauth_not_configured:
    "Slack OAuth isn't set up on this deployment yet. An admin needs to create a Slack app and add SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET to the environment.",
  start_failed: "Couldn't start the Slack connect flow. Please try again or contact an admin.",
  missing_code_or_state: "Slack returned without a code. Try connecting again.",
  missing_state_cookie: "Your browser blocked the OAuth state cookie. Try again in a non-incognito window.",
  state_mismatch: "OAuth state mismatch - possible CSRF or expired flow. Try again.",
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
        // Server-side redirect to Slack OAuth - using a plain <a> (not next/link)
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

type TrengoChannelOption = {
  id: number
  name: string
  type: string
  /** Trengo events ingested into inbox_events for this channel in the last
   *  7 days. Lets Roy spot subscribed-but-silent channels at a glance -
   *  e.g. "Roy Personal: 0" while WA channels show 100+. */
  eventsLast7d?: number
}

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
                <div className="space-y-4">
                  {groupOrder.map((group) => (
                    <div key={group}>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">
                        {group}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {grouped[group].map((c) => {
                          const isSelected = selected.has(c.id)
                          const events = c.eventsLast7d ?? 0
                          // Subscribed channel with zero traffic = strong
                          // "webhook isn't actually delivering" signal. We
                          // only highlight when subscribed - an unsubscribed
                          // silent channel is normal noise.
                          const silentSubscribed = isSelected && events === 0
                          return (
                            <button
                              key={c.id}
                              type="button"
                              role="checkbox"
                              aria-checked={isSelected}
                              onClick={() => toggle(c.id)}
                              disabled={pending}
                              className={
                                "group flex items-center gap-2.5 px-2.5 py-2 rounded-md border text-left transition-colors disabled:opacity-60 " +
                                (isSelected
                                  ? "border-foreground/20 bg-foreground/[0.04] hover:bg-foreground/[0.06]"
                                  : "border-border/40 hover:bg-muted/40")
                              }
                            >
                              <span
                                className={
                                  "h-4 w-4 rounded-[5px] border flex items-center justify-center shrink-0 transition-colors " +
                                  (isSelected
                                    ? "border-foreground bg-foreground text-background"
                                    : "border-border bg-background")
                                }
                              >
                                {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                              </span>
                              <span className="text-xs truncate flex-1 min-w-0">{c.name}</span>
                              {silentSubscribed ? (
                                <span
                                  className="text-[10px] tabular-nums shrink-0 text-amber-600 dark:text-amber-500 font-medium"
                                  title="Subscribed but no events ingested in the last 7 days - webhook may not be delivering for this channel"
                                >
                                  0/7d
                                </span>
                              ) : (
                                <span
                                  className="text-[10px] tabular-nums shrink-0 text-muted-foreground/40"
                                  title={`${events} events ingested in last 7 days`}
                                >
                                  {events}/7d
                                </span>
                              )}
                            </button>
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
        // PushManager's TS types want a BufferSource - Uint8Array on a
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
      lines.push(`VAPID configured: ${data.vapidConfigured ? "yes" : "NO - server side env missing"}`)
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
                : "Eén klik om aan te zetten - je browser vraagt toestemming."}
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
