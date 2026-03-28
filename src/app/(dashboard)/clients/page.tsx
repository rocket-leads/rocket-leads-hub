import { Suspense } from "react"
import { fetchBothBoards } from "@/lib/monday"
import { ClientsOverview } from "./_components/clients-overview"
import { filterClientsByUser } from "@/lib/user-client-filter"
import { auth } from "@/lib/auth"
import { Skeleton } from "@/components/ui/skeleton"
import Link from "next/link"

function ClientsLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-8 w-8" />
      </div>
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
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
    const data = await fetchBothBoards()

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
      <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
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
    <div className="container mx-auto max-w-7xl py-8 px-6">
      <div className="mb-8">
        <h1
          className="text-3xl font-bold text-foreground mb-1"
          style={{ fontFamily: "'Clash Grotesk', sans-serif", letterSpacing: "-0.03em" }}
        >
          Clients
        </h1>
        <p className="text-sm text-muted-foreground">Overview of all active client accounts</p>
      </div>

      <Suspense fallback={<ClientsLoading />}>
        <ClientsData />
      </Suspense>
    </div>
  )
}
