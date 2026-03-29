import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { fetchClientById } from "@/lib/monday"
import { syncClientToSupabase } from "@/lib/sync-client"
import { getClientAccess } from "@/lib/client-access"
import { ClientHeader } from "./_components/client-header"
import { ClientTabs } from "./_components/client-tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"

function ClientDetailLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-10 w-80" />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}

async function ClientDetailData({ id }: { id: string }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")

  let client = null
  let error: string | null = null

  try {
    client = await fetchClientById(id)
    if (!client) return notFound()
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load client"
  }

  // Await sync so API routes can reliably query Supabase
  let supabaseClientId = ""
  if (client) {
    try {
      supabaseClientId = await syncClientToSupabase(client)
    } catch (e) {
      console.error("Supabase sync failed:", e)
    }
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}{" "}
        {error.includes("token") && (
          <Link href="/settings" className="underline font-medium">
            Go to Settings
          </Link>
        )}
      </div>
    )
  }

  if (!client) return notFound()

  const access = await getClientAccess(
    session.user.id,
    session.user.role ?? "member",
    client.mondayItemId
  )

  return (
    <>
      <ClientHeader client={client} />
      <ClientTabs client={client} supabaseClientId={supabaseClientId} access={access} />
    </>
  )
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="container mx-auto max-w-5xl py-8 px-4">
      <Suspense fallback={<ClientDetailLoading />}>
        <ClientDetailData id={id} />
      </Suspense>
    </div>
  )
}
