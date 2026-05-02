import { redirect } from "next/navigation"

/**
 * Legacy client detail route. The Hub no longer uses a standalone client page —
 * clicking a client opens a slide-over panel on /clients?client=<id>. This
 * route exists as a redirect so old bookmarks and external deep links keep
 * working without 404'ing.
 */
export default async function ClientRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/clients?client=${encodeURIComponent(id)}`)
}
