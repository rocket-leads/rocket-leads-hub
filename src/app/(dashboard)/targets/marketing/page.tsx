import { auth } from "@/lib/auth"
import { PageHeader } from "@/components/ui/page-header"
import { MarketingTab } from "../_components/marketing-tab"
import { TargetsToolbar } from "../_components/targets-toolbar"
import { getUserLocale } from "@/lib/i18n/server"
import { t } from "@/lib/i18n/t"

export default async function MarketingDashboardPage() {
  const session = await auth()
  const isAdmin = session?.user.role === "admin"
  const isFinance = !!session?.user.isFinance
  const locale = await getUserLocale(session?.user.id)

  return (
    <div>
      <PageHeader
        title={t("targets.tab.marketing", locale)}
        actions={<TargetsToolbar isAdmin={isAdmin} canSeeFinance={isAdmin || isFinance} />}
      />
      <MarketingTab />
    </div>
  )
}
