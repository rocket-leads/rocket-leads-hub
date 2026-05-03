"use client"

import { useState, useTransition } from "react"
import {
  MessageSquare,
  LayoutGrid,
  Hash,
  Loader2,
  Check,
  X,
  ExternalLink,
} from "lucide-react"
import { connectMyPlatform, disconnectMyPlatform } from "../actions"
import type { UserPlatformConnection, Platform } from "@/lib/inbox/user-platform-tokens"

type Props = {
  userName: string
  userEmail: string
  slack: UserPlatformConnection | null
  trengo: UserPlatformConnection | null
  monday: UserPlatformConnection | null
}

export function MyAccount({ userName, userEmail, slack, trengo, monday }: Props) {
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
          <SlackCard connection={slack} />
          <TrengoCard connection={trengo} />
          <MondayCard connection={monday} />
        </div>
      </div>
    </div>
  )
}

// --- Slack (OAuth — coming in C.4) ---

function SlackCard({ connection }: { connection: UserPlatformConnection | null }) {
  const [pending, setPending] = useState<"disconnecting" | null>(null)
  const [error, setError] = useState<string | null>(null)
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
        <button
          type="button"
          onClick={disconnect}
          disabled={pending !== null}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted/60 transition-colors disabled:opacity-60"
        >
          {pending === "disconnecting" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
          Disconnect
        </button>
      ) : (
        // Server-side redirect to Slack OAuth — using an <a> tag (not a button)
        // so the browser does a full navigation rather than fetch.
        <a
          href="/api/auth/slack/start"
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:opacity-90 transition-opacity"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Connect Slack
        </a>
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
          <button
            type="button"
            onClick={disconnect}
            disabled={pending !== null}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted/60 transition-colors disabled:opacity-60"
          >
            {pending === "disconnecting" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            Disconnect
          </button>
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
