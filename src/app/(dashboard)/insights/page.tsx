import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { PageHeader } from "@/components/ui/page-header"
import { PedroInsights } from "@/app/(dashboard)/pedro/_components/pedro-insights"

/**
 * Insights — agency-wide pattern browser, formerly a tab inside Pedro.
 *
 * Moved out of Pedro (2026-05-22): Pedro is the per-client build flow
 * (Voorbereiding → Deliverables) plus the per-client Refresh tool.
 * Insights has no client picker and shows portfolio-level data, so it
 * conceptually doesn't belong in the Pedro tab strip. Its own
 * top-level page makes the "agency-wide" framing immediate.
 *
 * Data comes from `pedro_vertical_patterns` (refreshed nightly by the
 * `refresh-pedro-patterns` cron). The page is read-only — no actions,
 * no client selection, just exploration.
 */
export default async function InsightsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")

  return (
    <div>
      <PageHeader
        title="Insights"
        subtitle="Wat werkt op dit moment in elke branche, samengesteld uit winnende campagnes over alle Rocket Leads klanten heen. Geanonimiseerd — geen klantnamen, alleen patronen."
      />
      <PedroInsights />
    </div>
  )
}
