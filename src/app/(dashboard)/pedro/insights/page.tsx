import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { PageHeader } from "@/components/ui/page-header"
import { PedroInsights } from "../_components/pedro-insights"

/**
 * Pedro · Insights - agency-wide pattern browser.
 *
 * Sits under /pedro as a nested tab (Roy 2026-05-23 sidebar tab-shift).
 * Data comes from `pedro_vertical_patterns` (refreshed nightly by the
 * `refresh-pedro-patterns` cron). The page is read-only - no actions,
 * no client selection, just exploration.
 */
export const dynamic = "force-dynamic"
export const metadata = { title: "Pedro · Insights - Rocket Leads Hub" }

export default async function PedroInsightsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")

  return (
    <div>
      <PageHeader title="Insights" />
      <PedroInsights />
    </div>
  )
}
