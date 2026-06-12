import { Suspense } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight } from "lucide-react"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { readCache } from "@/lib/cache"
import { WatchListDashboard } from "./_components/watchlist-dashboard"
import { filterClientsByUser } from "@/lib/clients/filter"
import { mondayStatusToHub } from "@/lib/clients/status"
import { auth } from "@/lib/auth"
import { Skeleton } from "@/components/ui/skeleton"
import type { MondayClient } from "@/lib/integrations/monday"

function WatchListLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-64" />
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
      </div>
    </div>
  )
}

async function WatchListData() {
  const session = await auth()

  // 1h TTL on the cache read - without it the watch list would happily serve
  // 24h-old data because the refresh-cache cron only writes `monday_boards`
  // once per day. A client moved to "On hold" in Monday at 10:00 would keep
  // showing on the watch list until the next morning's tick. Mirrors the
  // /clients page's safety net.
  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
    60 * 60 * 1000,
  )

  // Roy 2026-06-12: graceful fallback when Monday token is missing. Was
  // throwing "Monday token not configured" + crashing the whole watchlist
  // page. Now we surface a clear CTA to Settings → API Tokens so the AM
  // can fix it without seeing a Next.js error overlay.
  let data: { onboarding: MondayClient[]; current: MondayClient[] }
  if (cached) {
    data = cached
  } else {
    try {
      data = await fetchBothBoards()
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Monday fetch failed"
      if (/monday token|not configured|api token/i.test(msg)) {
        return <MissingTokenState message={msg} />
      }
      throw e
    }
  }

  let current = data.current
  if (session?.user?.id && session.user.role) {
    current = await filterClientsByUser(data.current, session.user.id, session.user.role)
  }

  // Use the Hub-canonical mapping instead of a strict `=== "Live"` literal so
  // status variants like "live", "Live " (trailing space), or a renamed Monday
  // option still collapse to the right bucket. Also explicitly excludes the
  // entire on-hold / churned family (any "Paused..." or "Stopt..." variant)
  // even if the cache momentarily has the old "Live" string - once the
  // mapping returns anything other than "live", the row is dropped.
  const active = current.filter((c) => mondayStatusToHub(c.campaignStatus, c.boardType) === "live")

  const currentUser = session?.user?.id
    ? {
        id: session.user.id,
        name: session.user.name ?? session.user.email,
        role: session.user.role ?? "member",
      }
    : null

  return (
    <WatchListDashboard
      clients={active}
      userName={session?.user?.name ?? "there"}
      currentUser={currentUser}
    />
  )
}

function MissingTokenState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 space-y-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold">Monday API token ontbreekt</h2>
          <p className="text-sm text-muted-foreground">
            De Watch List leest klanten + statussen uit Monday, dus zonder
            geconfigureerde token kunnen we niets tonen. Voeg de token toe in Settings.
          </p>
          <p className="text-[11px] text-muted-foreground/70 font-mono">{message}</p>
        </div>
      </div>
      <Link
        href="/settings?tab=api-tokens"
        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Open Settings → API Tokens
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}

export default function WatchListPage() {
  return (
    <div>
      <Suspense fallback={<WatchListLoading />}>
        <WatchListData />
      </Suspense>
    </div>
  )
}
