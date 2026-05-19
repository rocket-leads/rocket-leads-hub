import { Suspense } from "react"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { readCache } from "@/lib/cache"
import { ClientsOverview } from "./_components/clients-overview"
import { loadUserMappingsContext, filterClientsByContext } from "@/lib/clients/filter"
import { auth } from "@/lib/auth"
import { Skeleton } from "@/components/ui/skeleton"
import Link from "next/link"
import { getUserLocale } from "@/lib/i18n/server"
import { t } from "@/lib/i18n/t"
import type { MondayClient } from "@/lib/integrations/monday"
import type { Session } from "next-auth"
import type { Locale } from "@/lib/i18n/types"

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

async function ClientsData({ session, locale }: { session: Session | null; locale: Locale }) {
  let onboarding: MondayClient[] = []
  let current: MondayClient[] = []
  let error: string | null = null

  try {
    // Run the three independent lookups concurrently:
    //   - monday_boards cache (60-min TTL safety net if cron silently failed)
    //   - user_column_mappings (filtered against both boards in-memory)
    // Previously these ran sequentially AND filterClientsByUser was called twice,
    // querying mappings once per board.
    const mappingsContextPromise =
      session?.user?.id && session.user.role
        ? loadUserMappingsContext(session.user.id, session.user.role)
        : Promise.resolve(null)
    const cachedPromise = readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
      "monday_boards",
      60 * 60 * 1000,
    )

    const [cached, mappingsContext] = await Promise.all([cachedPromise, mappingsContextPromise])
    const data = cached ?? (await fetchBothBoards())

    onboarding = filterClientsByContext(data.onboarding, mappingsContext)
    current = filterClientsByContext(data.current, mappingsContext)
  } catch (e) {
    error = e instanceof Error ? e.message : t("clients.error.failed_to_load", locale)
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-5 py-4 text-sm text-destructive">
        {error}{" "}
        {error.includes("token") && (
          <Link href="/settings" className="underline font-medium">
            {t("clients.error.go_to_settings", locale)}
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

export default async function ClientsPage() {
  // Single auth() + getUserLocale() pair — both child renders reuse these via props.
  // Previously each ran twice (once in the page, once in ClientsData inner func).
  const session = await auth()
  const locale = await getUserLocale(session?.user?.id)
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-heading font-semibold tracking-tight leading-tight">{t("clients.title", locale)}</h1>
      </div>

      <Suspense fallback={<ClientsLoading />}>
        <ClientsData session={session} locale={locale} />
      </Suspense>
    </div>
  )
}
