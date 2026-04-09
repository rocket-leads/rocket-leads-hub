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
    <div className="space-y-4">
      <Skeleton className="h-9 w-64" />
      <div className="space-y-2">
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
    // Try cache first (kept fresh by cron every 30 min), fall back to live API
    const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>("monday_boards")
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

  return <ClientsOverview onboarding={onboarding} current={current} />
}

export default function ClientsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-heading font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted-foreground mt-1">Overview of all active client accounts</p>
      </div>

      <Suspense fallback={<ClientsLoading />}>
        <ClientsData />
      </Suspense>
    </div>
  )
}
