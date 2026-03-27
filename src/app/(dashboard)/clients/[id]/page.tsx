import { fetchClientById } from "@/lib/monday"
import { syncClientToSupabase } from "@/lib/sync-client"
import { ClientHeader } from "./_components/client-header"
import { ClientTabs } from "./_components/client-tabs"
import { notFound } from "next/navigation"
import Link from "next/link"

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let client = null
  let supabaseClientId = ""
  let error: string | null = null

  try {
    client = await fetchClientById(id)
    if (!client) return notFound()
    supabaseClientId = await syncClientToSupabase(client)
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load client"
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

  return (
    <div className="container mx-auto max-w-5xl py-8 px-4">
      <ClientHeader client={client} />
      <ClientTabs client={client} supabaseClientId={supabaseClientId} />
    </div>
  )
}
