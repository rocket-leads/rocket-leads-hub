import { fetchBothBoards } from "@/lib/monday"
import { ClientsOverview } from "./_components/clients-overview"
import Link from "next/link"

export default async function ClientsPage() {
  let onboarding: Awaited<ReturnType<typeof fetchBothBoards>>["onboarding"] = []
  let current: Awaited<ReturnType<typeof fetchBothBoards>>["current"] = []
  let error: string | null = null

  try {
    const data = await fetchBothBoards()
    onboarding = data.onboarding
    current = data.current
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load clients"
  }

  return (
    <div className="container mx-auto max-w-7xl py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Clients</h1>
        <p className="text-muted-foreground">All clients from Monday.com</p>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}{" "}
          {error.includes("token") && (
            <Link href="/settings" className="underline font-medium">
              Go to Settings
            </Link>
          )}
        </div>
      ) : (
        <ClientsOverview onboarding={onboarding} current={current} />
      )}
    </div>
  )
}
