import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { PageHeader } from "@/components/ui/page-header"
import { FinanceTab } from "../_components/finance-tab"
import { TargetsToolbar } from "../_components/targets-toolbar"
import { getUserLocale } from "@/lib/i18n/server"
import { t } from "@/lib/i18n/t"

export default async function FinanceDashboardPage() {
  const session = await auth()
  const isAdmin = session?.user.role === "admin"
  const isFinance = !!session?.user.isFinance
  // Finance numbers are admin + finance only (Roy 2026-05-23). Anyone else who
  // reaches this URL is bounced to the Marketing dashboard.
  if (!isAdmin && !isFinance) redirect("/targets/marketing")
  const locale = await getUserLocale(session?.user.id)

  return (
    <div>
      <PageHeader
        title={t("targets.tab.finance", locale)}
        actions={<TargetsToolbar isAdmin={isAdmin} canSeeFinance />}
      />
      <FinanceTab />
    </div>
  )
}
