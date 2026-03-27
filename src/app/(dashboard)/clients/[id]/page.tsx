import { auth } from "@/lib/auth"
import { fetchClientById } from "@/lib/monday"
import { syncClientToSupabase } from "@/lib/sync-client"
import { getClientAccess } from "@/lib/client-access"
import { ClientHeader } from "./_components/client-header"
import { ClientTabs } from "./_components/client-tabs"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")

  const { id } = await params

  let client = null
  let supabaseClientId = ""
  let error: string | null = null

  try {
    client = await fetchClientById(id)
    if (!client) return notFound()
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load client"
  }

  // Sync to Supabase non-blocking — page renders even if this fails
  if (client) {
    syncClientToSupabase(client)
      .then((id) => { supabaseClientId = id })
      .catch((e) => console.error("Supabase sync failed:", e))
  }

  if (error) {
    return (
      <div className="container mx-auto max-w-5xl py-8 px-4">
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}{" "}
          {error.includes("token") && (
            <Link href="/settings" className="underline font-medium">
              Go to Settings
            </Link>
          )}
        </div>
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
    <div className="container mx-auto max-w-5xl py-8 px-4">
      <ClientHeader client={client} />
      <ClientTabs client={client} supabaseClientId={supabaseClientId} access={access} />
    </div>
  )
}
