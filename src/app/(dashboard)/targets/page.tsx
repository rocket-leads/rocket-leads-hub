import { auth } from "@/lib/auth"
import { TargetsTabs } from "./_components/targets-tabs"
import { PageHeader } from "@/components/ui/page-header"
import { getUserLocale } from "@/lib/i18n/server"
import { t } from "@/lib/i18n/t"

export default async function TargetsPage() {
  const session = await auth()
  const isAdmin = session?.user.role === "admin"
  const isFinance = !!session?.user.isFinance
  const locale = await getUserLocale(session?.user.id)

  return (
    <div>
      <PageHeader title={t("targets.title", locale)} subtitle={t("targets.subtitle", locale)} />
      {/* Finance tab visible to admin + finance (Roy 2026-05-23). Settings
          tab stays admin-only — it edits targets, not finance numbers. */}
      <TargetsTabs isAdmin={isAdmin} canSeeFinance={isAdmin || isFinance} />
    </div>
  )
}
