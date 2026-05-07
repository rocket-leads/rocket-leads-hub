import { Suspense } from "react"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { readCache } from "@/lib/cache"
import { ClientsOverview } from "./_components/clients-overview"
import { filterClientsByUser } from "@/lib/clients/filter"
import { auth } from "@/lib/auth"
import { Skeleton } from "@/components/ui/skeleton"
import Link from "next/link"
import type { MondayClient } from "@/lib/integrations/monday"

function ClientsLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-72 rounded-lg" />
      <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-3 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)]">
        {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
      </div>
    </div>
  )
}

async function ClientsData() {
  let onboarding: Awaited<ReturnType<typeof fetchBothBoards>>["onboarding"] = []
  let current: Awaited<ReturnType<typeof fetchBothBoards>>["current"] = []
  let error: string | null = null

  const session = await auth()

  try {
    // Try cache first (kept fresh by cron at 5:00 / 5:30), fall back to live API.
    // 60-min TTL is a safety net: if the cron silently fails, the page won't keep
    // showing day-old data — after an hour we re-fetch live (slower but correct).
    const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
      "monday_boards",
      60 * 60 * 1000,
    )
    const data = cached ?? await fetchBothBoards()

    if (session?.user?.id && session.user.role) {
      onboarding = await filterClientsByUser(data.onboarding, session.user.id, session.user.role)
      current = await filterClientsByUser(data.current, session.user.id, session.user.role)
    } else {
      onboarding = data.onboarding
      current = data.current
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load clients"
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-5 py-4 text-sm text-destructive">
        {error}{" "}
        {error.includes("token") && (
          <Link href="/settings" className="underline font-medium">
            Go to Settings
          </Link>
        )}
      </div>
    )
  }

  const currentUser = session?.user?.id
    ? {
        id: session.user.id,
        name: session.user.name ?? session.user.email,
        role: session.user.role ?? "member",
      }
    : null

  return (
    <ClientsOverview
      onboarding={onboarding}
      current={current}
      currentUser={currentUser}
    />
  )
}

export default function ClientsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-heading font-semibold tracking-tight leading-tight">Clients</h1>
      </div>

      <Suspense fallback={<ClientsLoading />}>
        <ClientsData />
      </Suspense>
    </div>
  )
}
