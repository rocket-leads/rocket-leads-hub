import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { PageHeader } from "@/components/ui/page-header"
import { SettingsTab } from "../_components/settings-tab"
import { TargetsToolbar } from "../_components/targets-toolbar"
import { getUserLocale } from "@/lib/i18n/server"
import { t } from "@/lib/i18n/t"

// Target-config editor - admin only. Reached via the gear on any Growth
// dashboard toolbar.
export default async function TargetsSettingsPage() {
  const session = await auth()
  const isAdmin = session?.user.role === "admin"
  if (!isAdmin) redirect("/targets/marketing")
  const locale = await getUserLocale(session?.user.id)

  return (
    <div>
      <PageHeader
        title={t("targets.action.settings", locale)}
        actions={<TargetsToolbar isAdmin canSeeFinance showSettingsGear={false} />}
      />
      <SettingsTab />
    </div>
  )
}
