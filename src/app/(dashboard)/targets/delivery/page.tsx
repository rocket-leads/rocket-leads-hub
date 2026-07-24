import { auth } from "@/lib/auth"
import { PageHeader } from "@/components/ui/page-header"
import { DeliveryTab } from "../_components/delivery-tab"
import { TargetsToolbar } from "../_components/targets-toolbar"
import { getUserLocale } from "@/lib/i18n/server"
import { t } from "@/lib/i18n/t"

export default async function DeliveryDashboardPage() {
  const session = await auth()
  const isAdmin = session?.user.role === "admin"
  const isFinance = !!session?.user.isFinance
  const locale = await getUserLocale(session?.user.id)

  return (
    <div>
      <PageHeader
        title={t("targets.tab.delivery", locale)}
        actions={<TargetsToolbar isAdmin={isAdmin} canSeeFinance={isAdmin || isFinance} />}
      />
      <DeliveryTab />
    </div>
  )
}
